import { cachedJson } from '../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../_lib/college.js';

function text(value) {
  return String(value || '').trim();
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requireCollegeSession(context, { requireManage: true });
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const search = text(url.searchParams.get('search')).toLowerCase();
  const status = text(url.searchParams.get('status')).toUpperCase();
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(10, Number(url.searchParams.get('pageSize')) || 20));
  const offset = (page - 1) * pageSize;

  const where = [];
  const binds = [];
  if (search) {
    const term = `%${search}%`;
    where.push(`(
      LOWER(COALESCE(e.roblox_username, '')) LIKE ?
      OR LOWER(COALESCE(e.serial_number, '')) LIKE ?
      OR LOWER(COALESCE(e.discord_user_id, '')) LIKE ?
    )`);
    binds.push(term, term, term);
  }
  if (status) {
    where.push(`UPPER(COALESCE(e.user_status, 'ACTIVE_STAFF')) = ?`);
    binds.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await env.DB
    .prepare(
      `SELECT COUNT(*) AS total
       FROM employees e
       ${whereSql}`
    )
    .bind(...binds)
    .first();

  const rowsResult = await env.DB
    .prepare(
      `SELECT
         e.id,
         e.discord_user_id,
         e.roblox_username,
         e.serial_number,
         e.rank,
         e.user_status,
         e.college_due_at,
         e.college_passed_at,
         GROUP_CONCAT(cra.role_key) AS college_roles
       FROM employees e
       LEFT JOIN college_role_assignments cra ON cra.employee_id = e.id
       ${whereSql}
       GROUP BY e.id
       ORDER BY e.updated_at DESC, e.id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, pageSize, offset)
    .all();

  return cachedJson(
    request,
    {
      ok: true,
      rows: (rowsResult?.results || []).map((row) => ({
        id: Number(row.id || 0),
        discordUserId: text(row.discord_user_id),
        robloxUsername: text(row.roblox_username),
        serialNumber: text(row.serial_number),
        rank: text(row.rank),
        userStatus: text(row.user_status || 'ACTIVE_STAFF').toUpperCase(),
        collegeDueAt: row.college_due_at || null,
        collegePassedAt: row.college_passed_at || null,
        collegeRoles: text(row.college_roles)
          .split(',')
          .map((entry) => text(entry).toUpperCase())
          .filter(Boolean)
      })),
      pagination: {
        page,
        pageSize,
        total: Number(totalRow?.total || 0),
        totalPages: Math.max(1, Math.ceil(Number(totalRow?.total || 0) / pageSize))
      }
    },
    { cacheControl: 'private, max-age=10, stale-while-revalidate=20' }
  );
}

