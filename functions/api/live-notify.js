import { json, readSessionFromRequest } from './auth/_lib/auth.js';
import { ensureCoreSchema, getEmployeeByDiscordUserId } from './_lib/db.js';
import { enrichSessionWithPermissions, hasPermission } from './_lib/permissions.js';

function text(value) {
  return String(value || '').trim();
}

function toSeverity(value) {
  const normalized = text(value).toUpperCase();
  return normalized === 'URGENT' ? 'URGENT' : 'STANDARD';
}

function toTargetMode(value) {
  const normalized = text(value).toUpperCase();
  return normalized === 'SPECIFIC' ? 'SPECIFIC' : 'ALL';
}

function parseEmployeeIds(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

function isoAfterMinutes(minutes) {
  return new Date(Date.now() + Math.max(1, minutes) * 60_000).toISOString();
}

async function resolveSession(env, request) {
  const raw = await readSessionFromRequest(env, request);
  if (!raw) return null;
  return enrichSessionWithPermissions(env, raw);
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const session = await resolveSession(env, request);
  if (!session) return json({ error: 'Authentication required.' }, 401);

  await ensureCoreSchema(env);

  if (!hasPermission(session, 'voyages.read')) {
    return json({ error: 'Forbidden. Missing required permission.' }, 403);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const severity = toSeverity(payload?.severity);
  const title = text(payload?.title);
  const message = text(payload?.message);
  const targetMode = toTargetMode(payload?.targetMode);
  const targetEmployeeIds = parseEmployeeIds(payload?.employeeIds);

  if (!title || title.length > 120) return json({ error: 'Title is required (max 120 chars).' }, 400);
  if (!message || message.length > 1000) return json({ error: 'Message is required (max 1000 chars).' }, 400);
  if (targetMode === 'SPECIFIC' && !targetEmployeeIds.length) {
    return json({ error: 'Select at least one target employee.' }, 400);
  }

  let filteredTargetIds = targetEmployeeIds;
  if (targetMode === 'SPECIFIC') {
    const placeholders = targetEmployeeIds.map(() => '?').join(', ');
    const rows = await env.DB
      .prepare(`SELECT id FROM employees WHERE id IN (${placeholders})`)
      .bind(...targetEmployeeIds)
      .all();
    const valid = new Set((rows?.results || []).map((row) => Number(row.id)).filter((value) => Number.isInteger(value) && value > 0));
    filteredTargetIds = targetEmployeeIds.filter((id) => valid.has(id));
    if (!filteredTargetIds.length) return json({ error: 'No valid target employees found.' }, 400);
  }

  const senderEmployee =
    session?.employee?.id
      ? session.employee
      : await getEmployeeByDiscordUserId(env, String(session.userId || '').trim());
  const senderEmployeeId = Number(senderEmployee?.id || 0) || null;
  const senderName = text(senderEmployee?.roblox_username) || text(session.displayName) || text(session.userId) || 'Unknown';

  await env.DB.prepare(`DELETE FROM live_notifications WHERE COALESCE(expires_at, created_at) < CURRENT_TIMESTAMP`).run();

  const result = await env.DB
    .prepare(
      `INSERT INTO live_notifications
         (sender_employee_id, sender_name, severity, title, message, target_mode, target_json, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      senderEmployeeId,
      senderName,
      severity,
      title,
      message,
      targetMode,
      targetMode === 'SPECIFIC' ? JSON.stringify(filteredTargetIds) : null,
      isoAfterMinutes(30)
    )
    .run();

  const id = Number(result?.meta?.last_row_id || 0);
  return json({
    ok: true,
    notification: {
      id,
      severity,
      title,
      message,
      targetMode
    }
  });
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
