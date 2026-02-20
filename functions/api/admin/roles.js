import { json } from '../auth/_lib/auth.js';
import { requirePermission } from './_lib/admin-auth.js';
import {
  ADMIN_OVERRIDE_PERMISSION,
  SUPER_ADMIN_PERMISSION,
  getPermissionCatalog,
  normalizePermissionKeys,
  hasPermission
} from '../_lib/permissions.js';

function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

async function getRolesWithPermissions(env) {
  const rolesResult = await env.DB
    .prepare(
      `SELECT id, role_key, name, description, sort_order, is_system, created_at, updated_at
       FROM app_roles
       ORDER BY sort_order ASC, id ASC`
    )
    .all();

  const roles = rolesResult?.results || [];
  if (!roles.length) return [];

  const roleIds = roles.map((role) => Number(role.id)).filter((roleId) => Number.isInteger(roleId) && roleId > 0);
  const placeholders = roleIds.map(() => '?').join(', ');
  const permissionsResult = await env.DB
    .prepare(
      `SELECT role_id, permission_key
       FROM app_role_permissions
       WHERE role_id IN (${placeholders})
       ORDER BY permission_key ASC`
    )
    .bind(...roleIds)
    .all();

  const permissionByRole = new Map();
  (permissionsResult?.results || []).forEach((row) => {
    const roleId = Number(row.role_id);
    if (!permissionByRole.has(roleId)) permissionByRole.set(roleId, []);
    permissionByRole.get(roleId).push(String(row.permission_key));
  });

  return roles.map((role) => ({
    ...role,
    permissions: permissionByRole.get(Number(role.id)) || []
  }));
}

async function rolesWithManageCount(env) {
  const result = await env.DB
    .prepare(
      `SELECT COUNT(DISTINCT role_id) AS count
       FROM app_role_permissions
       WHERE permission_key IN (?, ?, ?)`
    )
    .bind('user_groups.manage', 'roles.manage', SUPER_ADMIN_PERMISSION)
    .first();
  return Number(result?.count || 0);
}

async function userCanManageViaRole(env, userId, targetRoleId, nextPermissionKeys) {
  const employee = await env.DB.prepare('SELECT id FROM employees WHERE discord_user_id = ?').bind(String(userId)).first();
  if (!employee?.id) return true;

  const roleRows = await env.DB
    .prepare('SELECT role_id FROM employee_role_assignments WHERE employee_id = ?')
    .bind(employee.id)
    .all();
  const assignedRoleIds = (roleRows?.results || []).map((row) => Number(row.role_id)).filter((value) => Number.isInteger(value) && value > 0);
  if (!assignedRoleIds.length) return false;

  const manages = new Set();
  const rolePermissionRows = await env.DB
    .prepare(
      `SELECT role_id, permission_key
       FROM app_role_permissions
       WHERE role_id IN (${assignedRoleIds.map(() => '?').join(', ')})`
    )
    .bind(...assignedRoleIds)
    .all();

  (rolePermissionRows?.results || []).forEach((row) => {
    const roleId = Number(row.role_id);
    const key = String(row.permission_key || '');
    if (key === 'user_groups.manage' || key === 'roles.manage' || key === SUPER_ADMIN_PERMISSION) manages.add(roleId);
  });

  if (assignedRoleIds.includes(targetRoleId)) {
    const targetHasManage =
      nextPermissionKeys.includes('user_groups.manage') ||
      nextPermissionKeys.includes('roles.manage') ||
      nextPermissionKeys.includes(SUPER_ADMIN_PERMISSION);
    if (targetHasManage) manages.add(targetRoleId);
    else manages.delete(targetRoleId);
  }

  return manages.size > 0;
}

function canManageAdminOverride(env, session) {
  const ownerId = String(env.OWNER_DISCORD_ID || env.ADMIN_DISCORD_USER_ID || '').trim();
  return Boolean(ownerId) && String(session?.userId || '') === ownerId;
}

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse, session } = await requirePermission(context, ['user_groups.read']);
  if (errorResponse) return errorResponse;

  const roles = await getRolesWithPermissions(env);
  const isOwner = canManageAdminOverride(env, session);
  return json({
    roles,
    permissionCatalog: getPermissionCatalog().filter((permission) => isOwner || permission.key !== ADMIN_OVERRIDE_PERMISSION)
  });
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse } = await requirePermission(context, ['user_groups.manage']);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const name = String(payload?.name || '').trim();
  const description = String(payload?.description || '').trim();
  if (!name) return json({ error: 'Role name is required.' }, 400);

  const orderRow = await env.DB.prepare('SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM app_roles').first();
  const nextSort = Number(orderRow?.max_sort || 0) + 1;

  await env.DB
    .prepare(
      `INSERT INTO app_roles (name, description, sort_order, is_system, updated_at)
       VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP)`
    )
    .bind(name, description, nextSort)
    .run();

  const roles = await getRolesWithPermissions(env);
  return json({ roles }, 201);
}

