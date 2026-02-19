import { json, readSessionFromRequest } from './_lib/auth.js';
import { createOrRefreshAccessRequest, getEmployeeByDiscordUserId } from '../_lib/db.js';
import { buildPermissionContext, hasPermission } from '../_lib/permissions.js';

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

  return json({
    loggedIn: true,
    userId: payload.userId,
    displayName: payload.displayName,
    roles: Array.isArray(payload.discordRoles) ? payload.discordRoles : [],
    appRoleIds: permissionContext?.appRoleIds || [],
    appRoles: permissionContext?.appRoles || [],
    permissions: permissionContext?.permissions || [],
    isAdmin: Boolean(payload.isAdmin),
    hasFormsAdmin: hasPermission({ permissions: permissionContext?.permissions || [] }, 'forms.manage'),
    hasEmployee: payload.isAdmin ? true : Boolean(employee),
    accessPending: payload.isAdmin ? false : !employee,
    canAccessAdminPanel: hasPermission({ permissions: permissionContext?.permissions || [] }, 'admin.access'),
    canManageRoles: hasPermission({ permissions: permissionContext?.permissions || [] }, 'roles.manage'),
    canManageConfig: hasPermission({ permissions: permissionContext?.permissions || [] }, 'config.manage'),
    canReadFormResponses: hasPermission({ permissions: permissionContext?.permissions || [] }, 'forms.responses.read')
  });
}
