import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { ensureCoreSchema, ensureLiveNotificationsSchema, getEmployeeByDiscordUserId } from '../_lib/db.js';
import { enrichSessionWithPermissions } from '../_lib/permissions.js';

async function resolveSession(env, request) {
  const raw = await readSessionFromRequest(env, request);
  if (!raw) return null;
  return enrichSessionWithPermissions(env, raw);
}

function parseNotificationId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const session = await resolveSession(env, request);
  if (!session) return json({ error: 'Authentication required.' }, 401);

  await ensureCoreSchema(env);
  await ensureLiveNotificationsSchema(env);

  const employee =
    session?.employee?.id
      ? session.employee
      : await getEmployeeByDiscordUserId(env, String(session.userId || '').trim());
  const employeeId = Number(employee?.id || 0);
  if (!employeeId) return json({ error: 'Employee profile required.' }, 403);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const notificationId = parseNotificationId(payload?.notificationId);
  if (!notificationId) return json({ error: 'notificationId is required.' }, 400);

  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO live_notification_dismissals (notification_id, employee_id, dismissed_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(notificationId, employeeId)
    .run();

  return json({ ok: true, notificationId });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      allow: 'POST, OPTIONS'
    }
  });
}

export async function onRequest(context) {
  const method = String(context.request.method || '').toUpperCase();
  if (method === 'POST') return onRequestPost(context);
  if (method === 'OPTIONS') return onRequestOptions(context);
  return json({ error: 'Method not allowed.' }, 405);
}
