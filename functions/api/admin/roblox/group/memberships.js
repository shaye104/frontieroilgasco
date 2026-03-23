import { json } from '../../../auth/_lib/auth.js';
import { requirePermission } from '../../_lib/admin-auth.js';
import { callRobloxGroupApi, cleanRobloxUserId, requireRobloxGroupConfig } from '../../_lib/roblox-group.js';

function toPageSize(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 25;
  return Math.max(1, Math.min(100, Math.floor(n)));
}

export async function onRequestGet(context) {
  const { errorResponse } = await requirePermission(context, ['user_ranks.manage', 'employees.edit']);
  if (errorResponse) return errorResponse;

  const cfg = requireRobloxGroupConfig(context.env);
  if (!cfg.ok) return cfg.response;

  const url = new URL(context.request.url);
  const pageSize = toPageSize(url.searchParams.get('pageSize'));
  const pageToken = String(url.searchParams.get('pageToken') || '').trim();
  const userId = cleanRobloxUserId(url.searchParams.get('userId'));

  const query = {
    maxPageSize: String(pageSize),
    pageToken
  };
  if (userId) query.filter = `user == 'users/${userId}'`;

  const result = await callRobloxGroupApi(context.env, `/groups/${cfg.groupId}/memberships`, {
    method: 'GET',
    query
  });

  if (!result.ok) {
    return json({ error: 'Failed to load group memberships.', details: result.error }, result.status || 502);
  }

  return json({
    ok: true,
    groupId: cfg.groupId,
    memberships: Array.isArray(result.payload?.groupMemberships) ? result.payload.groupMemberships : [],
    nextPageToken: String(result.payload?.nextPageToken || ''),
    raw: result.payload || {}
  });
}