export async function onRequestPut(context) {
  const { env } = context;
  const { errorResponse, session } = await requirePermission(context, ['user_groups.manage']);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const roleId = toInt(payload?.id);
  if (!roleId) return json({ error: 'Role id is required.' }, 400);

  const role = await env.DB.prepare('SELECT id, is_system FROM app_roles WHERE id = ?').bind(roleId).first();
  if (!role) return json({ error: 'Role not found.' }, 404);

  const name = String(payload?.name || '').trim();
  const description = String(payload?.description || '').trim();
  if (!name) return json({ error: 'Role name is required.' }, 400);

  const permissionKeys = normalizePermissionKeys(payload?.permissionKeys);
  const includesManage =
    permissionKeys.includes('user_groups.manage') ||
    permissionKeys.includes('roles.manage') ||
    permissionKeys.includes(SUPER_ADMIN_PERMISSION);
  const isOwner = canManageAdminOverride(env, session);
  const existingPermissionRows = await env.DB
    .prepare('SELECT permission_key FROM app_role_permissions WHERE role_id = ?')
    .bind(roleId)
    .all();
  const existingPermissionKeys = (existingPermissionRows?.results || []).map((row) => String(row.permission_key || '').trim());
  const existingHasAdminOverride = existingPermissionKeys.includes(ADMIN_OVERRIDE_PERMISSION);
  const nextHasAdminOverride = permissionKeys.includes(ADMIN_OVERRIDE_PERMISSION);
  if (!isOwner && (existingHasAdminOverride || nextHasAdminOverride)) {
    return json({ error: 'Only OWNER_DISCORD_ID can grant or revoke admin.override.' }, 403);
  }

  if (!includesManage) {
    const count = await rolesWithManageCount(env);
    const currentHasManage = await env.DB
      .prepare(
        `SELECT 1
         FROM app_role_permissions
         WHERE role_id = ?
           AND permission_key IN (?, ?, ?)
         LIMIT 1`
      )
      .bind(roleId, 'user_groups.manage', 'roles.manage', SUPER_ADMIN_PERMISSION)
      .first();
    if (currentHasManage && count <= 1) {
      return json({ error: 'Cannot remove manage permission from the last administrative role.' }, 400);
    }
  }

  if (!hasPermission(session, SUPER_ADMIN_PERMISSION)) {
    const stillManage = await userCanManageViaRole(env, session.userId, roleId, permissionKeys);
    if (!stillManage) {
      return json({ error: 'Cannot remove your own final role management permission.' }, 400);
    }
  }

  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE app_roles
         SET name = ?, description = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(name, description, roleId),
    env.DB.prepare('DELETE FROM app_role_permissions WHERE role_id = ?').bind(roleId),
    ...permissionKeys.map((permissionKey) =>
      env.DB.prepare('INSERT INTO app_role_permissions (role_id, permission_key) VALUES (?, ?)').bind(roleId, permissionKey)
    )
  ]);

  const roles = await getRolesWithPermissions(env);
  return json({ roles });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const { errorResponse, session } = await requirePermission(context, ['user_groups.manage']);
  if (errorResponse) return errorResponse;

  const roleId = toInt(new URL(request.url).searchParams.get('id'));
  if (!roleId) return json({ error: 'Role id is required.' }, 400);

  const role = await env.DB
    .prepare('SELECT id, is_system, name FROM app_roles WHERE id = ?')
    .bind(roleId)
    .first();
  if (!role) return json({ error: 'Role not found.' }, 404);
  if (Number(role.is_system) === 1) return json({ error: 'System roles cannot be deleted.' }, 400);
  const isOwner = canManageAdminOverride(env, session);
  const permissionRows = await env.DB
    .prepare('SELECT permission_key FROM app_role_permissions WHERE role_id = ?')
    .bind(roleId)
    .all();
  const hasAdminOverride = (permissionRows?.results || []).some(
    (row) => String(row.permission_key || '').trim() === ADMIN_OVERRIDE_PERMISSION
  );
  if (!isOwner && hasAdminOverride) {
    return json({ error: 'Only OWNER_DISCORD_ID can grant or revoke admin.override.' }, 403);
  }

  const roleHasManage = await env.DB
    .prepare(
      `SELECT 1
       FROM app_role_permissions
       WHERE role_id = ?
         AND permission_key IN (?, ?, ?)
       LIMIT 1`
    )
    .bind(roleId, 'user_groups.manage', 'roles.manage', SUPER_ADMIN_PERMISSION)
    .first();

  if (roleHasManage) {
    const count = await rolesWithManageCount(env);
    if (count <= 1) return json({ error: 'Cannot delete the last administrative role.' }, 400);
  }

  if (!hasPermission(session, SUPER_ADMIN_PERMISSION)) {
    const stillManage = await userCanManageViaRole(env, session.userId, roleId, []);
    if (!stillManage) return json({ error: 'Cannot remove your own final role management permission.' }, 400);
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM auth_role_mappings WHERE role_id = ?').bind(roleId),
    env.DB.prepare('DELETE FROM employee_role_assignments WHERE role_id = ?').bind(roleId),
    env.DB.prepare('DELETE FROM app_role_permissions WHERE role_id = ?').bind(roleId),
    env.DB.prepare('DELETE FROM app_roles WHERE id = ?').bind(roleId)
  ]);

  const roles = await getRolesWithPermissions(env);
  return json({ roles });
}
