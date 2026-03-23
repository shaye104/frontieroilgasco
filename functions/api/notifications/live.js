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

function parseBit(value, fallback = 1) {
  const raw = String(value ?? '').trim();
  if (raw === '1') return 1;
  if (raw === '0') return 0;
  return fallback;
}

function normalizePath(value) {
  const raw = String(value || '').trim();
  if (!raw.startsWith('/')) return '/';
  if (raw.length > 120) return raw.slice(0, 120);
  return raw;
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
  await env.DB
    .prepare(
      `DELETE FROM live_notification_dismissals
       WHERE notification_id IN (
         SELECT id FROM live_notifications
         WHERE COALESCE(expires_at, created_at) < CURRENT_TIMESTAMP
       )`
    )
    .run();
  await env.DB.prepare(`DELETE FROM live_notifications WHERE COALESCE(expires_at, created_at) < CURRENT_TIMESTAMP`).run();

  const url = new URL(request.url);
  const sinceId = parseSinceId(url.searchParams.get('sinceId'));
  const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 25));
  const currentPath = normalizePath(url.searchParams.get('path'));
  const isVisible = parseBit(url.searchParams.get('visible'), 1);
  const isFocused = parseBit(url.searchParams.get('focused'), isVisible);
  const isPageActive = isVisible && isFocused ? 1 : 0;

  const employee =
    session?.employee?.id
      ? session.employee
      : await getEmployeeByDiscordUserId(env, String(session.userId || '').trim());
  const employeeId = Number(employee?.id || 0);
  if (!employeeId) return json({ notifications: [], lastId: sinceId });

  await env.DB
    .prepare(
      `INSERT INTO live_notification_presence (employee_id, current_path, is_visible, last_seen_at, user_agent)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP, ?)
       ON CONFLICT(employee_id) DO UPDATE SET
         current_path = CASE
           WHEN excluded.is_visible = 1 THEN excluded.current_path
           ELSE live_notification_presence.current_path
         END,
         is_visible = excluded.is_visible,
         last_seen_at = excluded.last_seen_at,
         user_agent = excluded.user_agent`
    )
    .bind(employeeId, currentPath, isPageActive, String(request.headers.get('user-agent') || '').slice(0, 255))
    .run();

  const latestPresenceEvent = await env.DB
    .prepare(
      `SELECT current_path, is_visible, happened_at
       FROM live_notification_presence_events
       WHERE employee_id = ?
       ORDER BY happened_at DESC, id DESC
       LIMIT 1`
    )
    .bind(employeeId)
    .first();

  const latestEventAtMs = (() => {
    const raw = String(latestPresenceEvent?.happened_at || '').trim();
    if (!raw) return 0;
    const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
    const parsed = Date.parse(/[zZ]|[+-]\d{2}:\d{2}$/.test(iso) ? iso : `${iso}Z`);
    return Number.isFinite(parsed) ? parsed : 0;
  })();
  const latestEventAgeSeconds = latestEventAtMs ? Math.max(0, Math.floor((Date.now() - latestEventAtMs) / 1000)) : 9999;
  const latestEventPath = normalizePath(latestPresenceEvent?.current_path);
  const latestEventVisible = Number(latestPresenceEvent?.is_visible || 0) === 1 ? 1 : 0;
  const shouldWritePresenceEvent =
    latestEventAgeSeconds >= 20 || latestEventPath !== currentPath || latestEventVisible !== isPageActive;

  if (shouldWritePresenceEvent) {
    await env.DB
      .prepare(
        `INSERT INTO live_notification_presence_events (employee_id, current_path, is_visible, happened_at)
         VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(employeeId, currentPath, isPageActive)
      .run();
  }

  await env.DB.prepare(`DELETE FROM live_notification_presence WHERE last_seen_at < datetime('now', '-120 seconds')`).run();
  await env.DB
    .prepare(`DELETE FROM live_notification_presence_events WHERE happened_at < datetime('now', '-75 minutes')`)
    .run();

  if (sinceId <= 0) {
    const [latestRow, recentRows, settings] = await Promise.all([
      env.DB.prepare(`SELECT COALESCE(MAX(id), 0) AS max_id FROM live_notifications`).first(),
      env.DB
        .prepare(
          `SELECT ln.id, ln.created_at, ln.expires_at, ln.sender_employee_id, ln.sender_name, ln.severity, ln.title, ln.message, ln.target_mode, ln.target_json
           FROM live_notifications ln
           LEFT JOIN live_notification_dismissals lnd
             ON lnd.notification_id = ln.id
            AND lnd.employee_id = ?
           WHERE COALESCE(ln.expires_at, ln.created_at) >= CURRENT_TIMESTAMP
             AND lnd.notification_id IS NULL
           ORDER BY ln.id ASC
           LIMIT 20`
        )
        .bind(employeeId)
        .all(),
      readSiteSettings(env)
    ]);

    const notifications = (recentRows?.results || [])
      .filter((row) => {
        const mode = text(row.target_mode).toUpperCase();
        if (mode === 'ALL') return true;
        if (mode !== 'SPECIFIC') return false;
        return parseTargetIds(row.target_json).includes(employeeId);
      })
      .map((row) => ({
        id: Number(row.id),
        createdAt: row.created_at,
        expiresAt: row.expires_at,
        senderEmployeeId: Number(row.sender_employee_id || 0) || null,
        senderName: text(row.sender_name) || 'System',
        severity: text(row.severity).toUpperCase() === 'URGENT' ? 'URGENT' : 'STANDARD',
        title: text(row.title),
        message: text(row.message)
      }));

    return json({
      notifications,
      lastId: Number(latestRow?.max_id || 0),
      sounds: {
        standard: text(settings.notificationSoundStandardUrl),
        urgent: text(settings.notificationSoundUrgentUrl)
      }
    });
  }

  const [rows, latestSinceRow] = await Promise.all([
    env.DB
      .prepare(
        `SELECT ln.id, ln.created_at, ln.expires_at, ln.sender_employee_id, ln.sender_name, ln.severity, ln.title, ln.message, ln.target_mode, ln.target_json
         FROM live_notifications ln
         LEFT JOIN live_notification_dismissals lnd
           ON lnd.notification_id = ln.id
          AND lnd.employee_id = ?
         WHERE ln.id > ?
           AND lnd.notification_id IS NULL
         ORDER BY ln.id ASC
         LIMIT ?`
      )
      .bind(employeeId, sinceId, limit)
      .all(),
    env.DB.prepare(`SELECT COALESCE(MAX(id), 0) AS max_id FROM live_notifications WHERE id > ?`).bind(sinceId).first()
  ]);

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
      expiresAt: row.expires_at,
      senderEmployeeId: Number(row.sender_employee_id || 0) || null,
      senderName: text(row.sender_name) || 'System',
      severity: text(row.severity).toUpperCase() === 'URGENT' ? 'URGENT' : 'STANDARD',
      title: text(row.title),
      message: text(row.message)
    }));

  const lastId = Math.max(sinceId, Number(latestSinceRow?.max_id || 0));
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
