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
      `SELECT
         r.id,
         r.value,
         r.level,
         r.description,
         r.updated_at,
         r.created_at,
         COALESCE((
           SELECT COUNT(*)
           FROM rank_discord_role_links drl
           WHERE drl.rank_id = r.id
         ), 0) AS discord_links_count,
         COALESCE((
           SELECT COUNT(*)
           FROM rank_group_links rgl
           WHERE rgl.rank_id = r.id
         ), 0) AS group_links_count,
         COALESCE((
           SELECT COUNT(*)
           FROM rank_permission_mappings rpm
           WHERE LOWER(rpm.rank_value) = LOWER(r.value)
         ), 0) AS permission_count
       FROM config_ranks r
       ORDER BY r.level DESC, r.value ASC, r.id ASC`
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

  const createResult = await env.DB
    .prepare(
      `INSERT INTO config_ranks (value, level, description, updated_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(value, level, description)
    .run();
  const createdId = Number(createResult?.meta?.last_row_id || 0);

  return json({ ranks: await listRanks(env), createdId: Number.isInteger(createdId) && createdId > 0 ? createdId : null }, 201);
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

// Backward compatibility: older clients may still PATCH this endpoint.
export async function onRequestPatch(context) {
  return onRequestPut(context);
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
    env.DB.prepare('DELETE FROM rank_discord_role_links WHERE rank_id = ?').bind(id),
    env.DB.prepare('DELETE FROM rank_group_links WHERE rank_id = ?').bind(id),
    env.DB.prepare('DELETE FROM config_ranks WHERE id = ?').bind(id)
  ]);

  return json({ ranks: await listRanks(env) });
}
