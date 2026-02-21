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
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(10, Number(url.searchParams.get('pageSize')) || 20));
  const offset = (page - 1) * pageSize;

  const totalRow = await env.DB
    .prepare(`SELECT COUNT(*) AS total FROM college_audit_events`)
    .first();
  const rows = await env.DB
    .prepare(
      `SELECT
         e.id,
         e.action,
         e.created_at,
         e.user_employee_id,
         e.performed_by_employee_id,
         e.meta_json,
         target.roblox_username AS target_name,
         actor.roblox_username AS actor_name
       FROM college_audit_events e
       LEFT JOIN employees target ON target.id = e.user_employee_id
       LEFT JOIN employees actor ON actor.id = e.performed_by_employee_id
       ORDER BY e.created_at DESC, e.id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(pageSize, offset)
    .all();

  return cachedJson(
    request,
    {
      ok: true,
      rows: (rows?.results || []).map((row) => ({
        id: Number(row.id || 0),
        action: text(row.action),
        createdAt: row.created_at || null,
        targetEmployeeId: Number(row.user_employee_id || 0) || null,
        targetName: text(row.target_name),
        performedByEmployeeId: Number(row.performed_by_employee_id || 0) || null,
        performedByName: text(row.actor_name),
        meta: (() => {
          try {
            return JSON.parse(row.meta_json || '{}');
          } catch {
            return {};
          }
        })()
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

