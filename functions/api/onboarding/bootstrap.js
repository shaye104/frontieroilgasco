import { cachedJson, json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { ensureCoreSchema, getEmployeeByDiscordUserId } from '../_lib/db.js';

function text(value) {
  return String(value || '').trim();
}

function deriveOnboardingState(employee) {
  const activation = text(employee?.activation_status).toUpperCase();
  if (activation === 'ACTIVE') return 'ACTIVE';
  if (activation === 'REJECTED') return 'REJECTED';
  if (activation === 'DISABLED') return 'DISABLED';
  const hasRobloxProfile = Boolean(text(employee?.roblox_user_id) && text(employee?.roblox_username));
  const hasSubmitted = Boolean(text(employee?.onboarding_submitted_at));
  if (hasSubmitted || hasRobloxProfile) return 'PENDING_REVIEW';
  return 'PENDING_PROFILE';
}

async function hasQualifyingDiscordRole(env, roleIds = []) {
  const ids = [...new Set((roleIds || []).map((value) => text(value)).filter(Boolean))];
  if (!ids.length) return false;
  const placeholders = ids.map(() => '?').join(', ');

  const safeQueryFirst = async (sql) => {
    try {
      return await env.DB.prepare(sql).bind(...ids).first();
    } catch {
      return null;
    }
  };

  const [directRole, mappedRole, linkedRank] = await Promise.all([
    safeQueryFirst(`SELECT 1 AS hit FROM app_roles WHERE discord_role_id IN (${placeholders}) LIMIT 1`),
    safeQueryFirst(`SELECT 1 AS hit FROM auth_role_mappings WHERE discord_role_id IN (${placeholders}) LIMIT 1`),
    safeQueryFirst(`SELECT 1 AS hit FROM rank_discord_role_links WHERE discord_role_id IN (${placeholders}) LIMIT 1`)
  ]);

  return Boolean(directRole?.hit || mappedRole?.hit || linkedRank?.hit);
}

export async function onRequestGet(context) {
  const startedAt = Date.now();
  const { env, request } = context;

  const session = await readSessionFromRequest(env, request);
  if (!session) return json({ loggedIn: false }, 401);

  let schemaError = null;
  try {
    await ensureCoreSchema(env);
  } catch (error) {
    schemaError = error;
  }

  let employee = null;
  let qualifiesByRole = false;
  try {
    const [employeeResult, roleResult] = await Promise.all([
      getEmployeeByDiscordUserId(env, session.userId),
      hasQualifyingDiscordRole(env, Array.isArray(session.discordRoles) ? session.discordRoles : Array.isArray(session.roles) ? session.roles : [])
    ]);
    employee = employeeResult;
    qualifiesByRole = roleResult;
  } catch (error) {
    if (!schemaError) schemaError = error;
  }

  const state = deriveOnboardingState(employee);
  const qualifies = Boolean(session.isAdmin) || Boolean(employee || qualifiesByRole);
  const response = cachedJson(
    request,
    {
      loggedIn: true,
      qualifies,
      discord: {
        userId: text(employee?.discord_user_id) || text(session.userId),
        displayName: text(employee?.discord_display_name) || text(session.displayName),
        username: text(employee?.discord_username),
        avatarUrl: text(employee?.discord_avatar_url),
        roleCount: Array.isArray(session?.discordRoles) ? session.discordRoles.length : Array.isArray(session?.roles) ? session.roles.length : 0
      },
      employee: employee
        ? {
            id: Number(employee.id),
            state,
            activationStatus: text(employee.activation_status).toUpperCase() || 'PENDING',
            robloxUserId: text(employee.roblox_user_id),
            robloxUsername: text(employee.roblox_username),
            submittedAt: text(employee.onboarding_submitted_at),
            activatedAt: text(employee.activated_at),
            reviewNote: text(employee.onboarding_review_note)
          }
        : null,
      uiFlags: {
        canEditRobloxDetails: !session.isAdmin && state === 'PENDING_PROFILE',
        canSubmit: !session.isAdmin && state === 'PENDING_PROFILE'
      },
      steps: {
        discordRoleDetected: qualifies,
        robloxVerifiedOrPresent: Boolean(text(employee?.roblox_user_id) && text(employee?.roblox_username)),
        submittedForReview: state === 'PENDING_REVIEW' || state === 'ACTIVE',
        activated: state === 'ACTIVE'
      }
    },
    { cacheControl: 'private, max-age=20, stale-while-revalidate=30' }
  );

  const durationMs = Date.now() - startedAt;
  response.headers.set('Server-Timing', `app;dur=${durationMs}`);
  response.headers.set('x-response-time-ms', String(durationMs));
  if (schemaError) {
    response.headers.set('x-onboarding-schema-warning', '1');
    console.log(
      JSON.stringify({
        type: 'warn.onboarding.bootstrap',
        message: String(schemaError?.message || 'schema_or_query_warning')
      })
    );
  }
  return response;
}
