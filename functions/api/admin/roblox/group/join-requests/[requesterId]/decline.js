import { json } from '../../../../../auth/_lib/auth.js';
import { requirePermission } from '../../../../_lib/admin-auth.js';
import { callRobloxGroupApi, cleanRobloxUserId, requireRobloxGroupConfig } from '../../../../_lib/roblox-group.js';

export async function onRequestPost(context) {
  const { errorResponse } = await requirePermission(context, ['user_ranks.manage', 'employees.edit']);
  if (errorResponse) return errorResponse;

  const cfg = requireRobloxGroupConfig(context.env);
  if (!cfg.ok) return cfg.response;

  const requesterId = cleanRobloxUserId(context.params?.requesterId);
  if (!requesterId) return json({ error: 'Requester ID is required.' }, 400);

  const result = await callRobloxGroupApi(context.env, `/groups/${cfg.groupId}/join-requests/${requesterId}:decline`, {
    method: 'POST'
  });
  if (!result.ok) {
    return json({ error: 'Failed to decline join request.', details: result.error }, result.status || 502);
  }

  return json({ ok: true, declined: true, requesterId, groupId: cfg.groupId, raw: result.payload || {} });
}
