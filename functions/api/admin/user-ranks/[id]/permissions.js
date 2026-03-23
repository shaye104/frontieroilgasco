import { json } from '../../../auth/_lib/auth.js';
import { ADMIN_OVERRIDE_PERMISSION, getPermissionCatalog, normalizePermissionKeys } from '../../../_lib/permissions.js';
import { requirePermission } from '../../_lib/admin-auth.js';

function text(value) {
  return String(value || '').trim();
}

function parseRankId(params) {
  const rankId = Number(params?.id);
  if (!Number.isInteger(rankId) || rankId <= 0) return null;
  return rankId;
}

function canManageAdminOverride(env, session) {
  const ownerId = String(env.OWNER_DISCORD_ID || env.ADMIN_DISCORD_USER_ID || '').trim();
  return Boolean(ownerId) && String(session?.userId || '') === ownerId;
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requirePermission(context, ['user_ranks.manage']);
  if (errorResponse) return errorResponse;
  const rankId = parseRankId(params);
  if (!rankId) return json({ error: 'Invalid rank id.' }, 400);

  const rank = await env.DB.prepare('SELECT id, value FROM config_ranks WHERE id = ?').bind(rankId).first();
  if (!rank) return json({ error: 'Rank not found.' }, 404);
  const rankValue = text(rank.value);

  const mappingRows = await env.DB
    .prepare(
      `SELECT permission_key
       FROM rank_permission_mappings
       WHERE LOWER(rank_value) = LOWER(?)
       ORDER BY permission_key ASC`
    )
    .bind(rankValue)
    .all();

  const isOwner = canManageAdminOverride(env, session);
  return json({
    rank: { id: Number(rank.id), value: rankValue },
    permissions: getPermissionCatalog().filter((permission) => isOwner || permission.key !== ADMIN_OVERRIDE_PERMISSION),
    assignedPermissionKeys: (mappingRows?.results || []).map((row) => text(row.permission_key)).filter(Boolean)
  });
}

export async function onRequestPut(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requirePermission(context, ['user_ranks.manage']);
  if (errorResponse) return errorResponse;
  const rankId = parseRankId(params);
  if (!rankId) return json({ error: 'Invalid rank id.' }, 400);

  const rank = await env.DB.prepare('SELECT id, value FROM config_ranks WHERE id = ?').bind(rankId).first();
  if (!rank) return json({ error: 'Rank not found.' }, 404);
  const rankValue = text(rank.value);

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const permissionKeys = normalizePermissionKeys(payload?.permissionKeys || []);
  const isOwner = canManageAdminOverride(env, session);
  const existingRows = await env.DB
    .prepare('SELECT permission_key FROM rank_permission_mappings WHERE LOWER(rank_value) = LOWER(?)')
    .bind(rankValue)
    .all();
  const existing = new Set((existingRows?.results || []).map((row) => text(row.permission_key)).filter(Boolean));
  if (!isOwner && (permissionKeys.includes(ADMIN_OVERRIDE_PERMISSION) || existing.has(ADMIN_OVERRIDE_PERMISSION))) {
    return json({ error: 'Only OWNER_DISCORD_ID can grant or revoke admin.override.' }, 403);
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM rank_permission_mappings WHERE LOWER(rank_value) = LOWER(?)').bind(rankValue),
    ...permissionKeys.map((permissionKey) =>
      env.DB.prepare('INSERT OR IGNORE INTO rank_permission_mappings (rank_value, permission_key) VALUES (?, ?)').bind(rankValue, permissionKey)
    )
  ]);

  return json({
    rank: { id: Number(rank.id), value: rankValue },
    assignedPermissionKeys: permissionKeys
  });
}

// Backward compatibility for cached clients using PATCH.
export async function onRequestPatch(context) {
  return onRequestPut(context);
}
