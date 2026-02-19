import { createStateToken, getRequiredEnv, redirect, serializeCookie } from '../_lib/auth.js';

export async function onRequest(context) {
  const { env, request } = context;
  const { ok, missing } = getRequiredEnv(env, ['DISCORD_CLIENT_ID', 'SESSION_SECRET']);

  if (!ok) {
    return new Response(`Missing required environment variables: ${missing.join(', ')}`, { status: 500 });
  }

  const url = new URL(request.url);
  const origin = `${url.protocol}//${url.host}`;
  const redirectUri = env.DISCORD_REDIRECT_URI || `${origin}/api/auth/discord/callback`;

  const state = crypto.randomUUID();
  const signedState = await createStateToken(env.SESSION_SECRET, state);

  const authUrl = new URL('https://discord.com/oauth2/authorize');
  authUrl.searchParams.set('client_id', env.DISCORD_CLIENT_ID);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'identify');
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('prompt', 'consent');

  const stateCookie = serializeCookie('fog_oauth_state', signedState, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 600
  });

  return redirect(authUrl.toString(), [stateCookie]);
}
