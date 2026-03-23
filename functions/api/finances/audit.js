import { cachedJson } from '../auth/_lib/auth.js';
import { normalizeTzOffsetMinutes, requireFinancePermission, toMoney, toUtcBoundaryFromLocalDateInput } from '../_lib/finances.js';
import { hasPermission } from '../_lib/permissions.js';

function compareAuditRows(a, b) {
  const aTime = Date.parse(String(a?.createdAt || '').trim());
  const bTime = Date.parse(String(b?.createdAt || '').trim());
  const safeA = Number.isFinite(aTime) ? aTime : 0;
  const safeB = Number.isFinite(bTime) ? bTime : 0;
  if (safeA !== safeB) return safeB - safeA;
  return Number(b?.id || 0) - Number(a?.id || 0);
}

async function hasLegacyFinanceEntries(env) {
  const row = await env.DB
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_finance_entries'")
    .first();
  return Boolean(row?.name);
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse, session } = await requireFinancePermission(context, 'finances.audit.view');
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('pageSize')) || 25));
  const offset = (page - 1) * pageSize;
  const tzOffsetMinutes = normalizeTzOffsetMinutes(url.searchParams.get('tzOffsetMinutes'));
  const settledBy = String(url.searchParams.get('settledBy') || '').trim().toLowerCase();
  const dateFrom = toUtcBoundaryFromLocalDateInput(url.searchParams.get('dateFrom'), false, tzOffsetMinutes);
  const dateTo = toUtcBoundaryFromLocalDateInput(url.searchParams.get('dateTo'), true, tzOffsetMinutes);

  const whereClauses = [];
  const bindings = [];
  if (settledBy) {
    whereClauses.push(`(
      LOWER(COALESCE(se.roblox_username, '')) LIKE ?
      OR LOWER(COALESCE(fa.settled_by_discord_user_id, '')) LIKE ?
    )`);
    const search = `%${settledBy}%`;
    bindings.push(search, search);
  }
  if (dateFrom) {
    whereClauses.push('fa.created_at >= ?');
    bindings.push(dateFrom);
  }
  if (dateTo) {
    whereClauses.push('fa.created_at <= ?');
    bindings.push(dateTo);
  }
  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const [rowsResult, legacyRowsResult] = await Promise.all([
    env.DB
      .prepare(
        `SELECT
           fa.id,
           fa.created_at,
           fa.action,
           ROUND(COALESCE(fa.amount, 0)) AS amount,
           fa.voyage_id,
           fa.settled_by_discord_user_id,
           se.roblox_username AS settled_by_name,
           oow.roblox_username AS oow_name,
           oow.serial_number AS oow_serial,
           v.vessel_name,
           v.vessel_callsign,
           v.sell_location_name,
           v.departure_port,
           v.destination_port
         FROM finance_settlement_audit fa
         LEFT JOIN employees se ON se.id = fa.settled_by_employee_id
         LEFT JOIN employees oow ON oow.id = fa.oow_employee_id
         LEFT JOIN voyages v ON v.id = fa.voyage_id
         ${whereSql}
         ORDER BY fa.created_at DESC, fa.id DESC`
      )
      .bind(...bindings)
      .all(),
    hasLegacyFinanceEntries(env)
      ? env.DB
          .prepare(
            `SELECT
               id,
               record_date,
               voyage_id,
               entry_type,
               from_username,
               to_username,
               amount_florins,
               notes,
               solved_by_username,
               status
             FROM legacy_finance_entries
             WHERE (? = '' OR LOWER(COALESCE(solved_by_username, '')) LIKE ?)
               AND (? IS NULL OR (record_date || 'T00:00:00.000Z') >= ?)
               AND (? IS NULL OR (record_date || 'T23:59:59.999Z') <= ?)
             ORDER BY record_date DESC, id DESC`
          )
          .bind(
            settledBy,
            settledBy ? `%${settledBy}%` : '',
            dateFrom || null,
            dateFrom || null,
            dateTo || null,
            dateTo || null
          )
          .all()
      : Promise.resolve({ results: [] })
  ]);

  const currentRows = (rowsResult?.results || []).map((row) => ({
    id: Number(row.id),
    createdAt: row.created_at,
    action: String(row.action || ''),
    amount: toMoney(row.amount || 0),
    voyageId: Number(row.voyage_id || 0),
    settledByName: String(row.settled_by_name || 'Unknown').trim() || 'Unknown',
    settledByDiscordId: String(row.settled_by_discord_user_id || '').trim(),
    oowName: String(row.oow_name || 'Unknown').trim() || 'Unknown',
    oowSerial: String(row.oow_serial || '').trim(),
    vesselName: String(row.vessel_name || '').trim(),
    vesselCallsign: String(row.vessel_callsign || '').trim(),
    sellLocationName: String(row.sell_location_name || '').trim(),
    departurePort: String(row.departure_port || '').trim(),
    destinationPort: String(row.destination_port || '').trim()
  }));

  const legacyRows = (legacyRowsResult?.results || []).map((row) => {
    const status = String(row.status || '').trim().toUpperCase();
    const actionPrefix = status === 'UNSOLVED' ? 'LEGACY_UNSOLVED' : 'LEGACY_SOLVED';
    return {
      id: Number(row.id || 0) * -1,
      createdAt: `${String(row.record_date || '').trim()}T00:00:00.000Z`,
      action: `${actionPrefix}:${String(row.entry_type || '').trim() || 'ENTRY'}`,
      amount: toMoney(row.amount_florins || 0),
      voyageId: Number(row.voyage_id || 0),
      settledByName: String(row.solved_by_username || 'Legacy').trim() || 'Legacy',
      settledByDiscordId: '',
      oowName: String(row.from_username || '').trim() || 'Unknown',
      oowSerial: '',
      vesselName: 'Legacy',
      vesselCallsign: '',
      sellLocationName: String(row.to_username || '').trim(),
      departurePort: '',
      destinationPort: ''
    };
  });

  const merged = [...currentRows, ...legacyRows].sort(compareAuditRows);
  const total = merged.length;
  const rows = merged.slice(offset, offset + pageSize);

  return cachedJson(
    request,
    {
      rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      },
      permissions: {
        canDelete: hasPermission(session, 'finances.audit.delete')
      }
    },
    { cacheControl: 'private, max-age=20, stale-while-revalidate=40' }
  );
}
