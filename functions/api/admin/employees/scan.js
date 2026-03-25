import { json } from '../../auth/_lib/auth.js';
import { requirePermission } from '../_lib/admin-auth.js';
import { readSiteSettings } from '../../_lib/site-settings.js';
import { writeAdminActivityEvent } from '../../_lib/db.js';
import { fetchGuildMemberIndex, fetchGuildMemberRoleIds } from '../../_lib/discord-members.js';
import { callRobloxGroupApi, requireRobloxGroupConfig } from '../_lib/roblox-group.js';

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

function normalizeRobloxUserId(value) {
  return text(value).replace(/\D+/g, '');
}

function normalizeRobloxUsername(value) {
  return text(value).replace(/^@+/, '').trim();
}

async function resolveRobloxUserByUsername(robloxUsername) {
  const username = normalizeRobloxUsername(robloxUsername);
  if (!username) {
    return { ok: false, userId: '', username: '', error: 'Missing Roblox username.' };
  }


  let response = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetchWithTimeout(
        'https://users.roblox.com/v1/usernames/users',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            usernames: [username],
            excludeBannedUsers: false
          })
        },
        12000
      );
    } catch (error) {
      if (attempt < 2) {
        await delay(1500 * (attempt + 1));
        continue;
      }
      return {
        ok: false,
        userId: '',
        username,
        error: error?.name === 'AbortError' ? 'Roblox username lookup timed out.' : 'Roblox username lookup failed.'
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
      userId: '',
      username,
      error: `Roblox username lookup failed (${Number(response?.status || 0)}). ${errorText.slice(0, 120)}`.trim()
    };
  }

  const payload = await response.json().catch(() => ({}));
  const first = payload?.data?.[0];
  const resolvedUserId = normalizeRobloxUserId(first?.id);
  const resolvedUsername = normalizeRobloxUsername(first?.name || username);
  if (!resolvedUserId) {
    return {
      ok: false,
      userId: '',
      username,
      error: 'Roblox username did not resolve to a user.'
    };
  }

  return { ok: true, userId: resolvedUserId, username: resolvedUsername, error: '' };
}

