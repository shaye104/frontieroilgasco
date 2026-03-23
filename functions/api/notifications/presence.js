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
         p.is_visible,
         p.last_seen_at
       FROM live_notification_presence p
       JOIN employees e ON e.id = p.employee_id
       WHERE p.last_seen_at >= datetime('now', '-150 seconds')
       ORDER BY LOWER(COALESCE(e.roblox_username, '')), e.id
       LIMIT 250`
    )
    .all();

  const users = (rows?.results || []).map((row) => ({
    id: Number(row.id),
    roblox_username: text(row.roblox_username),
    serial_number: text(row.serial_number),
    rank: text(row.rank),
    current_path: text(row.current_path) || '/',
    is_visible: Number(row.is_visible || 0) === 1,
    last_seen_at: row.last_seen_at
  }));
  const userIds = users.map((row) => Number(row.id || 0)).filter((value) => Number.isInteger(value) && value > 0);

  let eventsByUser = new Map();
  if (userIds.length) {
    const placeholders = userIds.map(() => '?').join(', ');
    const eventRows = await env.DB
      .prepare(
        `SELECT employee_id, current_path, happened_at
         FROM live_notification_presence_events
         WHERE employee_id IN (${placeholders})
           AND happened_at >= datetime('now', '-60 minutes')
         ORDER BY employee_id ASC, happened_at DESC, id DESC`
      )
      .bind(...userIds)
      .all();

    const parseUtc = (value) => {
      const raw = String(value || '').trim();
      if (!raw) return 0;
      const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
      const parsed = Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const byId = new Map();
    for (const row of eventRows?.results || []) {
      const employeeId = Number(row.employee_id || 0);
      if (!employeeId) continue;
      if (!byId.has(employeeId)) byId.set(employeeId, []);
      byId.get(employeeId).push({
        path: text(row.current_path) || '/',
        happened_at: row.happened_at,
        _ts: parseUtc(row.happened_at)
      });
    }

    const nowMs = Date.now();
    for (const [employeeId, timeline] of byId.entries()) {
      const compact = [];
      for (let index = 0; index < timeline.length; index += 1) {
        const current = timeline[index];
        const previous = compact[compact.length - 1];
        if (previous && previous.path === current.path) continue;
        const nextTs = index === 0 ? nowMs : timeline[index - 1]._ts || nowMs;
        const currentTs = current._ts || nextTs;
        compact.push({
          path: current.path,
          entered_at: current.happened_at,
          left_at: new Date(nextTs).toISOString(),
          duration_seconds: Math.max(0, Math.floor((nextTs - currentTs) / 1000))
        });
      }
      eventsByUser.set(employeeId, compact.slice(0, 12));
    }
  }

  return json({
    users: users.map((row) => ({
      ...row,
      timeline: eventsByUser.get(row.id) || []
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
