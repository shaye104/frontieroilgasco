import { json } from '../../../../auth/_lib/auth.js';
import { requirePermission } from '../../../_lib/admin-auth.js';

function toUserId(value) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function onRequestPost(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requirePermission(context, ['college.manage']);
  if (errorResponse) return errorResponse;

  const employeeId = toUserId(params?.userId);
  if (!employeeId) return json({ error: 'Invalid user id.' }, 400);

  let payload = {};
  try {
    payload = await context.request.json();
  } catch {
    payload = {};
  }

  const reason = String(payload?.reason || '').trim().slice(0, 300);
  const employee = await env.DB.prepare(`SELECT id FROM employees WHERE id = ?`).bind(employeeId).first();
  if (!employee) return json({ error: 'Employee not found.' }, 404);

  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE employees
         SET user_status = 'ACTIVE_STAFF',
             college_passed_at = COALESCE(college_passed_at, CURRENT_TIMESTAMP),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(employeeId),
    env.DB
      .prepare(
        `UPDATE college_enrollments
         SET status = CASE WHEN status = 'passed' THEN status ELSE 'completed' END,
             completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
             passed_at = COALESCE(passed_at, CURRENT_TIMESTAMP)
         WHERE user_employee_id = ?`
      )
      .bind(employeeId),
    env.DB
      .prepare(
        `DELETE FROM college_role_assignments
         WHERE employee_id = ? AND role_key = 'TRAINEE'`
      )
      .bind(employeeId),
    env.DB
      .prepare(
        `INSERT INTO college_audit_events
         (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
         VALUES (?, 'passed_override', ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(employeeId, Number(session.employee?.id || 0) || null, JSON.stringify({ reason }))
  ]);

  return json({ ok: true });
}
