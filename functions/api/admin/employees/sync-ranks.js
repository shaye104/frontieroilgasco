import { json } from '../../auth/_lib/auth.js';
import { requirePermission } from '../_lib/admin-auth.js';
import { getLinkedRanksForDiscordRoles, getMappedRoleIdsForRankIds, writeAdminActivityEvent } from '../../_lib/db.js';
import { fetchGuildMemberRoleIds } from '../../_lib/discord-members.js';

function text(value) {
  return String(value || '').trim();
}

function sameText(a, b) {
  return text(a).toLowerCase() === text(b).toLowerCase();
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.edit']);
  if (errorResponse) return errorResponse;

  const employeesRows = await env.DB
    .prepare(
      `SELECT id, discord_user_id, roblox_username, rank
       FROM employees
       WHERE TRIM(COALESCE(discord_user_id, '')) != ''
       ORDER BY id ASC`
    )
    .all();
  const employees = employeesRows?.results || [];

  const summary = {
    total: employees.length,
    synced: 0,
    unchanged: 0,
    noLinkedRank: 0,
    lookupFailed: 0,
    errors: []
  };

  for (const row of employees) {
    const employeeId = Number(row.id);
    const discordUserId = text(row.discord_user_id);
    if (!employeeId || !discordUserId) continue;

    try {
      const roleLookup = await fetchGuildMemberRoleIds(env, discordUserId);
      if (!roleLookup.ok) {
        summary.lookupFailed += 1;
        summary.errors.push({ employeeId, username: text(row.roblox_username), error: roleLookup.error || 'Discord lookup failed.' });
        continue;
      }

      const linkedRanks = await getLinkedRanksForDiscordRoles(env, roleLookup.roleIds);
      const linkedRank = Array.isArray(linkedRanks) && linkedRanks.length ? linkedRanks[0] : null;
      if (!linkedRank?.value) {
        summary.noLinkedRank += 1;
        continue;
      }

      if (sameText(row.rank, linkedRank.value)) {
        summary.unchanged += 1;
      } else {
        await env.DB
          .prepare(`UPDATE employees SET rank = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
          .bind(text(linkedRank.value), employeeId)
          .run();
        summary.synced += 1;
      }

      const mappedRoleIds = await getMappedRoleIdsForRankIds(env, [Number(linkedRank.id)]);
      if (mappedRoleIds.length) {
        await env.DB.batch(
          [...new Set(mappedRoleIds)]
            .map((roleId) => Number(roleId))
            .filter((roleId) => Number.isInteger(roleId) && roleId > 0)
            .map((roleId) => env.DB.prepare('INSERT OR IGNORE INTO employee_role_assignments (employee_id, role_id) VALUES (?, ?)').bind(employeeId, roleId))
        );
      }
    } catch (error) {
      summary.errors.push({ employeeId, username: text(row.roblox_username), error: text(error?.message || 'Unexpected sync error.') });
    }
  }

  await writeAdminActivityEvent(env, {
    actorEmployeeId: Number(session?.employee?.id || 0) || null,
    actorName: session.displayName || session.userId,
    actorDiscordUserId: session.userId,
    actionType: 'EMPLOYEE_RANK_SYNC_ALL',
    targetEmployeeId: null,
    summary: `Ran rank sync for ${summary.total} employees.`,
    metadata: {
      total: summary.total,
      synced: summary.synced,
      unchanged: summary.unchanged,
      noLinkedRank: summary.noLinkedRank,
      lookupFailed: summary.lookupFailed,
      errorCount: summary.errors.length
    }
  });

  return json({
    ok: true,
    summary: {
      ...summary,
      errors: summary.errors.slice(0, 25)
    }
  });
}

