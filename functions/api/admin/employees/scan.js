import { json } from '../../auth/_lib/auth.js';
import { requirePermission } from '../_lib/admin-auth.js';
import { readSiteSettings } from '../../_lib/site-settings.js';
import { writeAdminActivityEvent } from '../../_lib/db.js';
import { fetchGuildMemberIndex, fetchGuildMemberRoleIds } from '../../_lib/discord-members.js';

function text(value) {
  return String(value || '').trim();
}

function parseRequiredGroupIds(raw) {
  return [...new Set(String(raw || '')
    .split(/[\s,;]+/)
    .map((part) => text(part))
    .filter((part) => /^\d{1,30}$/.test(part)))];
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(response, fallbackMs = 1500) {
  const retryAfter = Number(response?.headers?.get('retry-after') || 0);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.max(250, Math.min(6000, retryAfter * 1000));
  }
  return fallbackMs;
}

async function fetchRobloxUserGroupIds(robloxUserId) {
  const userId = text(robloxUserId);
  if (!/^\d{1,30}$/.test(userId)) {
    return { ok: false, groupIds: [], error: 'Missing Roblox user ID.' };
  }

  let response = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetchWithTimeout(
        `https://groups.roblox.com/v2/users/${encodeURIComponent(userId)}/groups/roles`,
        {},
        12000
      );
    } catch (error) {
      if (attempt < 2) {
        await delay(1500 * (attempt + 1));
        continue;
      }
      return {
        ok: false,
        groupIds: [],
        error: error?.name === 'AbortError' ? 'Roblox lookup timed out.' : 'Roblox lookup failed.'
      };
    }

    if (response.ok) break;
    if (attempt < 2 && (response.status === 429 || response.status >= 500)) {
      await delay(retryDelayMs(response, 1500 * (attempt + 1)));
      continue;
    }
    break;
  }

  if (!response?.ok) {
    const errorText = text(await response?.text?.().catch(() => '') || '');
    return {
      ok: false,
      groupIds: [],
      error: `Roblox lookup failed (${Number(response?.status || 0)}). ${errorText.slice(0, 120)}`.trim()
    };
  }

  const payload = await response.json().catch(() => ({}));
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const groupIds = [...new Set(rows.map((row) => text(row?.group?.id)).filter((value) => /^\d{1,30}$/.test(value)))];
  return { ok: true, groupIds, error: '' };
}

async function fetchRobloxGroupName(groupId) {
  const id = text(groupId);
  if (!/^\d{1,30}$/.test(id)) return `Group ${id || '?'}`;
  try {
    const response = await fetchWithTimeout(`https://groups.roblox.com/v1/groups/${encodeURIComponent(id)}`, {}, 12000);
    if (!response.ok) return `Group ${id}`;
    const payload = await response.json().catch(() => ({}));
    return text(payload?.name) || `Group ${id}`;
  } catch {
    return `Group ${id}`;
  }
}

