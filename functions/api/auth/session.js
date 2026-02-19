import { json, readSessionFromRequest } from './_lib/auth.js';

export async function onRequest(context) {
  const { env, request } = context;
  if (!env.SESSION_SECRET) {
    return json({ loggedIn: false, error: 'SESSION_SECRET is not configured.' }, 500);
  }

  const payload = await readSessionFromRequest(env, request);

  if (!payload) {
    return json({ loggedIn: false });
  }

  return json({
    loggedIn: true,
    userId: payload.userId,
    displayName: payload.displayName,
    roles: payload.roles,
    isAdmin: Boolean(payload.isAdmin)
  });
}
