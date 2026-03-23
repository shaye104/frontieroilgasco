import { json } from '../../../auth/_lib/auth.js';
import { requirePermission } from '../../_lib/admin-auth.js';
import { callRobloxGroupApi, requireRobloxGroupConfig } from '../../_lib/roblox-group.js';

export async function onRequestGet(context) {
  const { errorResponse } = await requirePermission(context, ['user_ranks.manage', 'employees.edit']);
  if (errorResponse) return errorResponse;

  const cfg = requireRobloxGroupConfig(context.env);
  if (!cfg.ok) return cfg.response;

  const result = await callRobloxGroupApi(context.env, `/groups/${cfg.groupId}/roles`, { method: 'GET' });
  if (!result.ok) {
    return json({ error: 'Failed to load Roblox group roles.', details: result.error }, result.status || 502);
  }

  return json({
    ok: true,
    groupId: cfg.groupId,
    roles: Array.isArray(result.payload?.groupRoles) ? result.payload.groupRoles : [],
    raw: result.payload || {}
  });
}
