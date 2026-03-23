import { callRobloxGroupApi } from './roblox-group.js';

function text(value) {
  return String(value || '').trim();
}

function cleanDigits(value) {
  return text(value).replace(/\D+/g, '');
}

function normalizeRolePath(value) {
  const raw = text(value);
  if (!raw) return '';
  if (/^groups\/roles\/\d+$/i.test(raw)) return raw;
  const digits = cleanDigits(raw);
  if (!digits) return '';
  return `groups/roles/${digits}`;
}

function extractRobloxRolePath(groupKey) {
  const raw = text(groupKey);
  if (!raw) return '';
  if (/^groups\/roles\/\d+$/i.test(raw)) return raw;
  const lower = raw.toLowerCase();
  if (lower.startsWith('roblox_role_path:')) return normalizeRolePath(raw.split(':').slice(1).join(':'));
  if (lower.startsWith('roblox_role_id:')) return normalizeRolePath(raw.split(':').slice(1).join(':'));
  if (lower.startsWith('roblox_role:')) return normalizeRolePath(raw.split(':').slice(1).join(':'));
  return '';
}

function extractMembershipName(payload) {
  const rows = Array.isArray(payload?.groupMemberships) ? payload.groupMemberships : [];
  const first = rows[0] || null;
  const path = text(first?.path || first?.name);
  return path || '';
}

async function findMembershipNameByUserId(env, groupId, robloxUserId) {
  const userId = cleanDigits(robloxUserId);
  if (!groupId || !userId) return { ok: false, reason: 'missing_user' };
  const lookup = await callRobloxGroupApi(env, `/groups/${groupId}/memberships`, {
    method: 'GET',
    query: {
      maxPageSize: '1',
      filter: `user == 'users/${userId}'`
    }
  });
  if (!lookup.ok) {
    return { ok: false, reason: lookup.error || `lookup_http_${Number(lookup.status || 0)}` };
  }
  const membershipName = extractMembershipName(lookup.payload);
  if (!membershipName) return { ok: false, reason: 'not_in_group' };
  return { ok: true, membershipName };
}

export async function getRobloxRolePathForRank(env, rankValue) {
  const rank = text(rankValue);
  if (!rank) return '';
  const rankRow = await env.DB
    .prepare('SELECT id FROM config_ranks WHERE LOWER(value) = LOWER(?) LIMIT 1')
    .bind(rank)
    .first();
  const rankId = Number(rankRow?.id || 0);
  if (!rankId) return '';
  const linksRows = await env.DB
    .prepare(
      `SELECT group_key
       FROM rank_group_links
       WHERE rank_id = ?
       ORDER BY id DESC`
    )
    .bind(rankId)
    .all();
  const links = linksRows?.results || [];
  for (const row of links) {
    const rolePath = extractRobloxRolePath(row?.group_key);
    if (rolePath) return rolePath;
  }
  return '';
}

export async function syncRobloxRoleForEmployee(env, { robloxUserId, rankValue }) {
  const userId = cleanDigits(robloxUserId);
  if (!userId) return { ok: false, skipped: true, reason: 'missing_roblox_user_id' };

  const rolePath = await getRobloxRolePathForRank(env, rankValue);
  if (!rolePath) return { ok: false, skipped: true, reason: 'rank_not_mapped' };

  const groupId = Number(env?.ROBLOX_GROUP_ID || 0);
  if (!groupId) return { ok: false, skipped: true, reason: 'missing_group_config' };

  const membershipLookup = await findMembershipNameByUserId(env, groupId, userId);
  if (!membershipLookup.ok) return { ok: false, skipped: true, reason: membershipLookup.reason || 'membership_lookup_failed' };

  const patchResult = await callRobloxGroupApi(env, `/${membershipLookup.membershipName}`, {
    method: 'PATCH',
    body: { role: { path: rolePath } }
  });
  if (!patchResult.ok) {
    return {
      ok: false,
      skipped: false,
      reason: patchResult.error || `patch_http_${Number(patchResult.status || 0)}`,
      status: Number(patchResult.status || 0) || null
    };
  }

  return {
    ok: true,
    skipped: false,
    reason: 'updated',
    rolePath,
    membershipName: membershipLookup.membershipName
  };
}

export async function removeRobloxGroupMemberForEmployee(env, { robloxUserId }) {
  const userId = cleanDigits(robloxUserId);
  if (!userId) return { ok: false, skipped: true, reason: 'missing_roblox_user_id' };

  const groupId = Number(env?.ROBLOX_GROUP_ID || 0);
  if (!groupId) return { ok: false, skipped: true, reason: 'missing_group_config' };

  const membershipLookup = await findMembershipNameByUserId(env, groupId, userId);
  if (!membershipLookup.ok) return { ok: false, skipped: true, reason: membershipLookup.reason || 'membership_lookup_failed' };

  const removeResult = await callRobloxGroupApi(env, `/${membershipLookup.membershipName}`, { method: 'DELETE' });
  if (!removeResult.ok) {
    return {
      ok: false,
      skipped: false,
      reason: removeResult.error || `delete_http_${Number(removeResult.status || 0)}`,
      status: Number(removeResult.status || 0) || null
    };
  }

  return {
    ok: true,
    skipped: false,
    reason: 'removed',
    membershipName: membershipLookup.membershipName
  };
}
