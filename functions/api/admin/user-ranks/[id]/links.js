import { json } from '../../../auth/_lib/auth.js';
import { requirePermission } from '../../_lib/admin-auth.js';

function text(value) {
  return String(value || '').trim();
}

function parseRankId(params) {
  const rankId = Number(params?.id);
  if (!Number.isInteger(rankId) || rankId <= 0) return null;
  return rankId;
}

async function getRankOrNull(env, rankId) {
  return env.DB.prepare('SELECT id, value FROM config_ranks WHERE id = ?').bind(rankId).first();
}

async function loadLinksPayload(env, rankId) {
  const [discordLinksRows, groupLinksRows, appRolesRows] = await Promise.all([
    env.DB
      .prepare(
        `SELECT id, rank_id, discord_role_id, discord_role_name, guild_id, created_at
         FROM rank_discord_role_links
         WHERE rank_id = ?
         ORDER BY created_at DESC, id DESC`
      )
      .bind(rankId)
      .all(),
    env.DB
      .prepare(
        `SELECT id, rank_id, group_key, created_at
         FROM rank_group_links
         WHERE rank_id = ?
         ORDER BY created_at DESC, id DESC`
      )
      .bind(rankId)
      .all(),
    env.DB
      .prepare(
        `SELECT id, role_key, name
         FROM app_roles
         ORDER BY sort_order ASC, name ASC`
      )
      .all()
  ]);

  return {
    discordLinks: discordLinksRows?.results || [],
    groupLinks: groupLinksRows?.results || [],
    availableGroups: (appRolesRows?.results || []).map((row) => ({
      key: text(row.role_key) || text(row.name),
      label: text(row.name) || text(row.role_key),
      roleId: Number(row.id)
    }))
  };
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const { errorResponse } = await requirePermission(context, ['user_ranks.manage']);
  if (errorResponse) return errorResponse;

  const rankId = parseRankId(params);
  if (!rankId) return json({ error: 'Invalid rank id.' }, 400);
  const rank = await getRankOrNull(env, rankId);
  if (!rank) return json({ error: 'Rank not found.' }, 404);

  return json({
    rank: { id: Number(rank.id), value: text(rank.value) },
    ...(await loadLinksPayload(env, rankId))
  });
}

export async function onRequestPost(context) {
  const { env, params } = context;
  const { errorResponse } = await requirePermission(context, ['user_ranks.manage']);
  if (errorResponse) return errorResponse;

  const rankId = parseRankId(params);
  if (!rankId) return json({ error: 'Invalid rank id.' }, 400);
  const rank = await getRankOrNull(env, rankId);
  if (!rank) return json({ error: 'Rank not found.' }, 404);

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const linkType = text(payload?.linkType).toLowerCase();
  if (linkType === 'discord') {
    const discordRoleId = text(payload?.discordRoleId);
    if (!/^\d{6,30}$/.test(discordRoleId)) {
      return json({ error: 'Discord Role ID must be numeric.' }, 400);
    }
    const discordRoleName = text(payload?.discordRoleName) || null;
    const guildId = text(payload?.guildId) || null;
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO rank_discord_role_links (rank_id, discord_role_id, discord_role_name, guild_id)
         VALUES (?, ?, ?, ?)`
      )
      .bind(rankId, discordRoleId, discordRoleName, guildId)
      .run();
  } else if (linkType === 'group') {
    const groupKey = text(payload?.groupKey);
    if (!groupKey) return json({ error: 'Group key is required.' }, 400);
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO rank_group_links (rank_id, group_key)
         VALUES (?, ?)`
      )
      .bind(rankId, groupKey)
      .run();
  } else {
    return json({ error: 'Unsupported linkType.' }, 400);
  }

  return json({
    rank: { id: Number(rank.id), value: text(rank.value) },
    ...(await loadLinksPayload(env, rankId))
  });
}

export async function onRequestDelete(context) {
  const { env, params, request } = context;
  const { errorResponse } = await requirePermission(context, ['user_ranks.manage']);
  if (errorResponse) return errorResponse;

  const rankId = parseRankId(params);
  if (!rankId) return json({ error: 'Invalid rank id.' }, 400);
  const rank = await getRankOrNull(env, rankId);
  if (!rank) return json({ error: 'Rank not found.' }, 404);

  const url = new URL(request.url);
  const linkType = text(url.searchParams.get('linkType')).toLowerCase();
  if (linkType === 'discord') {
    const discordRoleId = text(url.searchParams.get('discordRoleId'));
    if (!discordRoleId) return json({ error: 'discordRoleId is required.' }, 400);
    await env.DB
      .prepare(`DELETE FROM rank_discord_role_links WHERE rank_id = ? AND discord_role_id = ?`)
      .bind(rankId, discordRoleId)
      .run();
  } else if (linkType === 'group') {
    const groupKey = text(url.searchParams.get('groupKey'));
    if (!groupKey) return json({ error: 'groupKey is required.' }, 400);
    await env.DB
      .prepare(`DELETE FROM rank_group_links WHERE rank_id = ? AND LOWER(group_key) = LOWER(?)`)
      .bind(rankId, groupKey)
      .run();
  } else {
    return json({ error: 'Unsupported linkType.' }, 400);
  }

  return json({
    rank: { id: Number(rank.id), value: text(rank.value) },
    ...(await loadLinksPayload(env, rankId))
  });
}