function buildFlagRow(employee, issues, checks) {
  return {
    employeeId: Number(employee.id || 0),
    discordUserId: text(employee.discord_user_id),
    robloxUsername: text(employee.roblox_username),
    robloxUserId: text(employee.roblox_user_id),
    rank: text(employee.rank),
    employeeStatus: text(employee.employee_status || employee.activation_status),
    issueCode: issues.map((issue) => issue.code).join(','),
    issueLabel: issues.map((issue) => issue.label).join(', '),
    issueDetail: issues.map((issue) => issue.detail).join(' | '),
    checks
  };
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.read']);
  if (errorResponse) return errorResponse;

  const settings = await readSiteSettings(env, { bypassCache: true });
  const requiredGroupIds = parseRequiredGroupIds(settings?.requiredRobloxGroupIds);
  if (!requiredGroupIds.length) {
    return json({
      ok: false,
      error: 'No required Roblox group IDs are configured in Site Settings.',
      summary: {
        total: 0,
        flagged: 0,
        missingDiscordId: 0,
        missingGuild: 0,
        missingRobloxId: 0,
        missingRequiredGroups: 0,
        discordLookupFailed: 0,
        robloxLookupFailed: 0
      },
      requiredGroupIds: [],
      requiredGroups: []
    }, 400);
  }

  const requiredGroups = [];
  for (const groupId of requiredGroupIds) {
    requiredGroups.push({ id: groupId, name: await fetchRobloxGroupName(groupId) });
  }

  const guildIndex = await fetchGuildMemberIndex(env);

  const rows = await env.DB.prepare(
    `SELECT id, discord_user_id, roblox_username, roblox_user_id, rank, employee_status, activation_status, hire_date
       FROM employees
      ORDER BY id ASC`
  ).all();
  const employees = rows?.results || [];

  const flagged = [];
  let missingDiscordId = 0;
  let missingGuild = 0;
  let missingRobloxId = 0;
  let missingRequiredGroups = 0;
  let discordLookupFailed = 0;
  let robloxLookupFailed = 0;

  const robloxMembershipCache = new Map();

  for (const employee of employees) {
    const employeeId = Number(employee.id || 0);
    if (!employeeId) continue;

    const issues = [];
    const checks = [];

    const discordUserId = text(employee.discord_user_id);
    if (!discordUserId) {
      missingDiscordId += 1;
      issues.push({
        code: 'MISSING_DISCORD_ID',
        label: 'Missing Discord ID',
        detail: 'Employee record has no Discord user ID, so guild membership cannot be verified.'
      });
      checks.push({ label: 'Discord guild', ok: false, detail: 'Missing Discord user ID.' });
    } else if (guildIndex.ok) {
      const roleIds = guildIndex.members.get(discordUserId);
      if (!roleIds) {
        missingGuild += 1;
        issues.push({
          code: 'NOT_IN_DISCORD',
          label: 'Not in Discord',
          detail: 'User is no longer in the configured Discord guild.'
        });
        checks.push({ label: 'Discord guild', ok: false, detail: 'Not in configured guild.' });
      } else {
        checks.push({ label: 'Discord guild', ok: true, detail: 'In configured guild.' });
      }
    } else {
      let lookup;
      try {
        lookup = await fetchGuildMemberRoleIds(env, discordUserId);
      } catch (error) {
        lookup = {
          ok: false,
          status: 0,
          roleIds: [],
          error: error?.name === 'AbortError' ? 'Discord lookup timed out.' : 'Discord lookup failed.'
        };
      }
      if (!lookup.ok) {
        if (lookup.status === 404) {
          missingGuild += 1;
          issues.push({
            code: 'NOT_IN_DISCORD',
            label: 'Not in Discord',
            detail: 'User is no longer in the configured Discord guild.'
          });
          checks.push({ label: 'Discord guild', ok: false, detail: 'Not in configured guild.' });
        } else {
          discordLookupFailed += 1;
          issues.push({
            code: 'DISCORD_LOOKUP_FAILED',
            label: 'Discord lookup failed',
            detail: text(lookup.error || guildIndex.error || 'Discord lookup failed.')
          });
          checks.push({ label: 'Discord guild', ok: false, detail: text(lookup.error || guildIndex.error || 'Lookup failed.') });
        }
      } else {
        checks.push({ label: 'Discord guild', ok: true, detail: 'In configured guild.' });
      }
    }

    const robloxUserId = text(employee.roblox_user_id);
    if (!robloxUserId) {
      missingRobloxId += 1;
      issues.push({
        code: 'MISSING_ROBLOX_ID',
        label: 'Missing Roblox ID',
        detail: 'Employee record has no Roblox user ID, so group membership cannot be verified.'
      });
      for (const group of requiredGroups) {
        checks.push({ label: group.name, ok: false, detail: 'Missing Roblox user ID.' });
      }
    } else {
      if (!robloxMembershipCache.has(robloxUserId)) {
        robloxMembershipCache.set(robloxUserId, await fetchRobloxUserGroupIds(robloxUserId));
      }
      const membership = robloxMembershipCache.get(robloxUserId);
      if (!membership?.ok) {
        robloxLookupFailed += 1;
        issues.push({
          code: 'ROBLOX_LOOKUP_FAILED',
          label: 'Roblox lookup failed',
          detail: text(membership?.error || 'Roblox lookup failed.')
        });
        for (const group of requiredGroups) {
          checks.push({ label: group.name, ok: false, detail: text(membership?.error || 'Lookup failed.') });
        }
      } else {
        const matchedGroupIds = requiredGroupIds.filter((groupId) => membership.groupIds.includes(groupId));
        if (!matchedGroupIds.length) {
          missingRequiredGroups += 1;
          issues.push({
            code: 'MISSING_REQUIRED_GROUPS',
            label: 'Missing required Roblox groups',
            detail: 'User is missing every configured Roblox group ID.'
          });
        }
        for (const group of requiredGroups) {
          const isMember = membership.groupIds.includes(group.id);
          checks.push({
            label: group.name,
            ok: isMember,
            detail: isMember ? 'Member' : 'Not in group'
          });
        }
      }
    }

    if (issues.length) flagged.push(buildFlagRow(employee, issues, checks));
  }

  await writeAdminActivityEvent(env, {
    actorEmployeeId: Number(session?.employee?.id || 0) || null,
    actorName: session.displayName || session.userId,
    actorDiscordUserId: session.userId,
    actionType: 'EMPLOYEE_COMPLIANCE_SCAN',
    targetEmployeeId: null,
    summary: `Ran employee access compliance scan for ${employees.length} employees.`,
    metadata: {
      total: employees.length,
      flagged: flagged.length,
      missingDiscordId,
      missingGuild,
      missingRobloxId,
      missingRequiredGroups,
      discordLookupFailed,
      robloxLookupFailed,
      requiredGroupIds,
      requiredGroups,
      guildIndexOk: guildIndex.ok,
      guildIndexError: guildIndex.error || ''
    }
  });

  return json({
    ok: true,
    requiredGroupIds,
    requiredGroups,
    summary: {
      total: employees.length,
      flagged: flagged.length,
      missingDiscordId,
      missingGuild,
      missingRobloxId,
      missingRequiredGroups,
      discordLookupFailed,
      robloxLookupFailed
    },
    flaggedEmployees: flagged
  });
}
