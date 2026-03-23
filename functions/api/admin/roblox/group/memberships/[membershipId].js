import { json } from '../../../../auth/_lib/auth.js';
import { requirePermission } from '../../../_lib/admin-auth.js';
import { callRobloxGroupApi, parseRequestJson, requireRobloxGroupConfig } from '../../../_lib/roblox-group.js';

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

function parseRoleName(rawRoleName, rawRoleId) {
  const roleName = text(rawRoleName);
  if (roleName) return roleName;
  const roleId = text(rawRoleId).replace(/\D+/g, '');
  if (!roleId) return '';
  return `groups/roles/${roleId}`;
}

export async function onRequestPatch(context) {
  const { errorResponse } = await requirePermission(context, ['user_ranks.manage', 'employees.edit']);
  if (errorResponse) return errorResponse;

  const cfg = requireRobloxGroupConfig(context.env);
  if (!cfg.ok) return cfg.response;

  const payload = await parseRequestJson(context.request);
  const membershipName = parseMembershipName(context.params?.membershipId, cfg.groupId);
  const roleName = parseRoleName(payload?.roleName, payload?.roleId);

  if (!membershipName) return json({ error: 'Valid membership ID is required.' }, 400);
  if (!roleName) return json({ error: 'roleName or roleId is required.' }, 400);

  const result = await callRobloxGroupApi(context.env, `/${membershipName}`, {
    method: 'PATCH',
    body: {
      role: {
        path: roleName
      }
    }
  });
  if (!result.ok) {
    return json({ error: 'Failed to update group membership role.', details: result.error }, result.status || 502);
  }

  return json({ ok: true, membership: result.payload || {}, raw: result.payload || {} });
}
