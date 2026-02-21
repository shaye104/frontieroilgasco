import { cachedJson } from '../auth/_lib/auth.js';
import { requireFinancePermission, toMoney } from '../_lib/finances.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requireFinancePermission(context, 'finances.audit.view');
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('pageSize')) || 25));
  const offset = (page - 1) * pageSize;

  const [rowsResult, totalRow] = await Promise.all([
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
           v.departure_port,
           v.destination_port
         FROM finance_settlement_audit fa
         LEFT JOIN employees se ON se.id = fa.settled_by_employee_id
         LEFT JOIN employees oow ON oow.id = fa.oow_employee_id
         LEFT JOIN voyages v ON v.id = fa.voyage_id
         ORDER BY fa.created_at DESC, fa.id DESC
         LIMIT ? OFFSET ?`
      )
      .bind(pageSize, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM finance_settlement_audit`).first()
  ]);

  const rows = (rowsResult?.results || []).map((row) => ({
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
    departurePort: String(row.departure_port || '').trim(),
    destinationPort: String(row.destination_port || '').trim()
  }));

  const total = Number(totalRow?.total || 0);
  return cachedJson(
    request,
    {
      rows,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      }
    },
    { cacheControl: 'private, max-age=20, stale-while-revalidate=40' }
  );
}
