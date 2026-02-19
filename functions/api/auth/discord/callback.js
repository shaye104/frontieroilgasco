import {
  createSessionToken,
  getRequiredEnv,
  parseCookies,
  redirect,
  serializeCookie,
  verifyStateToken
} from '../_lib/auth.js';

function toIntranetUrl(requestUrl, params) {
  const source = new URL(requestUrl);
  const target = new URL('/intranet.html', `${source.protocol}//${source.host}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v) target.searchParams.set(k, v);
  });
  return target.toString();
}

function getAllowedRoleIds(env) {
  return String(env.DISCORD_ALLOWED_ROLE_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean);
}

async function fetchDiscordUser(accessToken) {
  const response = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  if (!response.ok) return null;
  return response.json();
}

async function fetchGuildMember(env, userId) {
  const response = await fetch(`https://discord.com/api/guilds/${env.DISCORD_GUILD_ID}/members/${userId}`, {
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` }
  });
  if (!response.ok) return null;
  return response.json();
}

export async function onRequest(context) {
  const { env, request } = context;
  const { ok, missing } = getRequiredEnv(env, [
    'DISCORD_CLIENT_ID',
    'DISCORD_CLIENT_SECRET',
    'DISCORD_GUILD_ID',
    'DISCORD_BOT_TOKEN',
    'DISCORD_ALLOWED_ROLE_IDS',
    'SESSION_SECRET'
  ]);

  if (!ok) {
    return new Response(`Missing required environment variables: ${missing.join(', ')}`, { status: 500 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const oauthError = url.searchParams.get('error');

  if (oauthError || !code || !state) {
    return redirect(toIntranetUrl(request.url, { auth: 'error' }));
  }

  const cookies = parseCookies(request.headers.get('Cookie'));
  const stateValid = await verifyStateToken(env.SESSION_SECRET, cookies.fog_oauth_state, state);
  if (!stateValid) {
    return redirect(toIntranetUrl(request.url, { auth: 'error' }));
  }

  const origin = `${url.protocol}//${url.host}`;
  const redirectUri = env.DISCORD_REDIRECT_URI || `${origin}/api/auth/discord/callback`;

  const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri
    })
  });

  if (!tokenResponse.ok) {
    return redirect(toIntranetUrl(request.url, { auth: 'error' }));
  }

  const tokenData = await tokenResponse.json();
  const user = await fetchDiscordUser(tokenData.access_token);
  if (!user || !user.id) {
    return redirect(toIntranetUrl(request.url, { auth: 'error' }));
  }

  const member = await fetchGuildMember(env, user.id);
  const memberRoles = Array.isArray(member?.roles) ? member.roles : [];
  const allowedRoleIds = getAllowedRoleIds(env);
  const hasAllowedRole = allowedRoleIds.some((roleId) => memberRoles.includes(roleId));

  if (!hasAllowedRole) {
    const clearStateCookie = serializeCookie('fog_oauth_state', '', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 0
    });

    return redirect(toIntranetUrl(request.url, { auth: 'denied', reason: 'missing_role' }), [clearStateCookie]);
  }

  const displayName = user.global_name || user.username || 'Employee';
  const sessionToken = await createSessionToken(env.SESSION_SECRET, {
    userId: user.id,
    displayName,
    roles: memberRoles,
    exp: Date.now() + 8 * 60 * 60 * 1000
  });

  const clearStateCookie = serializeCookie('fog_oauth_state', '', {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 0
  });

  const sessionCookie = serializeCookie('fog_session', sessionToken, {
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
    maxAge: 8 * 60 * 60
  });

  return redirect(toIntranetUrl(request.url, { auth: 'ok' }), [clearStateCookie, sessionCookie]);
}
