import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { ensureCoreSchema, getLinkedRanksForDiscordRoles, normalizeDiscordUserId, writeAdminActivityEvent } from '../_lib/db.js';
import { deriveLifecycleStatusFromEmployee } from '../_lib/lifecycle.js';

function text(value) {
  return String(value || '').trim();
}

function normalizeUsername(value) {
  return text(value).toLowerCase();
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
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

  const normalizedDiscordUserId = normalizeDiscordUserId(session.userId);
  await ensureCoreSchema(env);
  let employee = await env.DB
    .prepare(`SELECT id, employee_status, activation_status, activated_at FROM employees WHERE discord_user_id = ? LIMIT 1`)
    .bind(normalizedDiscordUserId)
    .first();
  if (!employee) {
    const discordRoleIds = Array.isArray(session.discordRoles)
      ? session.discordRoles
      : Array.isArray(session.roles)
      ? session.roles
      : [];
    const linkedRanks = await getLinkedRanksForDiscordRoles(env, discordRoleIds);
    const linkedRank = Array.isArray(linkedRanks) && linkedRanks.length ? linkedRanks[0] : null;
    await env.DB
      .prepare(
        `INSERT INTO employees
         (discord_user_id, discord_display_name, discord_username, rank, employee_status, activation_status, user_status, updated_at)
         VALUES (?, ?, ?, ?, 'DEACTIVATED', 'PENDING', 'APPLICANT_ACCEPTED', CURRENT_TIMESTAMP)`
      )
      .bind(
        normalizedDiscordUserId,
        text(session.displayName) || normalizedDiscordUserId,
        text(session.discordUsername) || null,
        text(linkedRank?.value) || null
      )
      .run();
    employee = await env.DB
      .prepare(`SELECT id, employee_status, activation_status, activated_at FROM employees WHERE discord_user_id = ? LIMIT 1`)
      .bind(normalizedDiscordUserId)
      .first();
  }
  if (!employee) return json({ error: 'Unable to create onboarding profile.' }, 500);

  const lifecycle = deriveLifecycleStatusFromEmployee(employee, 'DEACTIVATED');
  if (lifecycle !== 'DEACTIVATED') {
    return json({ error: 'Onboarding is only available for deactivated accounts.' }, 400);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const robloxUserId = text(payload?.robloxUserId);
  const robloxUsername = text(payload?.robloxUsername);
  if (!/^\d{1,30}$/.test(robloxUserId)) {
    return json({ error: 'Roblox User ID must be digits only.' }, 400);
  }
  if (!robloxUsername) {
    return json({ error: 'Roblox Username is required.' }, 400);
  }

  let normalizedRobloxUsername = robloxUsername;
  try {
    const usernameResponse = await fetchWithTimeout(
      'https://users.roblox.com/v1/usernames/users',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          usernames: [robloxUsername],
          excludeBannedUsers: false
        })
      },
      3500
    );
    if (!usernameResponse.ok) {
      return json({ error: 'Roblox verification is temporarily unavailable. Please retry.' }, 502);
    }
    const usernamePayload = await usernameResponse.json().catch(() => ({}));
    const first = usernamePayload?.data?.[0];
    if (!first) {
      return json({ error: 'Roblox Username was not found.' }, 400);
    }
    const resolvedUserId = text(first?.id);
    const resolvedUsername = text(first?.name);
    if (!resolvedUserId || resolvedUserId !== robloxUserId) {
      return json({ error: 'Roblox Username does not match the provided User ID.' }, 400);
    }
    if (resolvedUsername && normalizeUsername(resolvedUsername) !== normalizeUsername(robloxUsername)) {
      return json({ error: `Verification failed: expected username "${resolvedUsername}" for this User ID.` }, 400);
    }
    if (resolvedUsername) normalizedRobloxUsername = resolvedUsername;
  } catch (error) {
    const reason = error?.name === 'AbortError' ? 'Roblox verification timed out. Please retry.' : 'Roblox verification failed. Please retry.';
    return json({ error: reason }, 502);
  }

  const duplicate = await env.DB
    .prepare(
      `SELECT id
       FROM employees
       WHERE id != ?
         AND (
           LOWER(COALESCE(roblox_username, '')) = LOWER(?)
           OR TRIM(COALESCE(roblox_user_id, '')) = ?
         )
       LIMIT 1`
    )
    .bind(employee.id, normalizedRobloxUsername, robloxUserId)
    .first();
  if (duplicate?.id) {
    return json({ error: 'Roblox Username or User ID is already in use.' }, 400);
  }

  const nowIso = new Date().toISOString();
  await env.DB
    .prepare(
       `UPDATE employees
       SET roblox_user_id = ?,
           roblox_username = ?,
           onboarding_submitted_at = CURRENT_TIMESTAMP,
           onboarding_review_note = NULL,
           employee_status = 'DEACTIVATED',
           activation_status = 'PENDING',
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(robloxUserId, normalizedRobloxUsername, employee.id)
    .run();

  await writeAdminActivityEvent(env, {
    actorEmployeeId: Number(employee.id),
    actorName: session.displayName || session.userId,
    actorDiscordUserId: session.userId,
    actionType: 'ONBOARDING_SUBMITTED',
    targetEmployeeId: Number(employee.id),
    summary: 'User submitted Roblox profile for activation.',
    metadata: { robloxUserId, robloxUsername: normalizedRobloxUsername }
  });

  const durationMs = Date.now() - startedAt;
  console.log('api_onboarding_submit', JSON.stringify({ durationMs, employeeId: employee.id }));
  return new Response(
    JSON.stringify({
      success: true,
      employee: {
        id: Number(employee.id),
        status: 'SUBMITTED',
        activationStatus: 'PENDING',
        robloxUserId,
        robloxUsername: normalizedRobloxUsername,
        submittedAt: nowIso,
        activatedAt: text(employee.activated_at),
        reviewNote: ''
      }
    }),
    {
      status: 200,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
        'Server-Timing': `app;dur=${durationMs}`,
        'x-response-time-ms': String(durationMs)
      }
    }
  );
}
