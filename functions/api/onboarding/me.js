import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { ensureCoreSchema, getEmployeeByDiscordUserId } from '../_lib/db.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const session = await readSessionFromRequest(env, request);
  if (!session) return json({ loggedIn: false }, 401);

  await ensureCoreSchema(env);
  const employee = await getEmployeeByDiscordUserId(env, session.userId);
  if (!employee) return json({ error: 'Employee profile not found.' }, 404);

  const activationStatus = String(employee.activation_status || '').trim().toUpperCase() || 'PENDING';
  return json({
    loggedIn: true,
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
