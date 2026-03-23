import { createStateToken, getRequiredEnv, redirect, serializeCookie } from '../_lib/auth.js';

function randomState() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function text(value) {
  return String(value || '').trim();
}

export async function onRequest(context) {
  const { env, request } = context;
  const { ok, missing } = getRequiredEnv(env, ['SESSION_SECRET', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET']);

  if (!ok) {
    return new Response(`Missing required environment variables: ${missing.join(', ')}`, { status: 500 });
  }

  const url = new URL(request.url);
  const origin = url.origin;
  const redirectUri = text(env.DISCORD_REDIRECT_URI) || `${origin}/api/auth/discord/callback`;
  const state = randomState();
  const signedState = await createStateToken(env.SESSION_SECRET, state);
  const scopes = ['identify', 'guilds.members.read'];

  const discordUrl = new URL('https://discord.com/oauth2/authorize');
  discordUrl.searchParams.set('client_id', text(env.DISCORD_CLIENT_ID));
  discordUrl.searchParams.set('response_type', 'code');
  discordUrl.searchParams.set('redirect_uri', redirectUri);
  discordUrl.searchParams.set('scope', scopes.join(' '));
  discordUrl.searchParams.set('state', state);
  if (String(env.DISCORD_FORCE_CONSENT || '').trim().toLowerCase() === 'true') {
    discordUrl.searchParams.set('prompt', 'consent');
  }

  const stateCookie = serializeCookie('fog_oauth_state', signedState, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 10 * 60
  });

  return redirect(discordUrl.toString(), [stateCookie]);
}
