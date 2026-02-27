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

  let byId = null;
  let byUsername = null;

  try {
    const byIdResponse = await fetchWithTimeout(`https://users.roblox.com/v1/users/${encodeURIComponent(userId)}`, {}, 5000);
    if (byIdResponse.ok) {
      const parsed = await byIdResponse.json().catch(() => ({}));
      byId = {
        id: text(parsed?.id),
        username: text(parsed?.name),
        displayName: text(parsed?.displayName)
      };
    }

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
      const parsed = await byUsernameResponse.json().catch(() => ({}));
      const first = parsed?.data?.[0];
      if (first) {
        byUsername = {
          id: text(first?.id),
          username: text(first?.name),
          displayName: text(first?.displayName)
        };
      }
    }
  } catch (error) {
    return json({ error: error?.name === 'AbortError' ? 'Roblox lookup timed out.' : 'Roblox lookup failed.' }, 502);
  }

  const verified = Boolean(
    byId &&
      byUsername &&
      text(byId.id) === userId &&
      text(byUsername.username).toLowerCase() === username.toLowerCase() &&
      text(byId.id) === text(byUsername.id)
  );

  const normalized = {
    userId: text(byId?.id || byUsername?.id || userId),
    username: text(byUsername?.username || byId?.username || username),
    displayName: text(byUsername?.displayName || byId?.displayName)
  };

  const durationMs = Date.now() - startedAt;
  return new Response(
    JSON.stringify({
      verified,
      normalized,
      message: verified ? 'Roblox account matched.' : 'Verification failed: username/id mismatch.'
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
