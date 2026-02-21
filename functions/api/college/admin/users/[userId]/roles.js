import { json } from '../../../../auth/_lib/auth.js';
import { COLLEGE_ROLE_KEYS, normalizeCollegeRoleKey, requireCollegeSession } from '../../../../_lib/college.js';

function toId(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function uniqueRoles(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map((value) => normalizeCollegeRoleKey(value)).filter(Boolean))];
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const { errorResponse } = await requireCollegeSession(context, { requireManage: true });
  if (errorResponse) return errorResponse;

  const employeeId = toId(params?.userId);
  if (!employeeId) return json({ error: 'Invalid user id.' }, 400);

  const rows = await env.DB
    .prepare(`SELECT role_key FROM college_role_assignments WHERE employee_id = ? ORDER BY role_key ASC`)
    .bind(employeeId)
    .all();

  return json({
    ok: true,
    availableRoles: COLLEGE_ROLE_KEYS,
    roles: (rows?.results || [])
      .map((row) => normalizeCollegeRoleKey(row.role_key))
      .filter(Boolean)
  });
}

export async function onRequestPost(context) {
  const { env, params, request } = context;
  const { errorResponse, session } = await requireCollegeSession(context, { requireManage: true });
  if (errorResponse) return errorResponse;

  const employeeId = toId(params?.userId);
  if (!employeeId) return json({ error: 'Invalid user id.' }, 400);

  const employee = await env.DB.prepare(`SELECT id FROM employees WHERE id = ?`).bind(employeeId).first();
  if (!employee) return json({ error: 'Employee not found.' }, 404);

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  const roles = uniqueRoles(payload?.roles);

  await env.DB
    .prepare(`DELETE FROM college_role_assignments WHERE employee_id = ?`)
    .bind(employeeId)
    .run();

  if (roles.length) {
    await env.DB.batch(
      roles.map((roleKey) =>
        env.DB
          .prepare(
            `INSERT INTO college_role_assignments
             (employee_id, role_key, assigned_by_employee_id, created_at, updated_at)
             VALUES (?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
          )
          .bind(employeeId, roleKey, Number(session.employee?.id || 0) || null)
      )
    );
  }

  await env.DB
    .prepare(
      `INSERT INTO college_audit_events
       (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
       VALUES (?, 'role_update', ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(employeeId, Number(session.employee?.id || 0) || null, JSON.stringify({ roles }))
    .run();

  return json({ ok: true, roles });
}

