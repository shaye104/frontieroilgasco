import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { normalizeDiscordUserId, writeAdminActivityEvent } from '../_lib/db.js';

function text(value) {
  return String(value || '').trim();
}

export async function onRequestPost(context) {
  const startedAt = Date.now();
  const { env, request } = context;
  const session = await readSessionFromRequest(env, request);
  if (!session) return json({ error: 'Authentication required.' }, 401);

  const normalizedDiscordUserId = normalizeDiscordUserId(session.userId);
  const employee = await env.DB
    .prepare(`SELECT id, activation_status, activated_at FROM employees WHERE discord_user_id = ? LIMIT 1`)
    .bind(normalizedDiscordUserId)
    .first();
  if (!employee) return json({ error: 'Employee profile not found.' }, 404);

  const activationStatus = text(employee.activation_status).toUpperCase() || 'PENDING';
  if (activationStatus !== 'PENDING') {
    return json({ error: 'Onboarding is only available for pending accounts.' }, 400);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const robloxUserId = text(payload?.robloxUserId);
  const robloxUsername = text(payload?.robloxUsername);
  if (!/^\d{1,30}$/.test(robloxUserId)) {
    return json({ error: 'Roblox User ID must be digits only.' }, 400);
  }
  if (!robloxUsername) {
    return json({ error: 'Roblox Username is required.' }, 400);
  }

  const duplicate = await env.DB
    .prepare(
      `SELECT id
       FROM employees
       WHERE id != ?
         AND (
           LOWER(COALESCE(roblox_username, '')) = LOWER(?)
           OR TRIM(COALESCE(roblox_user_id, '')) = ?
         )
       LIMIT 1`
    )
    .bind(employee.id, robloxUsername, robloxUserId)
    .first();
  if (duplicate?.id) {
    return json({ error: 'Roblox Username or User ID is already in use.' }, 400);
  }

  const nowIso = new Date().toISOString();
  await env.DB
    .prepare(
      `UPDATE employees
       SET roblox_user_id = ?,
           roblox_username = ?,
           onboarding_submitted_at = CURRENT_TIMESTAMP,
           onboarding_review_note = NULL,
           activation_status = 'PENDING',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(robloxUserId, robloxUsername, employee.id)
    .run();

  await writeAdminActivityEvent(env, {
    actorEmployeeId: Number(employee.id),
    actorName: session.displayName || session.userId,
    actorDiscordUserId: session.userId,
    actionType: 'ONBOARDING_SUBMITTED',
    targetEmployeeId: Number(employee.id),
    summary: 'User submitted Roblox profile for activation.',
    metadata: { robloxUserId, robloxUsername }
  });

  const durationMs = Date.now() - startedAt;
  console.log('api_onboarding_submit', JSON.stringify({ durationMs, employeeId: employee.id }));
  return new Response(
    JSON.stringify({
      success: true,
      employee: {
        id: Number(employee.id),
        status: 'SUBMITTED',
        activationStatus: 'PENDING',
        robloxUserId,
        robloxUsername,
        submittedAt: nowIso,
        activatedAt: text(employee.activated_at),
        reviewNote: ''
      }
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'Server-Timing': `app;dur=${durationMs}`,
        'x-response-time-ms': String(durationMs)
      }
    }
  );
}
