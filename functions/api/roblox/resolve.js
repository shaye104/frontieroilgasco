import { json, readSessionFromRequest } from '../auth/_lib/auth.js';

function text(value) {
  return String(value || '').trim();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 5000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function onRequestGet(context) {
  const startedAt = Date.now();
  const { env, request } = context;
  const session = await readSessionFromRequest(env, request);
  if (!session) return json({ error: 'Authentication required.' }, 401);

  const url = new URL(request.url);
  const userId = text(url.searchParams.get('userId'));
  const username = text(url.searchParams.get('username'));
  if (!userId && !username) {
    return json({ error: 'Provide userId or username.' }, 400);
  }
  if (userId && !/^\d{1,30}$/.test(userId)) {
    return json({ error: 'userId must be digits only.' }, 400);
  }

  let byId = null;
  let byUsername = null;

  try {
    if (userId) {
      const byIdResponse = await fetchWithTimeout(`https://users.roblox.com/v1/users/${encodeURIComponent(userId)}`, {}, 5000);
      if (byIdResponse.ok) {
        const payload = await byIdResponse.json().catch(() => ({}));
        byId = {
          id: text(payload?.id),
          username: text(payload?.name),
          displayName: text(payload?.displayName)
        };
      }
    }

    if (username) {
      const byUsernameResponse = await fetchWithTimeout(
        'https://users.roblox.com/v1/usernames/users',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            usernames: [username],
            excludeBannedUsers: false
          })
        },
        5000
      );
      if (byUsernameResponse.ok) {
        const payload = await byUsernameResponse.json().catch(() => ({}));
        const first = payload?.data?.[0];
        if (first) {
          byUsername = {
            id: text(first?.id),
            username: text(first?.name),
            displayName: text(first?.displayName)
          };
        }
      }
    }
  } catch (error) {
    return json({ error: error?.name === 'AbortError' ? 'Roblox lookup timed out.' : 'Roblox lookup failed.' }, 502);
  }

  const idMatches = userId ? text(byId?.id) === userId : true;
  const usernameMatches = username ? text(byUsername?.username).toLowerCase() === username.toLowerCase() : true;
  const crossMatches =
    userId && username && byId?.id && byUsername?.id ? text(byId.id) === text(byUsername.id) : true;
  const verified = Boolean((userId ? byId : true) && (username ? byUsername : true) && idMatches && usernameMatches && crossMatches);

  const durationMs = Date.now() - startedAt;
  console.log(
    'api_roblox_resolve',
    JSON.stringify({ durationMs, hasUserId: Boolean(userId), hasUsername: Boolean(username), verified })
  );
  return new Response(
    JSON.stringify({
      verified,
      byId,
      byUsername,
      normalized: {
        userId: text(byId?.id || byUsername?.id || userId),
        username: text(byUsername?.username || byId?.username || username),
        displayName: text(byUsername?.displayName || byId?.displayName)
      }
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, max-age=30, stale-while-revalidate=60',
        'Server-Timing': `ext;dur=${durationMs}`,
        'x-response-time-ms': String(durationMs)
      }
    }
  );
}
