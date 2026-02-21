import {
  createSessionToken,
  getRequiredEnv,
  parseCookies,
  redirect,
  serializeCookie,
  verifyStateToken
} from '../_lib/auth.js';
import { createOrRefreshAccessRequest } from '../../_lib/db.js';
import { buildPermissionContext, hasPermission } from '../../_lib/permissions.js';

function toAccessDeniedUrl(requestUrl, params = {}) {
  const source = new URL(requestUrl);
  const target = new URL('/access-denied', `${source.protocol}//${source.host}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v) target.searchParams.set(k, v);
  });
  return target.toString();
}

function toMyDetailsUrl(requestUrl, params = {}) {
  const source = new URL(requestUrl);
  const target = new URL('/my-details', `${source.protocol}//${source.host}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v) target.searchParams.set(k, v);
  });
  return target.toString();
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
    'ADMIN_DISCORD_USER_ID',
    'DB',
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
    return redirect(toAccessDeniedUrl(request.url, { reason: 'oauth_callback_invalid' }));
  }

  const cookies = parseCookies(request.headers.get('Cookie'));
  const stateValid = await verifyStateToken(env.SESSION_SECRET, cookies.fog_oauth_state, state);
  if (!stateValid) {
    return redirect(toAccessDeniedUrl(request.url, { reason: 'oauth_state_invalid' }));
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
    return redirect(toAccessDeniedUrl(request.url, { reason: 'oauth_token_exchange_failed' }));
  }

  const tokenData = await tokenResponse.json();
  const user = await fetchDiscordUser(tokenData.access_token);
  if (!user || !user.id) {
    return redirect(toAccessDeniedUrl(request.url, { reason: 'oauth_user_fetch_failed' }));
  }

  const isAdminUser = user.id === String(env.ADMIN_DISCORD_USER_ID).trim();
  const member = await fetchGuildMember(env, user.id);
  const memberRoles = Array.isArray(member?.roles) ? member.roles : [];
  const displayName = user.global_name || user.username || 'Employee';
  let employee = null;
  let permissionContext = null;

  try {
    permissionContext = await buildPermissionContext(env, {
      discordUserId: user.id,
      discordRoleIds: memberRoles,
      isSuperAdmin: isAdminUser
    });
    employee = permissionContext.employee;
  } catch {
    return redirect(toAccessDeniedUrl(request.url, { reason: 'session_build_failed' }));
  }

  const hasEntryPermission = hasPermission({ permissions: permissionContext.permissions }, 'my_details.view');
  if (!isAdminUser && !hasEntryPermission) {
    const clearStateCookie = serializeCookie('fog_oauth_state', '', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 0
    });
    const clearSessionCookie = serializeCookie('fog_session', '', {
      path: '/',
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
      maxAge: 0
    });
    return redirect(toAccessDeniedUrl(request.url, { reason: 'missing_permission' }), [clearStateCookie, clearSessionCookie]);
  }

  if (!isAdminUser && !employee) {
    try {
      await createOrRefreshAccessRequest(env, {
        discordUserId: user.id,
        displayName
      });
    } catch {
      return redirect(toAccessDeniedUrl(request.url, { reason: 'access_request_failed' }));
    }
  }

  const sessionToken = await createSessionToken(env.SESSION_SECRET, {
    userId: user.id,
    displayName,
    discordRoles: memberRoles,
    roles: memberRoles,
    appRoleIds: permissionContext.appRoleIds || [],
    permissions: permissionContext.permissions || [],
    isAdmin: isAdminUser,
    hasEmployee: Boolean(employee),
    accessPending: !isAdminUser && !employee,
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

  return redirect(toMyDetailsUrl(request.url), [clearStateCookie, sessionCookie]);
}
