import { json, parseCookies, verifySessionToken } from './_lib/auth.js';

export async function onRequest(context) {
  const { env, request } = context;
  if (!env.SESSION_SECRET) {
    return json({ loggedIn: false, error: 'SESSION_SECRET is not configured.' }, 500);
  }

  const cookies = parseCookies(request.headers.get('Cookie'));
  const payload = await verifySessionToken(env.SESSION_SECRET, cookies.fog_session);

  if (!payload) {
    return json({ loggedIn: false });
  }

  return json({
    loggedIn: true,
    displayName: payload.displayName,
    roles: payload.roles
  });
}
