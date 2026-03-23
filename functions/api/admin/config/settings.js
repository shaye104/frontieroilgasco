import { json } from '../../auth/_lib/auth.js';
import { requirePermission } from '../_lib/admin-auth.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requirePermission(context, ['config.manage']);
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const key = String(url.searchParams.get('key') || '').trim();
  if (key) {
    const row = await env.DB.prepare(`SELECT key, value, updated_at FROM config_settings WHERE key = ? LIMIT 1`).bind(key).first();
    return json({ item: row || null });
  }
  const rows = await env.DB.prepare(`SELECT key, value, updated_at FROM config_settings ORDER BY key ASC`).all();
  return json({ items: rows?.results || [] });
}

export async function onRequestPatch(context) {
  const { env } = context;
  const { errorResponse } = await requirePermission(context, ['config.manage']);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const key = String(payload?.key || '').trim();
  const value = String(payload?.value || '').trim();
  if (!key || !value) return json({ error: 'key and value are required.' }, 400);

  await env.DB
    .prepare(
      `INSERT INTO config_settings (key, value, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .bind(key, value)
    .run();

  const item = await env.DB.prepare(`SELECT key, value, updated_at FROM config_settings WHERE key = ? LIMIT 1`).bind(key).first();
  return json({ item });
}
