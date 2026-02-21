import { json } from '../auth/_lib/auth.js';
import { requirePermission } from './_lib/admin-auth.js';
import { enrollEmployeeInRequiredCollegeCourses } from '../_lib/college.js';

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse } = await requirePermission(context, ['employees.access_requests.review']);
  if (errorResponse) return errorResponse;

  const url = new URL(context.request.url);
  const status = String(url.searchParams.get('status') || '').trim();

  let result;
  if (status) {
    result = await env.DB.prepare(
      `SELECT id, discord_user_id, discord_display_name, status, requested_at, reviewed_at, reviewed_by, review_note
       FROM access_requests
       WHERE status = ?
       ORDER BY requested_at DESC`
    )
      .bind(status)
      .all();
  } else {
    result = await env.DB.prepare(
      `SELECT id, discord_user_id, discord_display_name, status, requested_at, reviewed_at, reviewed_by, review_note
       FROM access_requests
       ORDER BY requested_at DESC`
    ).all();
  }

  return json({ requests: result?.results || [] });
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.access_requests.review']);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const id = Number(payload?.id);
  const action = String(payload?.action || '').trim().toLowerCase();

  if (!Number.isInteger(id) || id <= 0) return json({ error: 'id is required.' }, 400);
  if (!['approve_create', 'deny'].includes(action)) return json({ error: 'action must be approve_create or deny.' }, 400);

  const requestRow = await env.DB.prepare('SELECT * FROM access_requests WHERE id = ?').bind(id).first();
  if (!requestRow) return json({ error: 'Access request not found.' }, 404);

  if (action === 'deny') {
    await env.DB.prepare(
      `UPDATE access_requests
       SET status = 'denied', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, review_note = ?
       WHERE id = ?`
    )
      .bind(session.displayName || session.userId, String(payload?.reviewNote || '').trim(), id)
      .run();

    return json({ ok: true });
  }

  const employeePayload = payload?.employee || {};
  const employeeStatus = String(employeePayload?.employeeStatus || '').trim() || 'Applicant Accepted';
  const dueDays = Math.max(1, Math.min(60, Math.round(Number(payload?.collegeDueDays || 14) || 14)));

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO employees
         (discord_user_id, roblox_username, roblox_user_id, rank, grade, serial_number, employee_status, user_status, college_start_at, college_due_at, hire_date, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'APPLICANT_ACCEPTED', CURRENT_TIMESTAMP, datetime(CURRENT_TIMESTAMP, ?), ?, CURRENT_TIMESTAMP)`
      )
      .bind(
        requestRow.discord_user_id,
        String(employeePayload?.robloxUsername || '').trim(),
        String(employeePayload?.robloxUserId || '').trim(),
        String(employeePayload?.rank || '').trim(),
        String(employeePayload?.grade || '').trim(),
        String(employeePayload?.serialNumber || '').trim(),
        employeeStatus,
        `+${dueDays} days`,
        String(employeePayload?.hireDate || '').trim()
      ),
    env.DB
      .prepare(
        `UPDATE employees
         SET roblox_username = COALESCE(NULLIF(TRIM(?), ''), roblox_username),
             roblox_user_id = COALESCE(NULLIF(TRIM(?), ''), roblox_user_id),
             rank = COALESCE(NULLIF(TRIM(?), ''), rank),
             grade = COALESCE(NULLIF(TRIM(?), ''), grade),
             serial_number = COALESCE(NULLIF(TRIM(?), ''), serial_number),
             employee_status = COALESCE(NULLIF(TRIM(?), ''), employee_status),
             hire_date = COALESCE(NULLIF(TRIM(?), ''), hire_date),
             user_status = 'APPLICANT_ACCEPTED',
             college_start_at = COALESCE(college_start_at, CURRENT_TIMESTAMP),
             college_due_at = COALESCE(college_due_at, datetime(CURRENT_TIMESTAMP, ?)),
             college_passed_at = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE discord_user_id = ?`
      )
      .bind(
        String(employeePayload?.robloxUsername || '').trim(),
        String(employeePayload?.robloxUserId || '').trim(),
        String(employeePayload?.rank || '').trim(),
        String(employeePayload?.grade || '').trim(),
        String(employeePayload?.serialNumber || '').trim(),
        employeeStatus,
        String(employeePayload?.hireDate || '').trim(),
        `+${dueDays} days`,
        requestRow.discord_user_id
      ),
    env.DB
      .prepare(
        `UPDATE access_requests
         SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, review_note = ?
         WHERE id = ?`
      )
      .bind(session.displayName || session.userId, String(payload?.reviewNote || '').trim(), id)
  ]);

  const employee = await env.DB.prepare(`SELECT id FROM employees WHERE discord_user_id = ?`).bind(requestRow.discord_user_id).first();
  const employeeId = Number(employee?.id || 0);
  if (employeeId > 0) {
    const employeeRole = await env.DB.prepare(`SELECT id FROM app_roles WHERE role_key = 'employee' LIMIT 1`).first();
    if (employeeRole?.id) {
      await env.DB
        .prepare(`INSERT OR IGNORE INTO employee_role_assignments (employee_id, role_id) VALUES (?, ?)`)
        .bind(employeeId, Number(employeeRole.id))
        .run();
    }

    await enrollEmployeeInRequiredCollegeCourses(env, employeeId);
    await env.DB
      .prepare(
        `INSERT INTO college_audit_events
         (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
         VALUES (?, 'accepted', ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(
        employeeId,
        Number(session.employee?.id || 0) || null,
        JSON.stringify({
          accessRequestId: id,
          reviewNote: String(payload?.reviewNote || '').trim(),
          collegeDueDays: dueDays
        })
      )
      .run();
  }

  return json({ ok: true });
}
