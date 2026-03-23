import { json } from '../../auth/_lib/auth.js';

function text(value) {
  return String(value || '').trim();
}

function toPositiveInt(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

let cookieCsrfToken = '';

function buildQuery(params = {}) {
  const qp = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value == null) return;
    const raw = String(value).trim();
    if (!raw) return;
    qp.set(key, raw);
  });
  const serialized = qp.toString();
  return serialized ? `?${serialized}` : '';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export function requireRobloxGroupConfig(env) {
  const groupId = toPositiveInt(env?.ROBLOX_GROUP_ID);
  const apiKey = text(env?.ROBLOX_OPEN_CLOUD_API_KEY);
  const securityCookie = text(env?.ROBLOX_SECURITY_COOKIE);
  const modeRaw = text(env?.ROBLOX_AUTH_MODE).toLowerCase();
  const mode = modeRaw === 'cookie' ? 'cookie' : modeRaw === 'opencloud' || modeRaw === 'open_cloud' ? 'open_cloud' : securityCookie ? 'cookie' : 'open_cloud';

  if (!groupId) {
    return {
      ok: false,
      response: json(
        {
          error: 'Roblox group integration is not configured. Set ROBLOX_GROUP_ID.'
        },
        503
      )
    };
  }

  if (mode === 'cookie' && !securityCookie) {
    return {
      ok: false,
      response: json(
        {
          error: 'Cookie mode is enabled but ROBLOX_SECURITY_COOKIE is missing.'
        },
        503
      )
    };
  }

  if (mode !== 'cookie' && !apiKey) {
    return {
      ok: false,
      response: json(
        {
          error: 'Roblox group integration is not configured. Set ROBLOX_GROUP_ID and ROBLOX_OPEN_CLOUD_API_KEY.'
        },
        503
      )
    };
  }
  return { ok: true, groupId, apiKey, securityCookie, mode };
}

function normalizeRoleId(rawPath) {
  const raw = text(rawPath);
  if (!raw) return 0;
  const match = raw.match(/(\d{3,30})$/);
  return toPositiveInt(match?.[1] || 0);
}

function toCookieHeaders(cookie, method, hasBody) {
  const headers = {
    cookie: `.ROBLOSECURITY=${cookie}`
  };
  if (hasBody) headers['content-type'] = 'application/json';
  if (cookieCsrfToken && String(method).toUpperCase() !== 'GET') headers['x-csrf-token'] = cookieCsrfToken;
  return headers;
}

async function callWithCookie(env, cfg, { method = 'GET', url, body = null } = {}) {
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const hasBody = body != null;
  const doRequest = async (csrfToken = '') => {
    const headers = toCookieHeaders(cfg.securityCookie, normalizedMethod, hasBody);
    if (csrfToken && normalizedMethod !== 'GET') headers['x-csrf-token'] = csrfToken;
    const response = await fetchWithTimeout(
      url,
      {
        method: normalizedMethod,
        headers,
        body: hasBody ? JSON.stringify(body) : undefined
      },
      10000
    );
    return response;
  };

  try {
    let response = await doRequest(cookieCsrfToken);
    if (response.status === 403) {
      const freshToken = text(response.headers.get('x-csrf-token'));
      if (freshToken && normalizedMethod !== 'GET') {
        cookieCsrfToken = freshToken;
        response = await doRequest(freshToken);
      }
    }

    const rawText = await response.text().catch(() => '');
    let payload = null;
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        payload = { raw: rawText };
      }
    }

    return {
      ok: response.ok,
      status: Number(response.status || 502),
      payload,
      error: response.ok ? null : text(payload?.errors?.[0]?.message || payload?.error || payload?.message || `roblox_http_${response.status}`)
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      payload: null,
      error: error?.name === 'AbortError' ? 'roblox_timeout' : 'roblox_unreachable'
    };
  }
}

function parseAbstractPath(path) {
  const raw = String(path || '').trim().replace(/^\/+/, '');
  const parts = raw.split('/').filter(Boolean);
  return { raw, parts };
}

