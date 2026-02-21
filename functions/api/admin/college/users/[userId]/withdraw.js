import { json } from '../../../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../../../_lib/college.js';

function toUserId(value) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function onRequestPost(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requireCollegeSession(context, {
    requiredAnyCapabilities: ['college:manage_users', 'college:admin']
  });
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
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(employeeId),
    env.DB
      .prepare(
        `INSERT INTO college_profiles
         (user_employee_id, trainee_status, start_at, due_at, passed_at, failed_at, assigned_by_user_employee_id, last_activity_at, created_at, updated_at)
         VALUES (?, 'TRAINEE_WITHDRAWN', CURRENT_TIMESTAMP, NULL, NULL, NULL, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(user_employee_id)
         DO UPDATE SET
           trainee_status = 'TRAINEE_WITHDRAWN',
           last_activity_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP,
           assigned_by_user_employee_id = COALESCE(excluded.assigned_by_user_employee_id, college_profiles.assigned_by_user_employee_id)`
      )
      .bind(employeeId, Number(session.employee?.id || 0) || null),
    env.DB
      .prepare(
        `UPDATE college_enrollments
         SET status = CASE WHEN LOWER(COALESCE(status, '')) IN ('passed','completed') THEN status ELSE 'withdrawn' END,
             withdrawn_at = COALESCE(withdrawn_at, CURRENT_TIMESTAMP)
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
         VALUES (?, 'trainee_withdrawn', ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(employeeId, Number(session.employee?.id || 0) || null, JSON.stringify({ reason }))
  ]);

  return json({ ok: true });
}
