import { json } from '../../../../auth/_lib/auth.js';
import { requirePermission } from '../../../_lib/admin-auth.js';

function toUserId(value) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function toFutureIso(value) {
  const date = value ? new Date(String(value)) : null;
  if (!date || Number.isNaN(date.getTime())) return null;
  return date.toISOString();
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
  const days = Number(payload?.days);
  const customDueAt = toFutureIso(payload?.dueAt);

  let dueAtIso = customDueAt;
  if (!dueAtIso && Number.isFinite(days) && days > 0) {
    const target = new Date();
    target.setUTCDate(target.getUTCDate() + Math.round(days));
    dueAtIso = target.toISOString();
  }
  if (!dueAtIso) return json({ error: 'Provide dueAt or days > 0.' }, 400);

  const employee = await env.DB.prepare(`SELECT id FROM employees WHERE id = ?`).bind(employeeId).first();
  if (!employee) return json({ error: 'Employee not found.' }, 404);

  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE employees
         SET college_due_at = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(dueAtIso, employeeId),
    env.DB
      .prepare(
        `INSERT INTO college_audit_events
         (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
         VALUES (?, 'due_extended', ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(employeeId, Number(session.employee?.id || 0) || null, JSON.stringify({ dueAt: dueAtIso, reason }))
  ]);

  return json({ ok: true, dueAt: dueAtIso });
}