function mapCookieAbstractToLegacy(path, method, query, body) {
  const { raw, parts } = parseAbstractPath(path);
  const normalizedMethod = String(method || 'GET').toUpperCase();
  const groupId = parts[1];

  // /groups/{groupId}/roles
  if (parts.length === 3 && parts[0] === 'groups' && parts[2] === 'roles' && normalizedMethod === 'GET') {
    return {
      legacyUrl: `https://groups.roblox.com/v1/groups/${groupId}/roles`,
      legacyMethod: 'GET',
      legacyBody: null,
      shape: 'roles'
    };
  }

  // /groups/{groupId}/join-requests
  if (parts.length === 3 && parts[0] === 'groups' && parts[2] === 'join-requests' && normalizedMethod === 'GET') {
    const limit = toPositiveInt(query?.maxPageSize) || 25;
    const cursor = text(query?.pageToken);
    return {
      legacyUrl: `https://groups.roblox.com/v1/groups/${groupId}/join-requests${buildQuery({
        limit: String(Math.min(100, Math.max(1, limit))),
        sortOrder: 'Desc',
        cursor
      })}`,
      legacyMethod: 'GET',
      legacyBody: null,
      shape: 'join_requests'
    };
  }

  // /groups/{groupId}/join-requests/{requesterId}:accept|decline
  if (parts.length === 4 && parts[0] === 'groups' && parts[2] === 'join-requests') {
    const target = String(parts[3] || '');
    const [requesterId, action] = target.split(':');
    if (requesterId && action === 'accept') {
      return {
        legacyUrl: `https://groups.roblox.com/v1/groups/${groupId}/join-requests/users/${encodeURIComponent(requesterId)}`,
        legacyMethod: 'POST',
        legacyBody: null,
        fallbackLegacyUrls: [
          `https://groups.roblox.com/v1/groups/${groupId}/join-requests/users/${encodeURIComponent(requesterId)}/accept`,
          `https://groups.roblox.com/v1/groups/${groupId}/join-requests/${encodeURIComponent(requesterId)}/accept`
        ],
        shape: 'passthrough'
      };
    }
    if (requesterId && action === 'decline') {
      return {
        legacyUrl: `https://groups.roblox.com/v1/groups/${groupId}/join-requests/users/${encodeURIComponent(requesterId)}`,
        legacyMethod: 'DELETE',
        legacyBody: null,
        fallbackLegacyUrls: [
          `https://groups.roblox.com/v1/groups/${groupId}/join-requests/users/${encodeURIComponent(requesterId)}/decline`,
          `https://groups.roblox.com/v1/groups/${groupId}/join-requests/${encodeURIComponent(requesterId)}/decline`
        ],
        shape: 'passthrough'
      };
    }
  }

  // /groups/{groupId}/memberships
  if (parts.length === 3 && parts[0] === 'groups' && parts[2] === 'memberships' && normalizedMethod === 'GET') {
    const filter = text(query?.filter);
    const filterMatch = filter.match(/users\/(\d{1,30})/i);
    const userId = filterMatch?.[1] || '';
    if (userId) {
      return {
        legacyUrl: `https://groups.roblox.com/v2/users/${encodeURIComponent(userId)}/groups/roles`,
        legacyMethod: 'GET',
        legacyBody: null,
        shape: 'memberships_by_user',
        context: { groupId: toPositiveInt(groupId), userId: toPositiveInt(userId) }
      };
    }

    const limit = toPositiveInt(query?.maxPageSize) || 25;
    const cursor = text(query?.pageToken);
    return {
      legacyUrl: `https://groups.roblox.com/v1/groups/${groupId}/users${buildQuery({
        limit: String(Math.min(100, Math.max(1, limit))),
        sortOrder: 'Desc',
        cursor
      })}`,
      legacyMethod: 'GET',
      legacyBody: null,
      shape: 'memberships_list',
      context: { groupId: toPositiveInt(groupId) }
    };
  }

  // /groups/{groupId}/memberships/{membershipId}
  if (parts.length === 4 && parts[0] === 'groups' && parts[2] === 'memberships') {
    const membershipId = parts[3];
    if (normalizedMethod === 'PATCH') {
      const roleId = normalizeRoleId(body?.role?.path || body?.roleId);
      return {
        legacyUrl: `https://groups.roblox.com/v1/groups/${groupId}/users/${encodeURIComponent(membershipId)}`,
        legacyMethod: 'PATCH',
        legacyBody: roleId ? { roleId } : body,
        shape: 'passthrough'
      };
    }
    if (normalizedMethod === 'DELETE') {
      return {
        legacyUrl: `https://groups.roblox.com/v1/groups/${groupId}/users/${encodeURIComponent(membershipId)}`,
        legacyMethod: 'DELETE',
        legacyBody: null,
        shape: 'passthrough'
      };
    }
  }

  return null;
}

