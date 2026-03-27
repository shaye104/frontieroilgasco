import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { ensureCoreSchema, getEmployeeByDiscordUserId, getLinkedRanksForDiscordRoles, normalizeDiscordUserId } from '../_lib/db.js';
import { deriveConfiguredActivationStatus, deriveConfiguredLifecycleStatus } from '../_lib/lifecycle.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const session = await readSessionFromRequest(env, request);
  if (!session) return json({ loggedIn: false }, 401);

  await ensureCoreSchema(env);
  let employee = await getEmployeeByDiscordUserId(env, session.userId);
  if (!employee) {
    const normalizedDiscordUserId = normalizeDiscordUserId(session.userId);
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
        String(session.displayName || normalizedDiscordUserId).trim(),
        String(session.discordUsername || '').trim() || null,
        String(linkedRank?.value || '').trim() || null
      )
      .run();
    employee = await getEmployeeByDiscordUserId(env, session.userId);
  }
  if (!employee) return json({ error: 'Unable to create onboarding profile.' }, 500);

  const lifecycleStatus = await deriveConfiguredLifecycleStatus(env, employee, 'DEACTIVATED');
  const activationStatus = await deriveConfiguredActivationStatus(env, employee, 'DEACTIVATED');
  return json({
    loggedIn: true,
    lifecycleStatus,
    activationStatus,
    employee: {
      id: employee.id,
      discordUserId: employee.discord_user_id,
      discordDisplayName: employee.discord_display_name || session.displayName || '',
      discordUsername: employee.discord_username || '',
      discordAvatarUrl: employee.discord_avatar_url || '',
      robloxUserId: employee.roblox_user_id || '',
      robloxUsername: employee.roblox_username || ''
    }
  });
}
