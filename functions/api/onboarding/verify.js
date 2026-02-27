import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { ensureCoreSchema, getEmployeeByDiscordUserId } from '../_lib/db.js';

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

function normalizeUsername(value) {
  return text(value).toLowerCase();
}

export async function onRequestPost(context) {
  const startedAt = Date.now();
  const { env, request } = context;
  const session = await readSessionFromRequest(env, request);
  if (!session) return json({ error: 'Authentication required.' }, 401);

  await ensureCoreSchema(env);
  const employee = await getEmployeeByDiscordUserId(env, session.userId);
  const activation = text(employee?.activation_status).toUpperCase();
  if (!employee || (activation && activation !== 'PENDING')) {
    return json({ error: 'Verification is only available for pending accounts.' }, 403);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const userId = text(payload?.robloxUserId);
  const username = text(payload?.robloxUsername);
  if (!userId || !username) return json({ error: 'Roblox User ID and Username are required.' }, 400);
  if (!/^\d{1,30}$/.test(userId)) return json({ error: 'Roblox User ID must be digits only.' }, 400);

  const [byIdResult, byUsernameResult] = await Promise.allSettled([
    fetchWithTimeout(`https://users.roblox.com/v1/users/${encodeURIComponent(userId)}`, {}, 4500),
    fetchWithTimeout(
      'https://users.roblox.com/v1/usernames/users',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          usernames: [username],
          excludeBannedUsers: false
        })
      },
      4500
    )
  ]);

  let byId = null;
  let byUsername = null;
  let byIdError = null;
  let byUsernameError = null;

  if (byIdResult.status === 'fulfilled') {
    if (byIdResult.value.ok) {
      const parsed = await byIdResult.value.json().catch(() => ({}));
      byId = {
        id: text(parsed?.id),
        username: text(parsed?.name),
        displayName: text(parsed?.displayName)
      };
    } else {
      byIdError = `id_lookup_http_${Number(byIdResult.value.status || 0)}`;
    }
  } else {
    byIdError = byIdResult.reason?.name === 'AbortError' ? 'id_lookup_timeout' : 'id_lookup_failed';
  }

  if (byUsernameResult.status === 'fulfilled') {
    if (byUsernameResult.value.ok) {
      const parsed = await byUsernameResult.value.json().catch(() => ({}));
      const first = parsed?.data?.[0];
      if (first) {
        byUsername = {
          id: text(first?.id),
          username: text(first?.name),
          displayName: text(first?.displayName)
        };
      } else {
        byUsernameError = 'username_not_found';
      }
    } else {
      byUsernameError = `username_lookup_http_${Number(byUsernameResult.value.status || 0)}`;
    }
  } else {
    byUsernameError = byUsernameResult.reason?.name === 'AbortError' ? 'username_lookup_timeout' : 'username_lookup_failed';
  }

  if (!byId && !byUsername) {
    return json({ error: 'Roblox verification service is unavailable right now. Please try again.' }, 502);
  }

  const byIdMatchesInput = Boolean(byId && normalizeUsername(byId.username) === normalizeUsername(username) && text(byId.id) === userId);
  const byUsernameMatchesInput = Boolean(byUsername && text(byUsername.id) === userId);
  const verified = byIdMatchesInput || byUsernameMatchesInput;

  const normalized = {
    userId: text(byId?.id || byUsername?.id || userId),
    username: text(byUsername?.username || byId?.username || username),
    displayName: text(byUsername?.displayName || byId?.displayName)
  };

  const expectedUsername = text(byId?.username || byUsername?.username);
  const message = verified
    ? 'Roblox account matched.'
    : expectedUsername && normalizeUsername(expectedUsername) !== normalizeUsername(username)
    ? `Verification failed: username does not match this ID. Expected "${expectedUsername}".`
    : 'Verification failed: username/id mismatch.';

  const durationMs = Date.now() - startedAt;
  return new Response(
    JSON.stringify({
      verified,
      normalized,
      message,
      diagnostics: {
        byIdError,
        byUsernameError
      }
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, max-age=20, stale-while-revalidate=30',
        'Server-Timing': `ext;dur=${durationMs}`,
        'x-response-time-ms': String(durationMs)
      }
    }
  );
}
