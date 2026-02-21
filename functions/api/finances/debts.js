import { cachedJson } from '../auth/_lib/auth.js';
import { requireFinancePermission, toMoney } from '../_lib/finances.js';
import { hasPermission } from '../_lib/permissions.js';

function normalizeSearch(value) {
  return String(value || '').trim().toLowerCase();
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse, session } = await requireFinancePermission(context, 'finances.view');
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const search = normalizeSearch(url.searchParams.get('search'));
  const minOutstanding = Math.max(0, Number(url.searchParams.get('minOutstanding')) || 0);

  const rowsResult = await env.DB
    .prepare(
      `SELECT
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
       WHERE v.status = 'ENDED'
         AND COALESCE(v.company_share_status, 'UNSETTLED') = 'UNSETTLED'
         AND ROUND(COALESCE(v.company_share_amount, v.company_share, 0)) > 0
       ORDER BY company_share_amount DESC, v.ended_at DESC, v.id DESC`
    )
    .all();

  const baseRows = (rowsResult?.results || []).map((row) => ({
    id: Number(row.id),
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
  }));

  const filteredRows = baseRows.filter((row) => {
    if (row.companyShareAmount < minOutstanding) return false;
    if (!search) return true;
    const hay = `${row.officerName} ${row.officerSerial} ${row.vesselName} ${row.vesselCallsign} ${row.departurePort} ${row.destinationPort}`.toLowerCase();
    return hay.includes(search);
  });

  const grouped = new Map();
  filteredRows.forEach((row) => {
    const key = row.officerEmployeeId || `unknown-${row.officerName}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        officerEmployeeId: row.officerEmployeeId,
        officerName: row.officerName,
        officerSerial: row.officerSerial,
        outstandingTotal: 0,
        voyages: []
      });
    }
    const group = grouped.get(key);
    group.outstandingTotal += row.companyShareAmount;
    group.voyages.push({
      voyageId: row.id,
      vesselName: row.vesselName,
      vesselCallsign: row.vesselCallsign,
      departurePort: row.departurePort,
      destinationPort: row.destinationPort,
      endedAt: row.endedAt,
      companyShareAmount: row.companyShareAmount,
      companyShareStatus: row.companyShareStatus
    });
  });

  const groups = [...grouped.values()]
    .map((group) => ({
      ...group,
      outstandingTotal: toMoney(group.outstandingTotal),
      voyageCount: group.voyages.length,
      voyages: group.voyages.sort((a, b) => {
        const aTime = new Date(a.endedAt || 0).getTime();
        const bTime = new Date(b.endedAt || 0).getTime();
        return bTime - aTime || b.companyShareAmount - a.companyShareAmount;
      })
    }))
    .sort((a, b) => b.outstandingTotal - a.outstandingTotal || b.voyageCount - a.voyageCount || a.officerName.localeCompare(b.officerName));

  return cachedJson(
    request,
    {
      groups,
      totals: {
        unsettledOutstanding: toMoney(groups.reduce((sum, row) => sum + row.outstandingTotal, 0)),
        unsettledVoyages: filteredRows.length
      },
      permissions: {
        canSettle: hasPermission(session, 'finances.debts.settle'),
        canViewAudit: hasPermission(session, 'finances.audit.view')
      }
    },
    { cacheControl: 'private, max-age=20, stale-while-revalidate=40' }
  );
}
