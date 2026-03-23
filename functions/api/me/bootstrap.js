import { cachedJson, json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { ensureCoreSchema, getEmployeeByDiscordUserId } from '../_lib/db.js';
import { expireDisciplinaryRecordsForEmployee, reconcileEmployeeSuspensionState } from '../_lib/disciplinary.js';
import { deriveLifecycleStatusFromEmployee, isPendingLifecycle, toLegacyActivationStatus } from '../_lib/lifecycle.js';

function text(value) {
  return String(value || '').trim();
}

function onboardingStatus(employee) {
  const lifecycle = deriveLifecycleStatusFromEmployee(employee, 'DEACTIVATED');
  if (!isPendingLifecycle(lifecycle)) return 'ACTIVE';
  const hasRobloxProfile = Boolean(text(employee?.roblox_user_id) && text(employee?.roblox_username));
  return hasRobloxProfile ? 'SUBMITTED' : 'PENDING';
}

async function hasQualifyingDiscordRole(env, roleIds = []) {
  const ids = [...new Set((roleIds || []).map((value) => text(value)).filter(Boolean))];
  if (!ids.length) return false;
  const placeholders = ids.map(() => '?').join(', ');

  const [directRole, mappedRole, linkedRank] = await Promise.all([
    env.DB.prepare(`SELECT 1 AS hit FROM app_roles WHERE discord_role_id IN (${placeholders}) LIMIT 1`)
      .bind(...ids)
      .first(),
    env.DB.prepare(`SELECT 1 AS hit FROM auth_role_mappings WHERE discord_role_id IN (${placeholders}) LIMIT 1`)
      .bind(...ids)
      .first(),
    env.DB.prepare(`SELECT 1 AS hit FROM rank_discord_role_links WHERE discord_role_id IN (${placeholders}) LIMIT 1`)
      .bind(...ids)
      .first()
  ]);

  return Boolean(directRole?.hit || mappedRole?.hit || linkedRank?.hit);
}

export async function onRequestGet(context) {
  const startedAt = Date.now();
  const { env, request } = context;

  const session = await readSessionFromRequest(env, request);
  if (!session) return json({ loggedIn: false }, 401);

  await ensureCoreSchema(env);

  const [employee, qualifies] = await Promise.all([
    getEmployeeByDiscordUserId(env, session.userId),
    hasQualifyingDiscordRole(env, Array.isArray(session.discordRoles) ? session.discordRoles : Array.isArray(session.roles) ? session.roles : [])
  ]);
  if (employee?.id) {
    await expireDisciplinaryRecordsForEmployee(env, Number(employee.id));
    await reconcileEmployeeSuspensionState(env, Number(employee.id));
  }

  const status = onboardingStatus(employee);
  const response = cachedJson(
    request,
    {
      loggedIn: true,
      qualifies: Boolean(session.isAdmin) || Boolean(qualifies || employee),
      discord: {
        userId: text(employee?.discord_user_id) || text(session.userId),
        displayName: text(employee?.discord_display_name) || text(session.displayName),
        username: text(employee?.discord_username),
        avatarUrl: text(employee?.discord_avatar_url)
      },
      employee: employee
        ? {
            id: Number(employee.id),
            status,
            lifecycleStatus: deriveLifecycleStatusFromEmployee(employee, 'DEACTIVATED'),
            activationStatus: toLegacyActivationStatus(deriveLifecycleStatusFromEmployee(employee, 'DEACTIVATED')),
            robloxUserId: text(employee.roblox_user_id),
            robloxUsername: text(employee.roblox_username),
            submittedAt: text(employee.onboarding_submitted_at),
            activatedAt: text(employee.activated_at),
            reviewNote: text(employee.onboarding_review_note)
          }
        : null,
      uiFlags: {
        canEditRobloxDetails: !session.isAdmin && (status === 'PENDING' || status === 'SUBMITTED')
      }
    },
    { cacheControl: 'private, max-age=15, stale-while-revalidate=30' }
  );

  const durationMs = Date.now() - startedAt;
  console.log('api_me_bootstrap', JSON.stringify({ durationMs, userId: session.userId, hasEmployee: Boolean(employee) }));
  response.headers.set('Server-Timing', `app;dur=${durationMs}`);
  response.headers.set('x-response-time-ms', String(durationMs));
  return response;
}
