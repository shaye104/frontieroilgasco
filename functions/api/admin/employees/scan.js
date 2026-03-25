import { json } from '../../auth/_lib/auth.js';
import { requirePermission } from '../_lib/admin-auth.js';
import { readSiteSettings } from '../../_lib/site-settings.js';
import { writeAdminActivityEvent } from '../../_lib/db.js';
import { fetchGuildMemberRoleIds } from '../../_lib/discord-members.js';

function text(value) {
  return String(value || '').trim();
}

function parseRequiredRoleIds(raw) {
  return [...new Set(String(raw || '')
    .split(/[\s,;]+/)
    .map((part) => text(part))
    .filter((part) => /^\d{6,30}$/.test(part)))];
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.read']);
  if (errorResponse) return errorResponse;

  const settings = await readSiteSettings(env, { bypassCache: true });
  const requiredRoleIds = parseRequiredRoleIds(settings?.requiredDiscordRoleIds);
  if (!requiredRoleIds.length) {
    return json({
      ok: false,
      error: 'No required Discord group IDs are configured in Site Settings.',
      summary: { total: 0, flagged: 0, missingDiscordId: 0, missingGuild: 0, missingRequiredRoles: 0, lookupFailed: 0 },
      requiredRoleIds: []
    }, 400);
  }

  const rows = await env.DB.prepare(
    `SELECT id, discord_user_id, roblox_username, roblox_user_id, rank, employee_status, activation_status, hire_date
       FROM employees
      ORDER BY id ASC`
  ).all();
  const employees = rows?.results || [];

  const flagged = [];
  let missingDiscordId = 0;
  let missingGuild = 0;
  let missingRequiredRoles = 0;
  let lookupFailed = 0;

  for (const employee of employees) {
    const employeeId = Number(employee.id || 0);
    const discordUserId = text(employee.discord_user_id);
    if (!employeeId) continue;
    if (!discordUserId) {
      missingDiscordId += 1;
      flagged.push({
        employeeId,
        discordUserId: '',
        robloxUsername: text(employee.roblox_username),
        robloxUserId: text(employee.roblox_user_id),
        rank: text(employee.rank),
        employeeStatus: text(employee.employee_status || employee.activation_status),
        issueCode: 'MISSING_DISCORD_ID',
        issueLabel: 'Missing Discord ID',
        issueDetail: 'Employee record has no Discord user ID, so guild membership cannot be verified.'
      });
      continue;
    }

    const lookup = await fetchGuildMemberRoleIds(env, discordUserId);
    if (!lookup.ok) {
      if (lookup.status === 404) {
        missingGuild += 1;
        flagged.push({
          employeeId,
          discordUserId,
          robloxUsername: text(employee.roblox_username),
          robloxUserId: text(employee.roblox_user_id),
          rank: text(employee.rank),
          employeeStatus: text(employee.employee_status || employee.activation_status),
          issueCode: 'NOT_IN_DISCORD',
          issueLabel: 'Not in Discord',
          issueDetail: 'User is no longer in the configured Discord guild.'
        });
      } else {
        lookupFailed += 1;
        flagged.push({
          employeeId,
          discordUserId,
          robloxUsername: text(employee.roblox_username),
          robloxUserId: text(employee.roblox_user_id),
          rank: text(employee.rank),
          employeeStatus: text(employee.employee_status || employee.activation_status),
          issueCode: 'LOOKUP_FAILED',
          issueLabel: 'Lookup failed',
          issueDetail: text(lookup.error || 'Discord lookup failed.')
        });
      }
      continue;
    }

    const memberRoleIds = Array.isArray(lookup.roleIds) ? lookup.roleIds.map((value) => text(value)).filter(Boolean) : [];
    const matchedRequiredRoleIds = requiredRoleIds.filter((roleId) => memberRoleIds.includes(roleId));
    if (!matchedRequiredRoleIds.length) {
      missingRequiredRoles += 1;
      flagged.push({
        employeeId,
        discordUserId,
        robloxUsername: text(employee.roblox_username),
        robloxUserId: text(employee.roblox_user_id),
        rank: text(employee.rank),
        employeeStatus: text(employee.employee_status || employee.activation_status),
        issueCode: 'MISSING_REQUIRED_GROUPS',
        issueLabel: 'Missing required groups',
        issueDetail: 'User is in Discord but missing every required Discord group ID.',
        requiredRoleIds,
        matchedRequiredRoleIds
      });
    }
  }

  await writeAdminActivityEvent(env, {
    actorEmployeeId: Number(session?.employee?.id || 0) || null,
    actorName: session.displayName || session.userId,
    actorDiscordUserId: session.userId,
    actionType: 'EMPLOYEE_COMPLIANCE_SCAN',
    targetEmployeeId: null,
    summary: `Ran employee Discord compliance scan for ${employees.length} employees.`,
    metadata: {
      total: employees.length,
      flagged: flagged.length,
      missingDiscordId,
      missingGuild,
      missingRequiredRoles,
      lookupFailed,
      requiredRoleIds
    }
  });

  return json({
    ok: true,
    requiredRoleIds,
    summary: {
      total: employees.length,
      flagged: flagged.length,
      missingDiscordId,
      missingGuild,
      missingRequiredRoles,
      lookupFailed
    },
    flaggedEmployees: flagged
  });
}
