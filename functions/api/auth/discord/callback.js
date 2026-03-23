import {
  createSessionToken,
  getRequiredEnv,
  parseCookies,
  redirect,
  serializeCookie,
  verifyStateToken
} from '../_lib/auth.js';

function text(value) {
  return String(value || '').trim();
}

function clearStateCookie() {
  return serializeCookie('fog_oauth_state', '', {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 0
  });
}

function toLoginRedirect(requestUrl, reason, error = '') {
  const target = new URL('/login', requestUrl);
  target.searchParams.set('auth', 'denied');
  if (reason) target.searchParams.set('reason', reason);
  if (error) target.searchParams.set('error', error);
  return target.toString();
}

async function exchangeCodeForToken({ code, clientId, clientSecret, redirectUri }) {
  const body = new URLSearchParams();
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  body.set('grant_type', 'authorization_code');
  body.set('code', code);
  body.set('redirect_uri', redirectUri);

  const response = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`token_exchange_failed:${response.status}:${details.slice(0, 180)}`);
  }

  return response.json();
}

async function fetchDiscordUser(accessToken) {
  const response = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) throw new Error(`discord_user_failed:${response.status}`);
  return response.json();
}

async function fetchDiscordRoles({ accessToken, guildId, userId, botToken }) {
  if (!guildId) return [];

  // Primary: OAuth scope guilds.members.read
  const selfMemberResponse = await fetch(`https://discord.com/api/users/@me/guilds/${encodeURIComponent(guildId)}/member`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (selfMemberResponse.ok) {
    const payload = await selfMemberResponse.json().catch(() => null);
    return Array.isArray(payload?.roles) ? payload.roles.map((roleId) => text(roleId)).filter(Boolean) : [];
  }

  // Fallback: bot token lookup
  if (!botToken || !userId) return [];
  const botMemberResponse = await fetch(
    `https://discord.com/api/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
    { headers: { Authorization: `Bot ${botToken}` } }
  );
  if (!botMemberResponse.ok) return [];
  const payload = await botMemberResponse.json().catch(() => null);
  return Array.isArray(payload?.roles) ? payload.roles.map((roleId) => text(roleId)).filter(Boolean) : [];
}

export async function onRequest(context) {
  const { env, request } = context;
  const { ok, missing } = getRequiredEnv(env, ['SESSION_SECRET', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET']);
  if (!ok) {
    return new Response(`Missing required environment variables: ${missing.join(', ')}`, { status: 500 });
  }

  const url = new URL(request.url);
  const code = text(url.searchParams.get('code'));
  const state = text(url.searchParams.get('state'));
  const oauthError = text(url.searchParams.get('error'));

  if (oauthError) {
    return redirect(toLoginRedirect(request.url, 'oauth_error', oauthError), [clearStateCookie()]);
  }

  const cookies = parseCookies(request.headers.get('Cookie'));
  const signedState = text(cookies.fog_oauth_state);
  const isValidState = await verifyStateToken(env.SESSION_SECRET, signedState, state);
  if (!code || !state || !isValidState) {
    return redirect(toLoginRedirect(request.url, 'invalid_oauth_state'), [clearStateCookie()]);
  }

  const redirectUri = text(env.DISCORD_REDIRECT_URI) || `${url.origin}/api/auth/discord/callback`;

  try {
    const tokenPayload = await exchangeCodeForToken({
      code,
      clientId: text(env.DISCORD_CLIENT_ID),
      clientSecret: text(env.DISCORD_CLIENT_SECRET),
      redirectUri
    });

    const accessToken = text(tokenPayload?.access_token);
    if (!accessToken) {
      return redirect(toLoginRedirect(request.url, 'token_missing'), [clearStateCookie()]);
    }

    const user = await fetchDiscordUser(accessToken);
    const userId = text(user?.id);
    if (!userId) {
      return redirect(toLoginRedirect(request.url, 'user_missing'), [clearStateCookie()]);
    }

    const displayName = text(user?.global_name) || text(user?.username) || userId;
    const discordUsername = text(user?.username);
    const discordRoles = await fetchDiscordRoles({
      accessToken,
      guildId: text(env.DISCORD_GUILD_ID),
      userId,
      botToken: text(env.DISCORD_BOT_TOKEN)
    });

    const ownerId = text(env.OWNER_DISCORD_ID || env.ADMIN_DISCORD_USER_ID);
    const isOwner = Boolean(ownerId && userId === ownerId);

    const sessionToken = await createSessionToken(env.SESSION_SECRET, {
      userId,
      displayName,
      discordUsername,
      authProvider: 'discord',
      discordRoles,
      roles: discordRoles,
      isAdmin: isOwner,
      hasEmployee: true,
      accessPending: false,
      userStatus: 'ACTIVE_STAFF',
      activationStatus: 'ACTIVE',
      exp: Date.now() + 8 * 60 * 60 * 1000
    });

    const sessionCookie = serializeCookie('fog_session', sessionToken, {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 8 * 60 * 60
    });

    return redirect(new URL('/my-details', request.url).toString(), [sessionCookie, clearStateCookie()]);
  } catch (error) {
    console.log(
      JSON.stringify({
        type: 'oauth.callback.error',
        message: text(error?.message || 'oauth_callback_failed')
      })
    );
    return redirect(toLoginRedirect(request.url, 'oauth_callback_failed'), [clearStateCookie()]);
  }
}
