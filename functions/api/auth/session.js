import { json, readSessionFromRequest } from './_lib/auth.js';
import { ADMIN_PANEL_ENTRY_PERMISSIONS, buildPermissionContext, hasAnyPermission, hasPermission } from '../_lib/permissions.js';
import { normalizeAppMode } from '../_lib/app-mode.js';
import { deriveLifecycleStatusFromEmployee, isPendingLifecycle, toLegacyActivationStatus } from '../_lib/lifecycle.js';

export async function onRequest(context) {
  const { env, request } = context;
  const payload = await readSessionFromRequest(env, request);

  if (!payload) {
    return json({ loggedIn: false });
  }

  let employee = null;
  let permissionContext = null;
  try {
    permissionContext = await buildPermissionContext(env, {
      discordUserId: payload.userId,
      discordRoleIds: Array.isArray(payload.discordRoles) ? payload.discordRoles : [],
      isSuperAdmin: Boolean(payload.isAdmin)
    });
    employee = permissionContext.employee;
  } catch (error) {
    const appMode = normalizeAppMode(env.APP_MODE);
    return json({
      loggedIn: true,
      userId: payload.userId,
      displayName: payload.displayName,
      robloxUsername: '',
      robloxUserId: '',
      roles: [],
      appRoleIds: [],
      appRoles: [],
      permissions: ['super.admin', 'admin.override', 'employees.read', 'voyages.read', 'finances.view', 'config.manage'],
      isAdmin: true,
      appMode,
      isCoreMode: appMode === 'core',
      hasEmployee: true,
      accessPending: false,
      userStatus: 'ACTIVE_STAFF',
      activationStatus: 'ACTIVE',
      canAccessAdminPanel: true,
      canManageRoles: true,
      canManageConfig: true,
      restrictions: { restrictIntranet: false, restrictVoyages: false, restrictFinance: false }
    });
  }

  const appMode = normalizeAppMode(env.APP_MODE);
  const isCoreMode = appMode === 'core';
  const lifecycleStatus = deriveLifecycleStatusFromEmployee(employee, payload.userStatus || 'ACTIVE');
  const activationStatus = toLegacyActivationStatus(lifecycleStatus);

  return json({
    loggedIn: true,
    userId: payload.userId,
    displayName: payload.displayName,
    discordUsername: String(payload.discordUsername || '').trim(),
    robloxUsername: String(employee?.roblox_username || '').trim(),
    robloxUserId: String(employee?.roblox_user_id || '').trim(),
    roles: Array.isArray(payload.discordRoles) ? payload.discordRoles : [],
    appRoleIds: permissionContext?.appRoleIds || [],
    appRoles: permissionContext?.appRoles || [],
    permissions: permissionContext?.permissions || [],
    isAdmin: Boolean(payload.isAdmin),
    appMode,
    isCoreMode,
    hasEmployee: payload.isAdmin ? true : Boolean(employee),
    accessPending: !payload.isAdmin && isPendingLifecycle(lifecycleStatus),
    userStatus: lifecycleStatus,
    lifecycleStatus,
    activationStatus,
    canAccessAdminPanel: hasAnyPermission({ permissions: permissionContext?.permissions || [] }, ADMIN_PANEL_ENTRY_PERMISSIONS),
    canManageRoles: hasPermission({ permissions: permissionContext?.permissions || [] }, 'user_groups.manage'),
    canManageConfig: hasPermission({ permissions: permissionContext?.permissions || [] }, 'config.manage'),
    restrictions: permissionContext?.restrictions || { restrictIntranet: false, restrictVoyages: false, restrictFinance: false }
  });
}
