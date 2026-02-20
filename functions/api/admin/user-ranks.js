import { json } from '../auth/_lib/auth.js';
import { requirePermission } from './_lib/admin-auth.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLevel(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.floor(number);
}

async function listRanks(env) {
  const result = await env.DB
    .prepare(
      `SELECT id, value, level, description, updated_at, created_at
       FROM config_ranks
       ORDER BY level DESC, value ASC, id ASC`
    )
    .all();
  return result?.results || [];
}

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse } = await requirePermission(context, ['user_ranks.manage']);
  if (errorResponse) return errorResponse;

  return json({ ranks: await listRanks(env) });
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse } = await requirePermission(context, ['user_ranks.manage']);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const value = normalizeText(payload?.value);
  if (!value) return json({ error: 'Rank name is required.' }, 400);
  const level = normalizeLevel(payload?.level);
  const description = normalizeText(payload?.description);

  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO config_ranks (value, level, description, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(value, level, description)
    .run();

  return json({ ranks: await listRanks(env) }, 201);
}

export async function onRequestPut(context) {
  const { env } = context;
  const { errorResponse } = await requirePermission(context, ['user_ranks.manage']);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const id = Number(payload?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'Rank id is required.' }, 400);
  const value = normalizeText(payload?.value);
  if (!value) return json({ error: 'Rank name is required.' }, 400);
  const level = normalizeLevel(payload?.level);
  const description = normalizeText(payload?.description);

  await env.DB
    .prepare(
      `UPDATE config_ranks
       SET value = ?, level = ?, description = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(value, level, description, id)
    .run();

  return json({ ranks: await listRanks(env) });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const { errorResponse } = await requirePermission(context, ['user_ranks.manage']);
  if (errorResponse) return errorResponse;

  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'Rank id is required.' }, 400);

  const row = await env.DB.prepare('SELECT value FROM config_ranks WHERE id = ?').bind(id).first();
  if (!row) return json({ error: 'Rank not found.' }, 404);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM rank_permission_mappings WHERE LOWER(rank_value) = LOWER(?)').bind(normalizeText(row.value)),
    env.DB.prepare('DELETE FROM config_ranks WHERE id = ?').bind(id)
  ]);

  return json({ ranks: await listRanks(env) });
}
