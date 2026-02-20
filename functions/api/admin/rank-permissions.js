import { json } from '../auth/_lib/auth.js';
import { ADMIN_OVERRIDE_PERMISSION, getPermissionCatalog, normalizePermissionKeys } from '../_lib/permissions.js';
import { requirePermission } from './_lib/admin-auth.js';

function text(value) {
  return String(value || '').trim();
}

function canManageAdminOverride(env, session) {
  const ownerId = String(env.OWNER_DISCORD_ID || env.ADMIN_DISCORD_USER_ID || '').trim();
  return Boolean(ownerId) && String(session?.userId || '') === ownerId;
}

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse, session } = await requirePermission(context, ['user_ranks.permissions.manage']);
  if (errorResponse) return errorResponse;
  const isOwner = canManageAdminOverride(env, session);

  const [rankRows, mappingRows] = await Promise.all([
    env.DB.prepare('SELECT id, value FROM config_ranks ORDER BY value ASC, id ASC').all(),
    env.DB.prepare('SELECT rank_value, permission_key FROM rank_permission_mappings ORDER BY rank_value ASC, permission_key ASC').all()
  ]);

  const mappingsByRank = {};
  (mappingRows?.results || []).forEach((row) => {
    const key = text(row.rank_value);
    if (!key) return;
    if (!mappingsByRank[key]) mappingsByRank[key] = [];
    mappingsByRank[key].push(row.permission_key);
  });

  return json({
    ranks: rankRows?.results || [],
    permissions: getPermissionCatalog().filter((permission) => isOwner || permission.key !== ADMIN_OVERRIDE_PERMISSION),
    mappingsByRank
  });
}

export async function onRequestPut(context) {
  const { env } = context;
  const { errorResponse, session } = await requirePermission(context, ['user_ranks.permissions.manage']);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const rankValue = text(payload?.rankValue);
  const permissionKeys = normalizePermissionKeys(payload?.permissionKeys || []);
  if (!rankValue) return json({ error: 'rankValue is required.' }, 400);
  const isOwner = canManageAdminOverride(env, session);
  const existingRows = await env.DB
    .prepare('SELECT permission_key FROM rank_permission_mappings WHERE LOWER(rank_value) = LOWER(?)')
    .bind(rankValue)
    .all();
  const existing = new Set((existingRows?.results || []).map((row) => String(row.permission_key || '').trim()));
  if (!isOwner && (permissionKeys.includes(ADMIN_OVERRIDE_PERMISSION) || existing.has(ADMIN_OVERRIDE_PERMISSION))) {
    return json({ error: 'Only OWNER_DISCORD_ID can grant or revoke admin.override.' }, 403);
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM rank_permission_mappings WHERE LOWER(rank_value) = LOWER(?)').bind(rankValue),
    ...permissionKeys.map((permissionKey) =>
      env.DB
        .prepare('INSERT OR IGNORE INTO rank_permission_mappings (rank_value, permission_key) VALUES (?, ?)')
        .bind(rankValue, permissionKey)
    )
  ]);

  const rows = await env.DB
    .prepare('SELECT permission_key FROM rank_permission_mappings WHERE LOWER(rank_value) = LOWER(?) ORDER BY permission_key ASC')
    .bind(rankValue)
    .all();

  return json({
    rankValue,
    permissionKeys: (rows?.results || []).map((row) => row.permission_key)
  });
}
