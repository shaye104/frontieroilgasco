import { cachedJson } from '../auth/_lib/auth.js';
import { getFinanceRangeWindow, normalizeFinanceRange, normalizeTzOffsetMinutes, parseSettlementLines, requireFinancePermission, toMoney } from '../_lib/finances.js';
import { hasPermission } from '../_lib/permissions.js';

const COMPANY_SHARE_RATE = 0.2;

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
  const settlementLines = parseSettlementLines(row.settlement_lines_json);
  const settlementCutAmount = toMoney(settlementLines.reduce((sum, line) => sum + Number(line.lineRevenue || 0), 0));
  const storedEffectiveSell = Number(row.effective_sell);
  const storedPayableAmount = Number(row.total_payable_amount);
  const voyageProfit = toMoney(row.profit || 0);
  const storedShare = Number(row.company_share_amount);
  const legacyShare = Number(row.company_share);
  const derivedCompanyShare =
    settlementCutAmount > 0
      ? Math.max(0, toMoney(settlementCutAmount))
      : Number.isFinite(storedEffectiveSell) && storedEffectiveSell > 0
      ? Math.max(0, toMoney(storedEffectiveSell))
      : Number.isFinite(storedPayableAmount) && storedPayableAmount > 0
      ? Math.max(0, toMoney(storedPayableAmount))
      : Number.isFinite(storedShare) && storedShare > 0
      ? Math.max(0, toMoney(storedShare))
      : Number.isFinite(legacyShare) && legacyShare > 0
      ? Math.max(0, toMoney(legacyShare))
      : Math.max(0, toMoney(voyageProfit * COMPANY_SHARE_RATE));
  const serialRaw = String(row.officer_serial || '').trim();
  const officerSerial = serialRaw.toUpperCase() === 'N/A' ? '' : serialRaw;
  return {
    voyageId: Number(row.id),
    vesselName: String(row.vessel_name || '').trim(),
    vesselCallsign: String(row.vessel_callsign || '').trim(),
    departurePort: String(row.departure_port || '').trim(),
    destinationPort: String(row.destination_port || '').trim(),
    endedAt: row.ended_at,
    companyShareAmount: derivedCompanyShare,
    companyShareStatus: String(row.company_share_status || 'UNSETTLED').trim().toUpperCase(),
    officerEmployeeId: Number(row.officer_of_watch_employee_id || 0) || null,
    officerName: String(row.officer_name || 'Unknown').trim() || 'Unknown',
    officerSerial,
    settlementLinesJson: row.settlement_lines_json,
    settlementOwnerTotalsJson: row.settlement_owner_totals_json
  };
}

function parseOwnerTotals(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => ({
        ownerEmployeeId: Number(row?.ownerEmployeeId || row?.owner_employee_id || 0),
        ownerName: String(row?.ownerName || row?.owner_name || '').trim(),
        reimbursementTotal: Math.max(0, toMoney(row?.reimbursementTotal || 0))
      }))
      .filter((row) => row.ownerEmployeeId > 0 && row.reimbursementTotal > 0);
  } catch {
    return [];
  }
}