function normalizeCookiePayload(shape, payload, context = {}) {
  if (shape === 'roles') {
    const rows = Array.isArray(payload?.roles) ? payload.roles : [];
    return {
      groupRoles: rows.map((row) => ({
        path: `groups/roles/${Number(row?.id || 0)}`,
        id: Number(row?.id || 0),
        displayName: text(row?.name || row?.displayName || `Role #${Number(row?.id || 0)}`),
        rank: Number(row?.rank || 0),
        memberCount: Number(row?.memberCount || 0)
      }))
    };
  }

  if (shape === 'join_requests') {
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    return {
      groupJoinRequests: rows.map((row) => {
        const requesterId = toPositiveInt(row?.requester?.userId || row?.requester?.id || row?.userId || row?.requesterId || 0);
        return {
          requester: {
            path: requesterId ? `users/${requesterId}` : '',
            userId: requesterId,
            displayName: text(row?.requester?.username || row?.requester?.displayName || row?.requester?.name || '')
          },
          createTime: text(row?.created || row?.createdAt || row?.created_at)
        };
      }),
      nextPageToken: text(payload?.nextPageCursor)
    };
  }

  if (shape === 'memberships_list') {
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const groupId = Number(context?.groupId || 0);
    return {
      groupMemberships: rows.map((row) => {
        const userId = toPositiveInt(row?.user?.userId || row?.userId || row?.id || 0);
        return {
          path: groupId && userId ? `groups/${groupId}/memberships/${userId}` : '',
          user: {
            path: userId ? `users/${userId}` : '',
            displayName: text(row?.user?.username || row?.username || '')
          },
          role: {
            path: `groups/roles/${Number(row?.role?.id || 0)}`
          }
        };
      }),
      nextPageToken: text(payload?.nextPageCursor)
    };
  }

  if (shape === 'memberships_by_user') {
    const rows = Array.isArray(payload?.data) ? payload.data : [];
    const groupId = Number(context?.groupId || 0);
    const userId = Number(context?.userId || 0);
    const current = rows.find((row) => Number(row?.group?.id || 0) === groupId);
    if (!current) return { groupMemberships: [] };
    return {
      groupMemberships: [
        {
          path: `groups/${groupId}/memberships/${userId}`,
          user: { path: `users/${userId}` },
          role: { path: `groups/roles/${Number(current?.role?.id || 0)}` }
        }
      ]
    };
  }

  return payload || {};
}

export async function callRobloxGroupApi(env, path, { method = 'GET', query = null, body = null } = {}) {
  const cfg = requireRobloxGroupConfig(env);
  if (!cfg.ok) return { ok: false, status: 503, payload: null, error: 'missing_config' };

  if (cfg.mode === 'cookie') {
    const mapped = mapCookieAbstractToLegacy(path, method, query, body);
    if (!mapped) {
      return { ok: false, status: 400, payload: null, error: 'unsupported_cookie_api_path' };
    }
    let cookieResult = await callWithCookie(env, cfg, {
      method: mapped.legacyMethod,
      url: mapped.legacyUrl,
      body: mapped.legacyBody
    });
    const fallbackUrls = Array.isArray(mapped.fallbackLegacyUrls) ? mapped.fallbackLegacyUrls : [];
    if (!cookieResult.ok && fallbackUrls.length && [400, 404, 405].includes(Number(cookieResult.status || 0))) {
      for (const fallbackUrl of fallbackUrls) {
        const retry = await callWithCookie(env, cfg, {
          method: mapped.legacyMethod,
          url: fallbackUrl,
          body: mapped.legacyBody
        });
        if (retry.ok) {
          cookieResult = retry;
          break;
        }
      }
    }
    return {
      ...cookieResult,
      payload: cookieResult.payload ? normalizeCookiePayload(mapped.shape, cookieResult.payload, mapped.context || {}) : cookieResult.payload
    };
  }

  const base = 'https://apis.roblox.com/cloud/v2';
  const queryString = buildQuery(query || {});
  const url = `${base}${path}${queryString}`;
  const reqHeaders = {
    'x-api-key': cfg.apiKey
  };
  if (body != null) reqHeaders['content-type'] = 'application/json';

  try {
    const response = await fetchWithTimeout(
      url,
      {
        method: String(method || 'GET').toUpperCase(),
        headers: reqHeaders,
        body: body == null ? undefined : JSON.stringify(body)
      },
      10000
    );
    const rawText = await response.text().catch(() => '');
    let payload = null;
    if (rawText) {
      try {
        payload = JSON.parse(rawText);
      } catch {
        payload = { raw: rawText };
      }
    }
    return {
      ok: response.ok,
      status: Number(response.status || 502),
      payload,
      error: response.ok ? null : text(payload?.error || payload?.message || `roblox_http_${response.status}`)
    };
  } catch (error) {
    return {
      ok: false,
      status: 502,
      payload: null,
      error: error?.name === 'AbortError' ? 'roblox_timeout' : 'roblox_unreachable'
    };
  }
}

export function parseRequestJson(request) {
  return request
    .json()
    .then((value) => value || {})
    .catch(() => ({}));
}

export function cleanRobloxUserId(value) {
  return text(value).replace(/\D+/g, '');
}

export function toGroupMembershipName(groupId, userId) {
  return `groups/${Number(groupId)}/memberships/${Number(userId)}`;
}
