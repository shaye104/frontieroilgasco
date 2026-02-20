import { json } from '../auth/_lib/auth.js';
import { requirePermission } from './_lib/admin-auth.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requirePermission(context, ['activity_tracker.view']);
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('pageSize')) || 50));
  const offset = (page - 1) * pageSize;
  const search = String(url.searchParams.get('search') || '').trim().toLowerCase();
  const thresholdRaw = url.searchParams.get('lessThan');
  const lessThan = thresholdRaw === null ? null : Number(thresholdRaw);
  const scope = String(url.searchParams.get('scope') || 'monthly').trim().toLowerCase() === 'all_time' ? 'all_time' : 'monthly';

  const whereParts = [];
  const bindParams = [];
  if (search) {
    whereParts.push('(LOWER(COALESCE(e.roblox_username, \'\')) LIKE ? OR LOWER(COALESCE(e.serial_number, \'\')) LIKE ?)');
    bindParams.push(`%${search}%`, `%${search}%`);
  }
  if (Number.isFinite(lessThan) && lessThan >= 0) {
    whereParts.push(`${scope === 'all_time' ? 'COALESCE(vs.total_voyages, 0)' : 'COALESCE(vs.monthly_voyages, 0)'} < ?`);
    bindParams.push(Math.floor(lessThan));
  }
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const sql = `
    WITH voyage_stats AS (
      SELECT
        vp.employee_id,
        COUNT(DISTINCT v.id) AS total_voyages,
        COUNT(
          DISTINCT CASE
            WHEN datetime(v.ended_at, 'localtime') >= datetime('now', 'localtime', 'start of month')
              AND datetime(v.ended_at, 'localtime') < datetime('now', 'localtime', 'start of month', '+1 month')
            THEN v.id
          END
        ) AS monthly_voyages
      FROM voyage_participants vp
      INNER JOIN voyages v ON v.id = vp.voyage_id
      WHERE v.status = 'ENDED'
      GROUP BY vp.employee_id
    )
    SELECT
      e.id,
      e.roblox_username,
      e.serial_number,
      e.rank,
      COALESCE(vs.total_voyages, 0) AS total_voyages,
      COALESCE(vs.monthly_voyages, 0) AS monthly_voyages
    FROM employees e
    LEFT JOIN voyage_stats vs ON vs.employee_id = e.id
    ${whereSql}
    ORDER BY monthly_voyages DESC, total_voyages DESC, e.roblox_username ASC, e.id ASC
    LIMIT ? OFFSET ?`;

  const rows = await env.DB.prepare(sql).bind(...bindParams, pageSize, offset).all();
  const totalRow = await env.DB
    .prepare(
      `WITH voyage_stats AS (
         SELECT
           vp.employee_id,
           COUNT(DISTINCT v.id) AS total_voyages,
           COUNT(
             DISTINCT CASE
               WHEN datetime(v.ended_at, 'localtime') >= datetime('now', 'localtime', 'start of month')
                 AND datetime(v.ended_at, 'localtime') < datetime('now', 'localtime', 'start of month', '+1 month')
               THEN v.id
             END
           ) AS monthly_voyages
         FROM voyage_participants vp
         INNER JOIN voyages v ON v.id = vp.voyage_id
         WHERE v.status = 'ENDED'
         GROUP BY vp.employee_id
       )
       SELECT COUNT(*) AS total
       FROM employees e
       LEFT JOIN voyage_stats vs ON vs.employee_id = e.id
       ${whereSql}`
    )
    .bind(...bindParams)
    .first();

  return json({
    employees: rows?.results || [],
    pagination: {
      page,
      pageSize,
      total: Number(totalRow?.total || 0)
    }
  });
}