function upsertReimbursementLine(map, voyageId, ownerEmployeeId, ownerName, amount) {
  const safeVoyageId = Number(voyageId || 0);
  const safeOwnerId = Number(ownerEmployeeId || 0);
  const safeAmount = Math.max(0, toMoney(amount || 0));
  if (!safeVoyageId || !safeOwnerId || safeAmount <= 0) return;
  const key = `${safeVoyageId}:${safeOwnerId}`;
  const existing = map.get(key) || {
    key,
    voyageId: safeVoyageId,
    ownerEmployeeId: safeOwnerId,
    ownerName: String(ownerName || '').trim() || `Employee #${safeOwnerId}`,
    totalReimbursement: 0
  };
  existing.totalReimbursement = toMoney(existing.totalReimbursement + safeAmount);
  map.set(key, existing);
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
  const tzOffsetMinutes = normalizeTzOffsetMinutes(url.searchParams.get('tzOffsetMinutes'));
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(5, Number(url.searchParams.get('pageSize')) || 10));
  const offset = (page - 1) * pageSize;

  const whereClauses = [
    `v.deleted_at IS NULL`,
    `v.status = 'ENDED'`
  ];
  const bindings = [];

  if (onlyUnsettled) {
    whereClauses.push(`COALESCE(v.company_share_status, 'UNSETTLED') = 'UNSETTLED'`);
  }

  if (scope === 'range') {
    const windowRange = getFinanceRangeWindow(range, new Date(), tzOffsetMinutes);
    whereClauses.push('v.ended_at IS NOT NULL AND v.ended_at >= ? AND v.ended_at <= ?');
    bindings.push(windowRange.start.toISOString(), windowRange.end.toISOString());
  }

  if (search) {
    const searchValue = `%${search}%`;
    whereClauses.push(`(
      LOWER(COALESCE(e.roblox_username, '')) LIKE ?
      OR LOWER(COALESCE(e.serial_number, '')) LIKE ?
    )`);
    bindings.push(searchValue, searchValue);
  }

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const reimbursementWhereClauses = [
    `v.deleted_at IS NULL`,
    `v.status IN ('ENDED', 'CANCELLED')`,
    `(v.settlement_lines_json IS NOT NULL OR v.settlement_owner_totals_json IS NOT NULL)`
  ];
  const reimbursementBindings = [];
  if (scope === 'range') {
    const windowRange = getFinanceRangeWindow(range, new Date(), tzOffsetMinutes);
    reimbursementWhereClauses.push('v.ended_at IS NOT NULL AND v.ended_at >= ? AND v.ended_at <= ?');
    reimbursementBindings.push(windowRange.start.toISOString(), windowRange.end.toISOString());
  }
  const reimbursementWhereSql = reimbursementWhereClauses.length ? `WHERE ${reimbursementWhereClauses.join(' AND ')}` : '';

  const baseSql = `
    SELECT
      v.id,
      v.vessel_name,
      v.vessel_callsign,
      v.departure_port,
      v.destination_port,
      v.ended_at,
      v.profit,
      COALESCE(v.company_share_status, 'UNSETTLED') AS company_share_status,
      v.settlement_lines_json,
      v.settlement_owner_totals_json,
      v.company_share_amount,
      v.effective_sell,
      v.total_payable_amount,
      v.officer_of_watch_employee_id,
      e.roblox_username AS officer_name,
      e.serial_number AS officer_serial
    FROM voyages v
    LEFT JOIN employees e ON e.id = v.officer_of_watch_employee_id
    ${whereSql}
  `;

  const [allRowsResult, reimbursementVoyagesResult] = await Promise.all([
    env.DB.prepare(`${baseSql} ORDER BY company_share_amount DESC, v.ended_at DESC, v.id DESC`).bind(...bindings).all(),
    env.DB
      .prepare(
        `SELECT v.id, v.settlement_lines_json, v.settlement_owner_totals_json
         FROM voyages v
         ${reimbursementWhereSql}
         ORDER BY v.ended_at DESC, v.id DESC`
      )
      .bind(...reimbursementBindings)
      .all()
  ]);

  const allRows = (allRowsResult?.results || []).map(mapDebtRow);
  const filteredRows = allRows.filter((row) => row.companyShareAmount > 0 && row.companyShareAmount >= minOutstanding);
  const rows = filteredRows.slice(offset, offset + pageSize);

  const groupsMap = new Map();
  filteredRows.forEach((row) => {
    const key = row.officerEmployeeId || `unknown-${row.officerName}`;
    if (!groupsMap.has(key)) {
      groupsMap.set(key, {
        groupKey: String(key),
        officerEmployeeId: row.officerEmployeeId,
        officerName: row.officerName,
        officerSerial: row.officerSerial,
        outstandingTotal: 0,
        voyageCount: 0,
        unsettledVoyages: 0,
        voyages: []
      });
    }

    const group = groupsMap.get(key);
    group.outstandingTotal = toMoney(group.outstandingTotal + row.companyShareAmount);
    group.voyageCount += 1;
    if (String(row.companyShareStatus || '').toUpperCase() === 'UNSETTLED') group.unsettledVoyages += 1;
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

  const pagedGroups = groups.slice(offset, offset + pageSize);
  const total = groups.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const reimbursementByVoyageOwner = new Map();
  const reimbursementVoyages = reimbursementVoyagesResult?.results || [];
  reimbursementVoyages.forEach((voyage) => {
    const voyageId = Number(voyage.id || 0);
    if (!voyageId) return;
    // Prefer settlement lines so reimbursements always follow current fixed policy (ƒ50/lost Freight/Cargo).
    const settlementLines = parseSettlementLines(voyage.settlement_lines_json);
    if (settlementLines.length) {
      settlementLines.forEach((line) => {
        const ownerId = Number(line.ownerEmployeeId || 0);
        const lineLost = Boolean(line.isLost) || Number(line.lostQuantity || 0) > 0;
        const amount = lineLost ? Math.max(50, Math.max(0, toMoney(line.lostReimbursement || 0))) : Math.max(0, toMoney(line.lostReimbursement || 0));
        upsertReimbursementLine(reimbursementByVoyageOwner, voyageId, ownerId, line.ownerName, amount);
      });
      return;
    }

    // Fallback for legacy rows with only owner totals.
    const ownerTotals = parseOwnerTotals(voyage.settlement_owner_totals_json);
    ownerTotals.forEach((row) => {
      upsertReimbursementLine(
        reimbursementByVoyageOwner,
        voyageId,
        Number(row.ownerEmployeeId || 0),
        row.ownerName,
        Math.max(0, toMoney(row.reimbursementTotal || 0))
      );
    });
  });

  const reimbursementVoyageIds = [...new Set([...reimbursementByVoyageOwner.values()].map((row) => Number(row.voyageId || 0)).filter(Boolean))];
  const settledByVoyageOwner = new Map();
  if (reimbursementVoyageIds.length) {
    try {
      const placeholders = reimbursementVoyageIds.map(() => '?').join(', ');
      const settledResult = await env.DB
        .prepare(
          `SELECT voyage_id, owner_employee_id, SUM(amount) AS settled_amount
           FROM finance_reimbursement_settlements
           WHERE voyage_id IN (${placeholders})
           GROUP BY voyage_id, owner_employee_id`
        )
        .bind(...reimbursementVoyageIds)
        .all();
      (settledResult?.results || []).forEach((row) => {
        const key = `${Number(row.voyage_id || 0)}:${Number(row.owner_employee_id || 0)}`;
        settledByVoyageOwner.set(key, Math.max(0, toMoney(row.settled_amount || 0)));
      });
    } catch {
      // Table may not exist yet on a cold/mid-migration edge; treat as no settlements.
    }
  }

  const reimbursementsByOwner = new Map();
  [...reimbursementByVoyageOwner.values()].forEach((row) => {
    const key = `${Number(row.voyageId || 0)}:${Number(row.ownerEmployeeId || 0)}`;
    const settled = Math.max(0, toMoney(settledByVoyageOwner.get(key) || 0));
    const outstanding = Math.max(0, toMoney(Number(row.totalReimbursement || 0) - settled));
    if (outstanding <= 0) return;
    const ownerId = Number(row.ownerEmployeeId || 0);
    const existing = reimbursementsByOwner.get(ownerId) || {
      ownerEmployeeId: ownerId,
      ownerName: String(row.ownerName || '').trim() || `Employee #${ownerId}`,
      totalReimbursement: 0
    };
    existing.totalReimbursement = toMoney(existing.totalReimbursement + outstanding);
    reimbursementsByOwner.set(ownerId, existing);
  });

  const reimbursements = [...reimbursementsByOwner.values()].sort(
    (a, b) => b.totalReimbursement - a.totalReimbursement || a.ownerName.localeCompare(b.ownerName)
  );
  const reimbursementsTotal = toMoney(reimbursements.reduce((sum, row) => sum + Number(row.totalReimbursement || 0), 0));

  return cachedJson(
    request,
    {
      rows,
      groups: pagedGroups,
      totals: {
        unsettledOutstanding: toMoney(filteredRows.reduce((sum, row) => sum + row.companyShareAmount, 0)),
        unsettledVoyages: filteredRows.length,
        uniqueOotw: groups.length,
        reimbursementsTotal,
        netOutstandingAfterReimbursements: toMoney(
          filteredRows.reduce((sum, row) => sum + row.companyShareAmount, 0) - reimbursementsTotal
        )
      },
      reimbursements,
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
    { cacheControl: 'private, no-store' }
  );
}
