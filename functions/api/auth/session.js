import { json, readSessionFromRequest } from './_lib/auth.js';
import { createOrRefreshAccessRequest, getEmployeeByDiscordUserId } from '../_lib/db.js';
import { ADMIN_PANEL_ENTRY_PERMISSIONS, buildPermissionContext, hasAnyPermission, hasPermission } from '../_lib/permissions.js';
import { normalizeAppMode } from '../_lib/app-mode.js';

export async function onRequest(context) {
  const { env, request } = context;
  if (!env.SESSION_SECRET) {
    return json({ loggedIn: false, error: 'SESSION_SECRET is not configured.' }, 500);
  }

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
    if (!payload.isAdmin && !employee) {
      await createOrRefreshAccessRequest(env, {
        discordUserId: payload.userId,
        displayName: payload.displayName
      });
    }
  } catch (error) {
    return json({ loggedIn: false, error: error.message || 'Database error.' }, 500);
  }

  const appMode = normalizeAppMode(env.APP_MODE);
  const isCoreMode = appMode === 'core';
  const activationStatus = String(employee?.activation_status || payload.activationStatus || '').trim().toUpperCase() || 'NONE';
  const isActivationPending = !payload.isAdmin && employee && activationStatus !== 'ACTIVE';

  return json({
    loggedIn: true,
    userId: payload.userId,
    displayName: payload.displayName,
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
    accessPending: payload.isAdmin ? false : !employee || isActivationPending,
    userStatus: String(employee?.user_status || payload.userStatus || '').trim() || 'ACTIVE_STAFF',
    activationStatus,
    canAccessAdminPanel: hasAnyPermission({ permissions: permissionContext?.permissions || [] }, ADMIN_PANEL_ENTRY_PERMISSIONS),
    canManageRoles: hasPermission({ permissions: permissionContext?.permissions || [] }, 'user_groups.manage'),
    canManageConfig: hasPermission({ permissions: permissionContext?.permissions || [] }, 'config.manage')
  });
}
