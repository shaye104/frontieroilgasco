import { getEmployeeByDiscordUserId, getRankLevelByValue } from '../../_lib/db.js';
import { ADMIN_OVERRIDE_PERMISSION, SUPER_ADMIN_PERMISSION, hasPermission } from '../../_lib/permissions.js';

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function isOwnerSession(env, session) {
  const ownerId = String(env?.OWNER_DISCORD_ID || env?.ADMIN_DISCORD_USER_ID || '').trim();
  return Boolean(ownerId) && String(session?.userId || '').trim() === ownerId;
}

export function hasHierarchyBypass(env, session) {
  return isOwnerSession(env, session) || hasPermission(session, SUPER_ADMIN_PERMISSION) || hasPermission(session, ADMIN_OVERRIDE_PERMISSION);
}

export async function getActorAccessScope(env, session) {
  const bypassHierarchy = hasHierarchyBypass(env, session);
  const actorEmployee = await getEmployeeByDiscordUserId(env, session?.userId || '');
  const actorRankLevel = actorEmployee ? await getRankLevelByValue(env, actorEmployee.rank) : 0;

  const assignedRows = actorEmployee?.id
    ? await env.DB
        .prepare(
          `SELECT ar.id, ar.sort_order
           FROM employee_role_assignments era
           INNER JOIN app_roles ar ON ar.id = era.role_id
           WHERE era.employee_id = ?`
        )
        .bind(actorEmployee.id)
        .all()
    : { results: [] };

  const assignedRoles = assignedRows?.results || [];
  const actorRoleIds = assignedRoles
    .map((row) => toPositiveInt(row.id))
    .filter((id) => id !== null);
  const sortOrders = assignedRoles
    .map((row) => Number(row.sort_order))
    .filter((value) => Number.isFinite(value));
  const actorTopRoleSort = sortOrders.length ? Math.min(...sortOrders) : Number.POSITIVE_INFINITY;

  return {
    bypassHierarchy,
    actorEmployee,
    actorRankLevel,
    actorRoleIds,
    actorTopRoleSort
  };
}

export async function resolveEmployeeRankLevel(env, employee) {
  return getRankLevelByValue(env, employee?.rank);
}

export async function canViewEmployeeByHierarchy(env, scope, targetEmployee, { allowSelf = true, allowEqual = false } = {}) {
  if (!targetEmployee) return false;
  if (scope?.bypassHierarchy) return true;
  const actorId = toPositiveInt(scope?.actorEmployee?.id);
  const targetId = toPositiveInt(targetEmployee?.id);
  if (allowSelf && actorId && targetId && actorId === targetId) return true;
  if (!scope?.actorEmployee) return false;
  const targetRankLevel = await resolveEmployeeRankLevel(env, targetEmployee);
  return allowEqual ? scope.actorRankLevel >= targetRankLevel : scope.actorRankLevel > targetRankLevel;
}

export function canManageRoleRowByHierarchy(scope, roleRow) {
  if (!roleRow) return false;
  if (scope?.bypassHierarchy) return true;
  if (!Array.isArray(scope?.actorRoleIds) || !scope.actorRoleIds.length) return false;

  const targetRoleId = toPositiveInt(roleRow.id);
  const targetSortOrder = Number(roleRow.sort_order);
  if (!targetRoleId || !Number.isFinite(targetSortOrder)) return false;
  if (scope.actorRoleIds.includes(targetRoleId)) return false;
  return targetSortOrder > Number(scope.actorTopRoleSort);
}

export async function listRolesByIds(env, roleIds = []) {
  const ids = [...new Set((roleIds || []).map((value) => toPositiveInt(value)).filter((value) => value !== null))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(', ');
  const result = await env.DB
    .prepare(`SELECT id, name, sort_order FROM app_roles WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all();
  return result?.results || [];
}

export async function validateRoleSetManageable(env, scope, roleIds = []) {
  const roles = await listRolesByIds(env, roleIds);
  if (roles.length !== [...new Set(roleIds.map((value) => toPositiveInt(value)).filter(Boolean))].length) {
    return { ok: false, roles, error: 'One or more roles do not exist.' };
  }
  const unmanageable = roles.filter((role) => !canManageRoleRowByHierarchy(scope, role));
  if (unmanageable.length) {
    return { ok: false, roles, error: 'One or more roles are not beneath your hierarchy.', unmanageable };
  }
  return { ok: true, roles };
}

export function canGrantPermissionKey(env, session, permissionKey) {
  if (hasHierarchyBypass(env, session)) return true;
  if (String(permissionKey || '').trim() === ADMIN_OVERRIDE_PERMISSION) return false;
  const strippedSession = {
    ...session,
    permissions: (Array.isArray(session?.permissions) ? session.permissions : []).filter(
      (key) => key !== SUPER_ADMIN_PERMISSION && key !== ADMIN_OVERRIDE_PERMISSION
    )
  };
  return hasPermission(strippedSession, permissionKey);
}

