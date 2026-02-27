import { json } from '../auth/_lib/auth.js';
import { requirePermission } from './_lib/admin-auth.js';

function text(value) {
  return String(value || '').trim();
}

function toCsv(rows) {
  const header = ['employeeId', 'robloxUsername', 'serialNumber', 'rank', 'grade', 'totalVoyages', 'oowVoyages', 'crewVoyages', 'lastVoyageAt'];
  const lines = [header.join(',')];
  for (const row of rows) {
    const values = [
      row.employeeId,
      row.robloxUsername || '',
      row.serialNumber || '',
      row.rank || '',
      row.grade || '',
      row.totalVoyages || 0,
      row.oowVoyages || 0,
      row.crewVoyages || 0,
      row.lastVoyageAt || ''
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`);
    lines.push(values.join(','));
  }
  return lines.join('\n');
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requirePermission(context, ['activity_tracker.view']);
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('pageSize')) || 25));
  const offset = (page - 1) * pageSize;
  const search = text(url.searchParams.get('search')).toLowerCase();
  const dateFrom = text(url.searchParams.get('dateFrom'));
  const dateTo = text(url.searchParams.get('dateTo'));
  const minVoyages = Math.max(0, Number(url.searchParams.get('minVoyages')) || 0);
  const quotaFilter = text(url.searchParams.get('quotaFilter')).toLowerCase();
  const format = text(url.searchParams.get('format')).toLowerCase();

  const statsWhere = [`v.status = 'ENDED'`, `v.deleted_at IS NULL`];
  const statsBinds = [];
  if (dateFrom) {
    statsWhere.push('DATE(v.ended_at) >= DATE(?)');
    statsBinds.push(dateFrom);
  }
  if (dateTo) {
    statsWhere.push('DATE(v.ended_at) <= DATE(?)');
    statsBinds.push(dateTo);
  }

  const where = [];
  const binds = [...statsBinds];
  if (search) {
    where.push(`(
      LOWER(COALESCE(e.roblox_username, '')) LIKE ?
      OR LOWER(COALESCE(e.roblox_user_id, '')) LIKE ?
      OR LOWER(COALESCE(e.serial_number, '')) LIKE ?
    )`);
    binds.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (minVoyages > 0) {
    where.push('COALESCE(stats.total_voyages, 0) >= ?');
    binds.push(minVoyages);
  }
  if (quotaFilter === 'met') {
    where.push('COALESCE(stats.total_voyages, 0) >= ?');
    binds.push(Math.max(1, minVoyages || 1));
  } else if (quotaFilter === 'not_met') {
    where.push('COALESCE(stats.total_voyages, 0) < ?');
    binds.push(Math.max(1, minVoyages || 1));
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const statsWhereSql = statsWhere.join(' AND ');

  const baseSql = `
    WITH stats AS (
      SELECT
        vp.employee_id,
        COUNT(DISTINCT vp.voyage_id) AS total_voyages,
        SUM(CASE WHEN vp.role_in_voyage = 'OOW' THEN 1 ELSE 0 END) AS oow_voyages,
        SUM(CASE WHEN vp.role_in_voyage = 'CREW' THEN 1 ELSE 0 END) AS crew_voyages,
        MAX(v.ended_at) AS last_voyage_at
      FROM voyage_participants vp
      INNER JOIN voyages v ON v.id = vp.voyage_id
      WHERE ${statsWhereSql}
      GROUP BY vp.employee_id
    )
    SELECT
      e.id AS employee_id,
      e.roblox_username,
      e.serial_number,
      e.rank,
      e.grade,
      COALESCE(stats.total_voyages, 0) AS total_voyages,
      COALESCE(stats.oow_voyages, 0) AS oow_voyages,
      COALESCE(stats.crew_voyages, 0) AS crew_voyages,
      stats.last_voyage_at
    FROM employees e
    LEFT JOIN stats ON stats.employee_id = e.id
    ${whereSql}`;

  if (format === 'csv') {
    const exportRows = await env.DB
      .prepare(`${baseSql} ORDER BY total_voyages DESC, e.roblox_username ASC, e.id ASC LIMIT 2000`)
      .bind(...binds)
      .all();
    const rows = (exportRows?.results || []).map((row) => ({
      employeeId: Number(row.employee_id || 0),
      robloxUsername: row.roblox_username || null,
      serialNumber: row.serial_number || null,
      rank: row.rank || null,
      grade: row.grade || null,
      totalVoyages: Number(row.total_voyages || 0),
      oowVoyages: Number(row.oow_voyages || 0),
      crewVoyages: Number(row.crew_voyages || 0),
      lastVoyageAt: row.last_voyage_at || null
    }));
    return new Response(toCsv(rows), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'cache-control': 'no-store',
        'content-disposition': `attachment; filename=\"activity-tracker-${new Date().toISOString().slice(0, 10)}.csv\"`
      }
    });
  }

  const [rowsResult, totalResult] = await Promise.all([
    env.DB
      .prepare(`${baseSql} ORDER BY total_voyages DESC, e.roblox_username ASC, e.id ASC LIMIT ? OFFSET ?`)
      .bind(...binds, pageSize, offset)
      .all(),
    env.DB
      .prepare(`SELECT COUNT(*) AS total FROM (${baseSql})`)
      .bind(...binds)
      .first()
  ]);

  const total = Number(totalResult?.total || 0);
  const rows = (rowsResult?.results || []).map((row) => ({
    employeeId: Number(row.employee_id || 0),
    robloxUsername: row.roblox_username || null,
    serialNumber: row.serial_number || null,
    rank: row.rank || null,
    grade: row.grade || null,
    totalVoyages: Number(row.total_voyages || 0),
    oowVoyages: Number(row.oow_voyages || 0),
    crewVoyages: Number(row.crew_voyages || 0),
    lastVoyageAt: row.last_voyage_at || null,
    meetsQuota: Number(row.total_voyages || 0) >= Math.max(1, minVoyages || 1)
  }));

  return json({
    rows,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    }
  });
}

