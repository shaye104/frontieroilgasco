import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { ensureCoreSchema, getEmployeeByDiscordUserId, writeAdminActivityEvent } from '../_lib/db.js';

function text(value) {
  return String(value || '').trim();
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const session = await readSessionFromRequest(env, request);
  if (!session) return json({ error: 'Authentication required.' }, 401);

  await ensureCoreSchema(env);
  const employee = await getEmployeeByDiscordUserId(env, session.userId);
  if (!employee) return json({ error: 'Employee profile not found.' }, 404);

  const activationStatus = String(employee.activation_status || '').trim().toUpperCase() || 'PENDING';
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
         AND (LOWER(COALESCE(roblox_username, '')) = LOWER(?) OR TRIM(COALESCE(roblox_user_id, '')) = ?)
       LIMIT 1`
    )
    .bind(employee.id, robloxUsername, robloxUserId)
    .first();
  if (duplicate?.id) {
    return json({ error: 'Roblox Username or User ID is already in use.' }, 400);
  }

  await env.DB
    .prepare(
      `UPDATE employees
       SET roblox_user_id = ?,
           roblox_username = ?,
           activation_status = 'PENDING',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(robloxUserId, robloxUsername, employee.id)
    .run();

  await env.DB
    .prepare(`INSERT INTO employee_notes (employee_id, note, authored_by) VALUES (?, ?, ?)`)
    .bind(employee.id, '[System] ONBOARDING_SUBMITTED: User submitted Roblox profile for activation.', session.displayName || session.userId)
    .run();

  await writeAdminActivityEvent(env, {
    actorEmployeeId: employee.id,
    actorName: session.displayName || session.userId,
    actorDiscordUserId: session.userId,
    actionType: 'ONBOARDING_SUBMITTED',
    targetEmployeeId: employee.id,
    summary: 'User submitted Roblox profile for activation.',
    metadata: {
      robloxUserId,
      robloxUsername
    }
  });

  return json({ success: true });
}
