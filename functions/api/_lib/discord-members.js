function text(value) {
  return String(value || '').trim();
}

function normalizeDiscordUserId(value) {
  const raw = text(value);
  if (/^\d{6,30}$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, '');
  return /^\d{6,30}$/.test(digits) ? digits : '';
}

export async function fetchGuildMemberRoleIds(env, discordUserId) {
  const guildId = text(env?.DISCORD_GUILD_ID);
  const botToken = text(env?.DISCORD_BOT_TOKEN);
  const userId = normalizeDiscordUserId(discordUserId);

  if (!guildId || !botToken || !userId) {
    return { ok: false, inGuild: false, status: 0, roleIds: [], error: 'Discord guild/bot configuration is missing.' };
  }

  const response = await fetch(
    `https://discord.com/api/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`,
    { headers: { Authorization: `Bot ${botToken}` } }
  );
  if (!response.ok) {
    if (response.status === 404) {
      return { ok: false, inGuild: false, status: 404, roleIds: [], error: 'User is not in the configured Discord guild.' };
    }
    const errorText = text(await response.text().catch(() => ''));
    return {
      ok: false,
      inGuild: false,
      status: response.status,
      roleIds: [],
      error: `Discord role lookup failed (${response.status}). ${errorText.slice(0, 120)}`.trim()
    };
  }

  const payload = await response.json().catch(() => null);
  const roleIds = Array.isArray(payload?.roles) ? payload.roles.map((roleId) => text(roleId)).filter(Boolean) : [];
  return { ok: true, inGuild: true, status: response.status, roleIds };
}