async function fetchRobloxUserGroupIds(env, robloxUserId) {
  const userId = normalizeRobloxUserId(robloxUserId);
  if (!/^\d{1,30}$/.test(userId)) {
    return { ok: false, groupIds: [], status: 0, error: 'Missing Roblox user ID.' };
  }

  const cfg = requireRobloxGroupConfig(env);
  if (!cfg.ok) {
    return { ok: false, groupIds: [], status: 503, error: 'Roblox group integration is not configured.' };
  }

  if (cfg.mode === 'cookie') {
    let response = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await fetchWithTimeout(
          `https://groups.roblox.com/v2/users/${encodeURIComponent(userId)}/groups/roles`,
          { method: 'GET' },
          12000
        );
      } catch (error) {
        if (attempt < 2) {
          try {
            response = await fetchWithTimeout(
              `https://groups.roblox.com/v2/users/${encodeURIComponent(userId)}/groups/roles`,
              {
                method: 'GET',
                headers: {
                  cookie: `.ROBLOSECURITY=${cfg.securityCookie}`
                }
              },
              12000
            );
            if (response.ok) break;
          } catch {
            // Fall through to retry delay below.
          }
          await delay(1500 * (attempt + 1));
          continue;
        }
        return {
          ok: false,
          groupIds: [],
          status: 502,
          error: error?.name === 'AbortError' ? 'roblox_timeout' : 'roblox_unreachable'
        };
      }

      if (response.ok) break;
      if (attempt < 2 && [401, 403, 429, 500, 502, 503, 504].includes(Number(response.status || 0))) {
        if ([401, 403].includes(Number(response.status || 0))) {
          try {
            response = await fetchWithTimeout(
              `https://groups.roblox.com/v2/users/${encodeURIComponent(userId)}/groups/roles`,
              {
                method: 'GET',
                headers: {
                  cookie: `.ROBLOSECURITY=${cfg.securityCookie}`
                }
              },
              12000
            );
            if (response.ok) break;
          } catch {
            // Fall through to retry delay below.
          }
        }
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
        status: Number(response?.status || 0),
        error: errorText || `roblox_http_${Number(response?.status || 0) || 0}`
      };
    }

    const payload = await response.json().catch(() => ({}));
    const groupIds = (Array.isArray(payload?.data) ? payload.data : [])
      .map((row) => text(row?.group?.id || ''))
      .filter((value) => /^\d{1,30}$/.test(value));

    return {
      ok: true,
      groupIds: [...new Set(groupIds)],
      status: Number(response?.status || 200),
      error: ''
    };
  }

  let result = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    result = await callRobloxGroupApi(env, `/groups/${cfg.groupId}/memberships`, {
      method: 'GET',
      query: {
        filter: `user == 'users/${userId}'`,
        maxPageSize: '10'
      }
    });
    if (result?.ok || ![429, 500, 502, 503, 504].includes(Number(result?.status || 0)) || attempt > 0) {
      break;
    }
    await delay(retryDelayMs({ headers: { get: () => '' } }, 1500 * (attempt + 1)));
  }

  if (!result?.ok) {
    return {
      ok: false,
      groupIds: [],
      status: Number(result?.status || 0),
      error: text(result?.error || 'Roblox lookup failed.')
    };
  }

  const memberships = Array.isArray(result?.payload?.groupMemberships) ? result.payload.groupMemberships : [];
  const groupIds = memberships
    .map((row) => {
      const pathValue = text(row?.path || '');
      const match = pathValue.match(/^groups\/(\d{1,30})\/memberships\/(\d{1,30})$/i);
      return match?.[1] || '';
    })
    .filter((value) => /^\d{1,30}$/.test(value));

  return {
    ok: true,
    groupIds: [...new Set(groupIds)],
    status: Number(result?.status || 200),
    error: ''
  };
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
  const issueCodes = issues.map((issue) => issue.code);
  const verificationOnly = issueCodes.length > 0 && issueCodes.every((code) => code.endsWith('_LOOKUP_FAILED'));
  return {
    employeeId: Number(employee.id || 0),
    discordUserId: text(employee.discord_user_id),
    robloxUsername: text(employee.roblox_username),
    robloxUserId: text(employee.roblox_user_id),
    rank: text(employee.rank),
    employeeStatus: text(employee.employee_status || employee.activation_status),
    issueCode: issueCodes.join(','),
    issueLabel: issues.map((issue) => issue.label).join(', '),
    issueDetail: issues.map((issue) => issue.detail).join(' | '),
    verificationOnly,
    checks
  };
}


function incrementCounter(map, key) {
  const label = text(key) || 'unknown';
  map.set(label, Number(map.get(label) || 0) + 1);
}

function serializeCounter(map) {
  return Object.fromEntries([...map.entries()].sort((a, b) => a[0].localeCompare(b[0])));
}

function pushSample(list, value, limit = 8) {
  if (!Array.isArray(list) || list.length >= limit) return;
  list.push(value);
}

