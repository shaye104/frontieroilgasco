function text(value) {
  return String(value || '').trim();
}

function normalizeDiscordUserId(value) {
  const raw = text(value);
  if (/^\d{6,30}$/.test(raw)) return raw;
  const digits = raw.replace(/\D/g, '');
  return /^\d{6,30}$/.test(digits) ? digits : '';
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response, fallbackMs = 1200) {
  const retryAfter = Number(response?.headers?.get('retry-after') || 0);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.max(250, Math.min(5000, retryAfter * 1000));
  }
  return fallbackMs;
}

async function fetchDiscordWithRetry(url, headers) {
  let response = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      response = await fetch(url, { headers });
    } catch (error) {
      if (attempt === 0) {
        await delay(1200);
        continue;
      }
      return {
        ok: false,
        status: 0,
        response: null,
        error: error?.name === 'AbortError' ? 'Discord lookup timed out.' : 'Discord lookup failed.'
      };
    }

    if (response.ok || response.status === 404) {
      return { ok: response.ok, status: response.status, response, error: '' };
    }

    if (attempt === 0 && (response.status === 429 || response.status >= 500)) {
      await delay(retryDelayMs(response));
      continue;
    }

    const errorText = text(await response.text().catch(() => ''));
    return {
      ok: false,
      status: response.status,
      response,
      error: `Discord role lookup failed (${response.status}). ${errorText.slice(0, 120)}`.trim()
    };
  }

  return { ok: false, status: 0, response: null, error: 'Discord lookup failed.' };
}

export async function fetchGuildMemberRoleIds(env, discordUserId) {
  const guildId = text(env?.DISCORD_GUILD_ID);
  const botToken = text(env?.DISCORD_BOT_TOKEN);
  const userId = normalizeDiscordUserId(discordUserId);

  if (!guildId || !botToken || !userId) {
    return { ok: false, inGuild: false, status: 0, roleIds: [], error: 'Discord guild/bot configuration is missing.' };
  }

  const url = `https://discord.com/api/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`;
  const lookup = await fetchDiscordWithRetry(url, { Authorization: `Bot ${botToken}` });
  if (!lookup.ok) {
    if (lookup.status === 404) {
      return { ok: false, inGuild: false, status: 404, roleIds: [], error: 'User is not in the configured Discord guild.' };
    }
    return { ok: false, inGuild: false, status: lookup.status, roleIds: [], error: lookup.error || 'Discord lookup failed.' };
  }

  const payload = await lookup.response.json().catch(() => null);
  const roleIds = Array.isArray(payload?.roles) ? payload.roles.map((roleId) => text(roleId)).filter(Boolean) : [];
  return { ok: true, inGuild: true, status: lookup.status, roleIds };
}

export async function fetchGuildMemberIndex(env) {
  const guildId = text(env?.DISCORD_GUILD_ID);
  const botToken = text(env?.DISCORD_BOT_TOKEN);
  if (!guildId || !botToken) {
    return { ok: false, members: new Map(), error: 'Discord guild/bot configuration is missing.' };
  }

  const headers = { Authorization: `Bot ${botToken}` };
  const members = new Map();
  let after = '0';

  for (let page = 0; page < 100; page += 1) {
    const url = `https://discord.com/api/guilds/${encodeURIComponent(guildId)}/members?limit=1000&after=${encodeURIComponent(after)}`;
    const lookup = await fetchDiscordWithRetry(url, headers);
    if (!lookup.ok) {
      return { ok: false, members: new Map(), error: lookup.error || 'Discord guild member sync failed.' };
    }

    const payload = await lookup.response.json().catch(() => null);
    const rows = Array.isArray(payload) ? payload : [];
    if (!rows.length) break;

    let lastUserId = after;
    for (const row of rows) {
      const userId = normalizeDiscordUserId(row?.user?.id || '');
      if (!userId) continue;
      const roleIds = Array.isArray(row?.roles) ? row.roles.map((roleId) => text(roleId)).filter(Boolean) : [];
      members.set(userId, roleIds);
      lastUserId = userId;
    }

    if (rows.length < 1000 || lastUserId === after) break;
    after = lastUserId;
  }

  return { ok: true, members, error: '' };
}
