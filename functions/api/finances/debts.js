import { cachedJson } from '../auth/_lib/auth.js';
import { getFinanceRangeWindow, normalizeFinanceRange, requireFinancePermission, toMoney } from '../_lib/finances.js';
import { hasPermission } from '../_lib/permissions.js';

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizeScope(value) {
  return String(value || '').trim().toLowerCase() === 'range' ? 'range' : 'all';
}

function normalizeBool(value, fallback = true) {
  if (value == null || value === '') return fallback;
  const raw = String(value).trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  return true;
}

function mapDebtRow(row) {
  return {
    voyageId: Number(row.id),
    vesselName: String(row.vessel_name || '').trim(),
    vesselCallsign: String(row.vessel_callsign || '').trim(),
    departurePort: String(row.departure_port || '').trim(),
    destinationPort: String(row.destination_port || '').trim(),
    endedAt: row.ended_at,
    companyShareAmount: toMoney(row.company_share_amount || 0),
    companyShareStatus: String(row.company_share_status || 'UNSETTLED').trim().toUpperCase(),
    officerEmployeeId: Number(row.officer_of_watch_employee_id || 0) || null,
    officerName: String(row.officer_name || 'Unknown').trim() || 'Unknown',
    officerSerial: String(row.officer_serial || '').trim()
  };
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse, session } = await requireFinancePermission(context, 'finances.view');
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const search = normalizeSearch(url.searchParams.get('search'));
  const minOutstanding = Math.max(0, Number(url.searchParams.get('minOutstanding')) || 0);
  const scope = normalizeScope(url.searchParams.get('scope'));
  const range = normalizeFinanceRange(url.searchParams.get('range'));
  const onlyUnsettled = normalizeBool(url.searchParams.get('onlyUnsettled'), true);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(5, Number(url.searchParams.get('pageSize')) || 10));
  const offset = (page - 1) * pageSize;

  const whereClauses = [
    `v.status = 'ENDED'`,
    `ROUND(COALESCE(v.company_share_amount, v.company_share, 0)) > 0`
  ];
  const bindings = [];

  if (onlyUnsettled) {
    whereClauses.push(`COALESCE(v.company_share_status, 'UNSETTLED') = 'UNSETTLED'`);
  }

  if (scope === 'range') {
    const windowRange = getFinanceRangeWindow(range);
    whereClauses.push('v.ended_at IS NOT NULL AND v.ended_at >= ? AND v.ended_at <= ?');
    bindings.push(windowRange.start.toISOString(), windowRange.end.toISOString());
  }

  if (minOutstanding > 0) {
    whereClauses.push('ROUND(COALESCE(v.company_share_amount, v.company_share, 0)) >= ?');
    bindings.push(minOutstanding);
  }

  if (search) {
    const searchValue = `%${search}%`;
    whereClauses.push(`(
      LOWER(COALESCE(e.roblox_username, '')) LIKE ?
      OR LOWER(COALESCE(e.serial_number, '')) LIKE ?
      OR LOWER(COALESCE(v.vessel_name, '')) LIKE ?
      OR LOWER(COALESCE(v.vessel_callsign, '')) LIKE ?
      OR LOWER(COALESCE(v.departure_port, '')) LIKE ?
      OR LOWER(COALESCE(v.destination_port, '')) LIKE ?
    )`);
    bindings.push(searchValue, searchValue, searchValue, searchValue, searchValue, searchValue);
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const baseSql = `
    SELECT
      v.id,
      v.vessel_name,
      v.vessel_callsign,
      v.departure_port,
      v.destination_port,
      v.ended_at,
      ROUND(COALESCE(v.company_share_amount, v.company_share, 0)) AS company_share_amount,
      COALESCE(v.company_share_status, 'UNSETTLED') AS company_share_status,
      v.officer_of_watch_employee_id,
      e.roblox_username AS officer_name,
      e.serial_number AS officer_serial
    FROM voyages v
    LEFT JOIN employees e ON e.id = v.officer_of_watch_employee_id
    ${whereSql}
  `;

  const [allRowsResult, pageRowsResult] = await Promise.all([
    env.DB.prepare(`${baseSql} ORDER BY company_share_amount DESC, v.ended_at DESC, v.id DESC`).bind(...bindings).all(),
    env.DB.prepare(`${baseSql} ORDER BY company_share_amount DESC, v.ended_at DESC, v.id DESC LIMIT ? OFFSET ?`).bind(...bindings, pageSize, offset).all()
  ]);

  const allRows = (allRowsResult?.results || []).map(mapDebtRow);
  const rows = (pageRowsResult?.results || []).map(mapDebtRow);

  const groupsMap = new Map();
  allRows.forEach((row) => {
    const key = row.officerEmployeeId || `unknown-${row.officerName}`;
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        officerEmployeeId: row.officerEmployeeId,
        officerName: row.officerName,
        officerSerial: row.officerSerial,
        outstandingTotal: 0,
        voyageCount: 0,
        voyages: []
      });
    }

    const group = groupsMap.get(key);
    group.outstandingTotal = toMoney(group.outstandingTotal + row.companyShareAmount);
    group.voyageCount += 1;
    group.voyages.push({
      voyageId: row.voyageId,
      vesselName: row.vesselName,
      vesselCallsign: row.vesselCallsign,
      departurePort: row.departurePort,
      destinationPort: row.destinationPort,
      endedAt: row.endedAt,
      companyShareAmount: row.companyShareAmount,
      companyShareStatus: row.companyShareStatus
    });
  });

  const groups = [...groupsMap.values()]
    .sort((a, b) => b.outstandingTotal - a.outstandingTotal || b.voyageCount - a.voyageCount || a.officerName.localeCompare(b.officerName))
    .map((group) => ({
      ...group,
      voyages: group.voyages.sort((a, b) => {
        const aTime = new Date(a.endedAt || 0).getTime();
        const bTime = new Date(b.endedAt || 0).getTime();
        return bTime - aTime || b.companyShareAmount - a.companyShareAmount;
      })
    }));

  const total = allRows.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  return cachedJson(
    request,
    {
      rows,
      groups,
      totals: {
        unsettledOutstanding: toMoney(allRows.reduce((sum, row) => sum + row.companyShareAmount, 0)),
        unsettledVoyages: total,
        uniqueOotw: groups.length
      },
      pagination: {
        page,
        pageSize,
        total,
        totalPages
      },
      filters: {
        scope,
        range,
        onlyUnsettled
      },
      permissions: {
        canSettle: hasPermission(session, 'finances.debts.settle'),
        canViewAudit: hasPermission(session, 'finances.audit.view')
      }
    },
    { cacheControl: 'private, max-age=20, stale-while-revalidate=40' }
  );
}