async function mapWithConcurrency(items, limit, worker) {
  const rows = Array.isArray(items) ? items : [];
  const max = Math.max(1, Math.min(12, Number(limit) || 1));
  const results = new Array(rows.length);
  let index = 0;

  async function runWorker() {
    while (index < rows.length) {
      const currentIndex = index;
      index += 1;
      results[currentIndex] = await worker(rows[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(max, rows.length || 1) }, () => runWorker());
  await Promise.all(workers);
  return results;
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.read']);
  if (errorResponse) return errorResponse;

  const settings = await readSiteSettings(env, { bypassCache: true });
  const requiredGroupIds = parseRequiredGroupIds(settings?.requiredRobloxGroupIds);
  const robloxConfig = requireRobloxGroupConfig(env);
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
      requiredGroups: [],
      diagnostics: {
        robloxConfigOk: robloxConfig.ok,
        robloxAuthMode: robloxConfig.ok ? robloxConfig.mode : '',
        robloxGroupId: robloxConfig.ok ? String(robloxConfig.groupId) : '',
        robloxConfigError: robloxConfig.ok ? '' : 'missing_required_group_ids'
      }
    }, 400);
  }

  const [requiredGroups, guildIndex, rows] = await Promise.all([
    mapWithConcurrency(requiredGroupIds, 4, async (groupId) => ({ id: groupId, name: await fetchRobloxGroupName(groupId) })),
    fetchGuildMemberIndex(env),
    env.DB.prepare(
      `SELECT id, discord_user_id, roblox_username, roblox_user_id, rank, employee_status, activation_status, hire_date
         FROM employees
        ORDER BY id ASC`
    ).all()
  ]);
  const employees = rows?.results || [];

  const flagged = [];
  let missingDiscordId = 0;
  let missingGuild = 0;
  let missingRobloxId = 0;
  let missingRequiredGroups = 0;
  let discordLookupFailed = 0;
  let robloxLookupFailed = 0;
  let confirmedIssues = 0;
  let verificationFailures = 0;
  const robloxErrorCounts = new Map();
  const robloxLookupFailedEmployees = [];
  const discordLookupFailedEmployees = [];

  const robloxMembershipCache = new Map();
  const robloxUserResolveCache = new Map();

  const uniqueRobloxUserIds = [...new Set(
    employees
      .map((employee) => normalizeRobloxUserId(employee?.roblox_user_id))
      .filter((value) => /^\d{1,30}$/.test(value))
  )];

  await mapWithConcurrency(uniqueRobloxUserIds, 2, async (robloxUserId) => {
    robloxMembershipCache.set(robloxUserId, await fetchRobloxUserGroupIds(env, robloxUserId));
  });

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
          pushSample(discordLookupFailedEmployees, {
            employeeId,
            discordUserId,
            error: text(lookup.error || guildIndex.error || 'Discord lookup failed.')
          });
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

    const robloxUserId = normalizeRobloxUserId(employee.roblox_user_id);
    const robloxUsername = normalizeRobloxUsername(employee.roblox_username);
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
      let membership = null;
      if (!robloxMembershipCache.has(robloxUserId)) {
        robloxMembershipCache.set(robloxUserId, await fetchRobloxUserGroupIds(env, robloxUserId));
      }
      membership = robloxMembershipCache.get(robloxUserId);

      let resolvedRobloxUserId = robloxUserId;
      let resolvedRobloxUsername = robloxUsername;
      const shouldResolveByUsername = !membership?.ok && robloxUsername && [400, 404].includes(Number(membership?.status || 0));
      if (shouldResolveByUsername) {
        if (!robloxUserResolveCache.has(robloxUsername)) {
          robloxUserResolveCache.set(robloxUsername, await resolveRobloxUserByUsername(robloxUsername));
        }
        const resolvedProfile = robloxUserResolveCache.get(robloxUsername);
        if (resolvedProfile?.ok && resolvedProfile.userId && resolvedProfile.userId !== robloxUserId) {
          resolvedRobloxUserId = resolvedProfile.userId;
          resolvedRobloxUsername = resolvedProfile.username || robloxUsername;
          if (!robloxMembershipCache.has(resolvedRobloxUserId)) {
            robloxMembershipCache.set(resolvedRobloxUserId, await fetchRobloxUserGroupIds(env, resolvedRobloxUserId));
          }
          membership = robloxMembershipCache.get(resolvedRobloxUserId);
        } else if (!resolvedProfile?.ok && Number(membership?.status || 0) === 404) {
          membership = {
            ok: true,
            groupIds: [],
            status: 404,
            error: '',
            profileMissing: true,
            profileError: text(resolvedProfile?.error || 'Roblox profile could not be resolved.')
          };
        }
      }

      if (!membership?.ok) {
        robloxLookupFailed += 1;
        incrementCounter(robloxErrorCounts, membership?.error || `status_${Number(membership?.status || 0) || 'unknown'}`);
        pushSample(robloxLookupFailedEmployees, {
          employeeId,
          robloxUserId,
          robloxUsername,
          status: Number(membership?.status || 0),
          error: text(membership?.error || 'Roblox lookup failed.')
        });
        issues.push({
          code: 'ROBLOX_LOOKUP_FAILED',
          label: 'Roblox lookup failed',
          detail: `${text(membership?.error || 'Roblox lookup failed.')} (status ${Number(membership?.status || 0) || 0}, auth ${
            robloxConfig.ok ? robloxConfig.mode : 'unconfigured'
          })`
        });
        for (const group of requiredGroups) {
          checks.push({
            label: group.name,
            ok: false,
            detail: `${text(membership?.error || 'Lookup failed.')} (status ${Number(membership?.status || 0) || 0})`
          });
        }
      } else {
        const matchedGroupIds = requiredGroupIds.filter((groupId) => membership.groupIds.includes(groupId));
        if (!matchedGroupIds.length) {
          missingRequiredGroups += 1;
          issues.push({
            code: membership.profileMissing ? 'ROBLOX_PROFILE_MISMATCH' : 'MISSING_REQUIRED_GROUPS',
            label: membership.profileMissing ? 'Roblox profile mismatch' : 'Missing required Roblox groups',
            detail: membership.profileMissing
              ? `Saved Roblox ID/username could not be confirmed. ${text(membership.profileError || 'Verify the employee Roblox profile.')}`
              : 'User is missing every configured Roblox group ID.'
          });
        }
        for (const group of requiredGroups) {
          const isMember = membership.groupIds.includes(group.id);
          let detail = isMember ? 'Member' : 'Not in group';
          if (!isMember && membership.profileMissing) {
            detail = 'Roblox profile could not be verified.';
          } else if (!isMember && resolvedRobloxUserId !== robloxUserId) {
            detail = `Checked using refreshed Roblox ID ${resolvedRobloxUserId}${resolvedRobloxUsername ? ` (${resolvedRobloxUsername})` : ''}.`;
          }
          checks.push({
            label: group.name,
            ok: isMember,
            detail
          });
        }
      }
    }

    if (issues.length) {
      const row = buildFlagRow(employee, issues, checks);
      if (row.verificationOnly) verificationFailures += 1;
      else confirmedIssues += 1;
      flagged.push(row);
    }
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
      confirmedIssues,
      verificationFailures,
      missingDiscordId,
      missingGuild,
      missingRobloxId,
      missingRequiredGroups,
      discordLookupFailed,
      robloxLookupFailed,
      robloxErrorCounts: serializeCounter(robloxErrorCounts),
      discordLookupFailedEmployees,
      robloxLookupFailedEmployees,
      requiredGroupIds,
      requiredGroups,
      robloxConfigOk: robloxConfig.ok,
      robloxAuthMode: robloxConfig.ok ? robloxConfig.mode : '',
      robloxGroupId: robloxConfig.ok ? String(robloxConfig.groupId) : '',
      robloxConfigError: robloxConfig.ok ? '' : 'roblox_group_integration_unconfigured',
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
      confirmedIssues,
      verificationFailures,
      missingDiscordId,
      missingGuild,
      missingRobloxId,
      missingRequiredGroups,
      discordLookupFailed,
      robloxLookupFailed,
      robloxErrorCounts: serializeCounter(robloxErrorCounts)
    },
    diagnostics: {
      robloxConfigOk: robloxConfig.ok,
      robloxAuthMode: robloxConfig.ok ? robloxConfig.mode : '',
      robloxGroupId: robloxConfig.ok ? String(robloxConfig.groupId) : '',
      robloxConfigError: robloxConfig.ok ? '' : 'roblox_group_integration_unconfigured',
      guildIndexOk: guildIndex.ok,
      guildIndexError: guildIndex.error || '',
      discordLookupFailedEmployees,
      robloxLookupFailedEmployees
    },
    flaggedEmployees: flagged
  });
}
