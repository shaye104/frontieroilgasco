import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { ensureCoreSchema, ensureLiveNotificationsSchema, getEmployeeByDiscordUserId } from '../_lib/db.js';
import { enrichSessionWithPermissions, hasPermission } from '../_lib/permissions.js';

function text(value) {
  return String(value || '').trim();
}

async function resolveSession(env, request) {
  const raw = await readSessionFromRequest(env, request);
  if (!raw) return null;
  return enrichSessionWithPermissions(env, raw);
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const session = await resolveSession(env, request);
  if (!session) return json({ error: 'Authentication required.' }, 401);

  await ensureCoreSchema(env);
  await ensureLiveNotificationsSchema(env);

  if (!hasPermission(session, 'voyages.read')) {
    return json({ error: 'Forbidden. Missing required permission.' }, 403);
  }

  const employee =
    session?.employee?.id
      ? session.employee
      : await getEmployeeByDiscordUserId(env, String(session.userId || '').trim());
  if (!employee?.id) return json({ users: [] });

  await env.DB.prepare(`DELETE FROM live_notification_presence WHERE last_seen_at < datetime('now', '-120 seconds')`).run();

  const rows = await env.DB
    .prepare(
      `SELECT
         e.id,
         e.roblox_username,
         e.serial_number,
         e.rank,
         p.current_path,
         p.last_seen_at
       FROM live_notification_presence p
       JOIN employees e ON e.id = p.employee_id
       WHERE p.last_seen_at >= datetime('now', '-45 seconds')
         AND COALESCE(p.is_visible, 1) = 1
       ORDER BY LOWER(COALESCE(e.roblox_username, '')), e.id
       LIMIT 250`
    )
    .all();

  return json({
    users: (rows?.results || []).map((row) => ({
      id: Number(row.id),
      roblox_username: text(row.roblox_username),
      serial_number: text(row.serial_number),
      rank: text(row.rank),
      current_path: text(row.current_path) || '/',
      last_seen_at: row.last_seen_at
    }))
  });
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      allow: 'GET, OPTIONS'
    }
  });
}

export async function onRequest(context) {
  const method = String(context.request.method || '').toUpperCase();
  if (method === 'GET') return onRequestGet(context);
  if (method === 'OPTIONS') return onRequestOptions(context);
  return json({ error: 'Method not allowed.' }, 405);
}
