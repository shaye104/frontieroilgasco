import { json } from '../../../auth/_lib/auth.js';
import { requirePermission } from '../../_lib/admin-auth.js';
import {
  canEditEmployeeByRank,
  getEmployeeByDiscordUserId,
  getLinkedRanksForDiscordRoles,
  getMappedRoleIdsForRankIds,
  writeAdminActivityEvent
} from '../../../_lib/db.js';
import { hasHierarchyBypass } from '../../_lib/access-scope.js';
import { fetchGuildMemberRoleIds } from '../../../_lib/discord-members.js';

function text(value) {
  return String(value || '').trim();
}

export async function onRequestPost(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.edit']);
  if (errorResponse) return errorResponse;

  const employeeId = Number(params.id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return json({ error: 'Invalid employee id.' }, 400);

  const target = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  if (!target) return json({ error: 'Employee not found.' }, 404);

  if (!String(target.roblox_user_id || '').trim() || !String(target.roblox_username || '').trim()) {
    return json({ error: 'Roblox User ID and Roblox Username are required before activation.' }, 400);
  }

  const actor = await getEmployeeByDiscordUserId(env, session.userId);
  const canEditByRank = actor ? await canEditEmployeeByRank(env, actor, target, { allowSelf: false, allowEqual: false }) : false;
  if (!hasHierarchyBypass(env, session) && !canEditByRank) {
    return json({ error: 'You can only activate profiles beneath your hierarchy.' }, 403);
  }

  // Resolve website rank from Discord roles using rank links (highest rank level wins).
  let linkedRank = null;
  let mappedRoleIds = [];
  const roleLookup = await fetchGuildMemberRoleIds(env, target.discord_user_id);
  if (roleLookup.ok && roleLookup.roleIds.length) {
    const linkedRanks = await getLinkedRanksForDiscordRoles(env, roleLookup.roleIds);
    linkedRank = Array.isArray(linkedRanks) && linkedRanks.length ? linkedRanks[0] : null;
    if (linkedRank?.id) {
      mappedRoleIds = await getMappedRoleIdsForRankIds(env, [Number(linkedRank.id)]);
    }
  }

  await env.DB
    .prepare(
      `UPDATE employees
       SET activation_status = 'ACTIVE',
           employee_status = 'ACTIVE',
           user_status = 'ACTIVE',
           rank = COALESCE(?, rank),
           activated_at = CURRENT_TIMESTAMP,
           activated_by_employee_id = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(linkedRank?.value ? text(linkedRank.value) : null, actor?.id || null, employeeId)
    .run();

  if (mappedRoleIds.length) {
    await env.DB.batch(
      [...new Set(mappedRoleIds)]
        .map((roleId) => Number(roleId))
        .filter((roleId) => Number.isInteger(roleId) && roleId > 0)
        .map((roleId) => env.DB.prepare('INSERT OR IGNORE INTO employee_role_assignments (employee_id, role_id) VALUES (?, ?)').bind(employeeId, roleId))
    );
  }

  await env.DB
    .prepare(`INSERT INTO employee_notes (employee_id, note, authored_by) VALUES (?, ?, ?)`)
    .bind(
      employeeId,
      `[System] EMPLOYEE_ACTIVATED: Account activated by ${session.displayName || session.userId}.${linkedRank?.value ? ` Rank synced to "${text(linkedRank.value)}" from Discord role links.` : ''}${!roleLookup.ok ? ` Role sync warning: ${text(roleLookup.error)}` : ''}`,
      session.displayName || session.userId
    )
    .run();

  await writeAdminActivityEvent(env, {
    actorEmployeeId: actor?.id || null,
    actorName: session.displayName || session.userId,
    actorDiscordUserId: session.userId,
    actionType: 'EMPLOYEE_ACTIVATED',
    targetEmployeeId: employeeId,
    summary: `Activated employee ${target.roblox_username || `#${employeeId}`}.`,
    metadata: {
      previousActivationStatus: String(target.activation_status || '').trim().toUpperCase() || 'PENDING',
      rankSynced: Boolean(linkedRank?.value),
      syncedRank: linkedRank?.value ? text(linkedRank.value) : null,
      roleSyncError: roleLookup.ok ? null : text(roleLookup.error)
    }
  });

  const updated = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  return json({ employee: updated });
}
