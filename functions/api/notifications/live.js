import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { ensureCoreSchema, ensureLiveNotificationsSchema, getEmployeeByDiscordUserId } from '../_lib/db.js';
import { enrichSessionWithPermissions } from '../_lib/permissions.js';
import { readSiteSettings } from '../_lib/site-settings.js';

function text(value) {
  return String(value || '').trim();
}

function parseSinceId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : 0;
}

function parseTargetIds(targetJson) {
  try {
    const parsed = JSON.parse(String(targetJson || '[]'));
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  } catch {
    return [];
  }
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
  await env.DB.prepare(`DELETE FROM live_notifications WHERE COALESCE(expires_at, created_at) < CURRENT_TIMESTAMP`).run();

  const url = new URL(request.url);
  const sinceId = parseSinceId(url.searchParams.get('sinceId'));
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 25));

  const employee =
    session?.employee?.id
      ? session.employee
      : await getEmployeeByDiscordUserId(env, String(session.userId || '').trim());
  const employeeId = Number(employee?.id || 0);
  if (!employeeId) return json({ notifications: [], lastId: sinceId });

  const rows = await env.DB
    .prepare(
      `SELECT id, created_at, sender_employee_id, sender_name, severity, title, message, target_mode, target_json
       FROM live_notifications
       WHERE id > ?
       ORDER BY id ASC
       LIMIT ?`
    )
    .bind(sinceId, limit)
    .all();

  if (sinceId <= 0) {
    const bootstrapLastId = (rows?.results || []).reduce((max, row) => Math.max(max, Number(row.id || 0)), 0);
    const settings = await readSiteSettings(env);
    return json({
      notifications: [],
      lastId: bootstrapLastId,
      sounds: {
        standard: text(settings.notificationSoundStandardUrl),
        urgent: text(settings.notificationSoundUrgentUrl)
      }
    });
  }

  const notifications = (rows?.results || [])
    .filter((row) => {
      const mode = text(row.target_mode).toUpperCase();
      if (mode === 'ALL') return true;
      if (mode !== 'SPECIFIC') return false;
      return parseTargetIds(row.target_json).includes(employeeId);
    })
    .map((row) => ({
      id: Number(row.id),
      createdAt: row.created_at,
      senderEmployeeId: Number(row.sender_employee_id || 0) || null,
      senderName: text(row.sender_name) || 'System',
      severity: text(row.severity).toUpperCase() === 'URGENT' ? 'URGENT' : 'STANDARD',
      title: text(row.title),
      message: text(row.message)
    }));

  const lastId = (rows?.results || []).reduce((max, row) => Math.max(max, Number(row.id || 0)), sinceId);
  const settings = await readSiteSettings(env);

  return json({
    notifications,
    lastId,
    sounds: {
      standard: text(settings.notificationSoundStandardUrl),
      urgent: text(settings.notificationSoundUrgentUrl)
    }
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
