import { json, readSessionFromRequest } from './_lib/auth.js';
import { createOrRefreshAccessRequest, getEmployeeByDiscordUserId } from '../_lib/db.js';

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
    hasEmployee: payload.isAdmin ? true : Boolean(employee),
    accessPending: payload.isAdmin ? false : !employee
  });
}
