import { json } from '../../../../../auth/_lib/auth.js';
import { requirePermission } from '../../../../_lib/admin-auth.js';
import { callRobloxGroupApi, requireRobloxGroupConfig } from '../../../../_lib/roblox-group.js';

function text(value) {
  return String(value || '').trim();
}

function parseMembershipName(input, groupId) {
  const raw = text(input);
  if (!raw) return '';
  if (raw.startsWith('groups/')) return raw;
  if (!/^\d+$/.test(raw)) return '';
  return `groups/${Number(groupId)}/memberships/${raw}`;
}

export async function onRequestPost(context) {
  const { errorResponse } = await requirePermission(context, ['user_ranks.manage', 'employees.edit']);
  if (errorResponse) return errorResponse;

  const cfg = requireRobloxGroupConfig(context.env);
  if (!cfg.ok) return cfg.response;

  const membershipName = parseMembershipName(context.params?.membershipId, cfg.groupId);
  if (!membershipName) return json({ error: 'Valid membership ID is required.' }, 400);

  const result = await callRobloxGroupApi(context.env, `/${membershipName}`, { method: 'DELETE' });
  if (!result.ok) {
    return json(
      {
        error: 'Failed to remove user from group.',
        details: result.error
      },
      result.status || 502
    );
  }

  return json({ ok: true, removed: true, membershipName });
}
