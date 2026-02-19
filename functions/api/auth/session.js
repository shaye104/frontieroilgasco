import { json, readSessionFromRequest } from './_lib/auth.js';
import { createOrRefreshAccessRequest, getEmployeeByDiscordUserId } from '../_lib/db.js';

function getFormsAdminRoleIds(env) {
  return String(env.FORMS_ADMIN_ROLE_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => /^\d{6,30}$/.test(value));
}

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
  if (!payload.isAdmin) {
    try {
      employee = await getEmployeeByDiscordUserId(env, payload.userId);
      if (!employee) {
        await createOrRefreshAccessRequest(env, {
          discordUserId: payload.userId,
          displayName: payload.displayName
        });
      }
    } catch (error) {
      return json({ loggedIn: false, error: error.message || 'Database error.' }, 500);
    }
  }

  return json({
    loggedIn: true,
    userId: payload.userId,
    displayName: payload.displayName,
    roles: payload.roles,
    isAdmin: Boolean(payload.isAdmin),
    hasFormsAdmin: Boolean(
      payload.isAdmin ||
        (Array.isArray(payload.roles) &&
          getFormsAdminRoleIds(env).some((roleId) => payload.roles.map((r) => String(r)).includes(roleId)))
    ),
    hasEmployee: payload.isAdmin ? true : Boolean(employee),
    accessPending: payload.isAdmin ? false : !employee
  });
}
