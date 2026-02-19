import { json } from '../auth/_lib/auth.js';
import { requireAdmin } from './_lib/admin-auth.js';

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse } = await requireAdmin(context);
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
  const { errorResponse, session } = await requireAdmin(context);
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

  await env.DB.batch([
    env.DB.prepare(
      `INSERT OR IGNORE INTO employees
       (discord_user_id, roblox_username, roblox_user_id, rank, grade, serial_number, employee_status, hire_date, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).bind(
      requestRow.discord_user_id,
      String(employeePayload?.robloxUsername || '').trim(),
      String(employeePayload?.robloxUserId || '').trim(),
      String(employeePayload?.rank || '').trim(),
      String(employeePayload?.grade || '').trim(),
      String(employeePayload?.serialNumber || '').trim(),
      String(employeePayload?.employeeStatus || '').trim(),
      String(employeePayload?.hireDate || '').trim()
    ),
    env.DB.prepare(
      `UPDATE access_requests
       SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP, reviewed_by = ?, review_note = ?
       WHERE id = ?`
    ).bind(session.displayName || session.userId, String(payload?.reviewNote || '').trim(), id)
  ]);

  return json({ ok: true });
}
