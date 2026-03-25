import { json } from '../auth/_lib/auth.js';
import { requirePermission } from './_lib/admin-auth.js';
import { hasPermission } from '../_lib/permissions.js';
import { normalizeDiscordUserId, writeAdminActivityEvent } from '../_lib/db.js';
import { getActorAccessScope, hasHierarchyBypass, validateRoleSetManageable } from './_lib/access-scope.js';
import { normalizeLifecycleStatus, toLegacyActivationStatus } from '../_lib/lifecycle.js';

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeLifecycleInput(value, fallback = 'ACTIVE') {
  const upper = String(value || '').trim().toUpperCase();
  if (upper === 'ON_LEAVE' || upper === 'ON-LEAVE') return 'ON LEAVE';
  return normalizeLifecycleStatus(upper, fallback);
}

async function findDuplicateEmployee(env, { robloxUsername, robloxUserId }, excludeEmployeeId = null) {
  const username = normalizeText(robloxUsername);
  const userId = normalizeText(robloxUserId);
  if (!username && !userId) return null;

  const clauses = [];
  const binds = [];
  if (username) {
    clauses.push('LOWER(COALESCE(roblox_username, \'\')) = LOWER(?)');
    binds.push(username);
  }
  if (userId) {
    clauses.push('TRIM(COALESCE(roblox_user_id, \'\')) = ?');
    binds.push(userId);
  }
  if (!clauses.length) return null;

  let sql = `SELECT id, roblox_username, roblox_user_id FROM employees WHERE (${clauses.join(' OR ')})`;
  if (Number.isInteger(excludeEmployeeId) && excludeEmployeeId > 0) {
    sql += ' AND id != ?';
    binds.push(excludeEmployeeId);
  }
  sql += ' LIMIT 1';
  return env.DB.prepare(sql).bind(...binds).first();
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.read']);
  if (errorResponse) return errorResponse;
  const startedAt = Date.now();

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(url.searchParams.get('pageSize')) || 20));
  const offset = (page - 1) * pageSize;
  const query = normalizeText(url.searchParams.get('q')).toLowerCase();
  const rankFilter = normalizeText(url.searchParams.get('rank'));
  const statusFilter = normalizeText(url.searchParams.get('status'));
  const activationStatusFilter = normalizeText(url.searchParams.get('activationStatus') || url.searchParams.get('activation_status'));
  const hireDateFrom = normalizeText(url.searchParams.get('hireFrom') || url.searchParams.get('hireDateFrom'));
  const hireDateTo = normalizeText(url.searchParams.get('hireTo') || url.searchParams.get('hireDateTo'));
  const sortByInput = normalizeText(url.searchParams.get('sortBy')).toLowerCase();
  const sortDirInput = normalizeText(url.searchParams.get('sortDir')).toLowerCase();
  const includeConfig = url.searchParams.get('includeConfig') === '1';
  const sortDir = sortDirInput === 'asc' ? 'ASC' : 'DESC';
  const sortableColumns = new Map([
    ['id', 'e.id'],
    ['username', 'LOWER(COALESCE(e.roblox_username, \'\'))'],
    ['roblox_username', 'LOWER(COALESCE(e.roblox_username, \'\'))'],
    ['roblox_user_id', 'COALESCE(e.roblox_user_id, \'\')'],
    ['rank', 'LOWER(COALESCE(e.rank, \'\'))'],
    ['employee_status', 'LOWER(COALESCE(e.employee_status, \'\'))'],
    ['activation_status', 'LOWER(COALESCE(e.activation_status, \'\'))'],
    ['hire_date', 'COALESCE(e.hire_date, \'\')'],
    ['updated_at', 'COALESCE(e.updated_at, \'\')']
  ]);
  const sortBySql = sortableColumns.get(sortByInput) || 'e.id';

  const actorScope = await getActorAccessScope(env, session);
  const requiresRankJoin = !actorScope.bypassHierarchy;
  const rankJoinSql = requiresRankJoin ? `LEFT JOIN config_ranks cr ON LOWER(cr.value) = LOWER(COALESCE(e.rank, ''))` : '';
  const visibilityWhereParts = [];
  const visibilityBindings = [];
  if (requiresRankJoin) {
    if (!actorScope.actorEmployee?.id) {
      visibilityWhereParts.push('1 = 0');
    } else {
      visibilityWhereParts.push('(e.id = ? OR COALESCE(cr.level, 0) < ?)');
      visibilityBindings.push(Number(actorScope.actorEmployee.id), Number(actorScope.actorRankLevel || 0));
    }
  }

  const whereParts = [];
  const whereBindings = [];
  if (query) {
    whereParts.push(`(LOWER(COALESCE(e.roblox_username, '')) LIKE ? OR LOWER(COALESCE(e.roblox_user_id, '')) LIKE ?)`);
    whereBindings.push(`%${query}%`, `%${query}%`);
  }
  if (rankFilter) {
    whereParts.push(`LOWER(COALESCE(e.rank, '')) = LOWER(?)`);
    whereBindings.push(rankFilter);
  }
  if (statusFilter) {
    whereParts.push(`LOWER(COALESCE(e.employee_status, '')) = LOWER(?)`);
    whereBindings.push(statusFilter);
  }
  if (activationStatusFilter) {
    const normalizedActivationFilter = normalizeLifecycleInput(activationStatusFilter, '');
    if (normalizedActivationFilter) {
      whereParts.push(`LOWER(COALESCE(e.employee_status, '')) = LOWER(?)`);
      whereBindings.push(normalizedActivationFilter);
    }
  }
  if (hireDateFrom) {
    whereParts.push(`DATE(COALESCE(e.hire_date, '')) >= DATE(?)`);
    whereBindings.push(hireDateFrom);
  }
  if (hireDateTo) {
    whereParts.push(`DATE(COALESCE(e.hire_date, '')) <= DATE(?)`);
    whereBindings.push(hireDateTo);
  }
  const allWhereParts = [...visibilityWhereParts, ...whereParts];
  const allWhereBindings = [...visibilityBindings, ...whereBindings];
  const whereSql = allWhereParts.length ? `WHERE ${allWhereParts.join(' AND ')}` : '';

  const dbStartedAt = Date.now();
  const [result, totalRow, statsRow, configBootstrap] = await Promise.all([
    env.DB
      .prepare(
        `SELECT e.id, e.discord_user_id, e.discord_display_name, e.roblox_username, e.roblox_user_id, e.rank, e.employee_status, e.activation_status, e.hire_date, e.updated_at,
                COALESCE(ces.restrict_intranet, 0) AS status_restrict_intranet,
                COALESCE(ces.exclude_from_stats, 0) AS status_exclude_from_stats
         FROM employees e
         LEFT JOIN config_employee_statuses ces ON LOWER(COALESCE(ces.value, '')) = LOWER(COALESCE(e.employee_status, ''))
         ${rankJoinSql}
         ${whereSql}
         ORDER BY ${sortBySql} ${sortDir}, e.id DESC
         LIMIT ? OFFSET ?`
      )
        .bind(...allWhereBindings, pageSize, offset)
        .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM employees e ${rankJoinSql} ${whereSql}`).bind(...allWhereBindings).first(),
    env.DB
      .prepare(
        `SELECT
           SUM(CASE WHEN COALESCE(ces.exclude_from_stats, 0) = 0 THEN 1 ELSE 0 END) AS total_employees,
           SUM(CASE WHEN COALESCE(ces.exclude_from_stats, 0) = 0 AND UPPER(COALESCE(e.employee_status, '')) IN ('ACTIVE', 'ON LEAVE') THEN 1 ELSE 0 END) AS active_employees,
           SUM(CASE WHEN COALESCE(ces.exclude_from_stats, 0) = 0 AND UPPER(COALESCE(e.employee_status, '')) IN ('SUSPENDED', 'DEACTIVATED') THEN 1 ELSE 0 END) AS inactive_employees,
           SUM(CASE WHEN COALESCE(ces.exclude_from_stats, 0) = 0 AND DATE(COALESCE(e.hire_date, '')) >= DATE('now', '-30 day') THEN 1 ELSE 0 END) AS new_hires_30d,
           SUM(CASE WHEN COALESCE(ces.exclude_from_stats, 0) = 0 AND UPPER(COALESCE(e.employee_status, '')) = 'DEACTIVATED' THEN 1 ELSE 0 END) AS pending_activation
         FROM employees e
         LEFT JOIN config_employee_statuses ces ON LOWER(COALESCE(ces.value, '')) = LOWER(COALESCE(e.employee_status, ''))
         ${rankJoinSql}
         ${visibilityWhereParts.length ? `WHERE ${visibilityWhereParts.join(' AND ')}` : ''}`
      )
      .bind(...visibilityBindings)
      .first(),
    includeConfig
      ? Promise.all([
          env.DB.prepare('SELECT id, value, restrict_intranet, exclude_from_stats, created_at FROM config_employee_statuses ORDER BY value ASC, id ASC').all(),
          env.DB
            .prepare('SELECT id, value, level, description, updated_at, created_at FROM config_ranks ORDER BY level DESC, value ASC, id ASC')
            .all()
        ]).then(([statuses, ranks]) => ({
          statuses: statuses?.results || [],
          ranks: ranks?.results || []
        }))
      : null
  ]);
  const actorRankLevel = Number(actorScope.actorRankLevel || 0);
  const dbMs = Date.now() - dbStartedAt;
  const total = Number(totalRow?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  console.log(
    JSON.stringify({
      type: 'perf.admin.employees',
      page,
      pageSize,
      total,
      dbMs,
      totalMs: Date.now() - startedAt
    })
  );

  const rows = result?.results || [];
  const overview = {
    totalEmployees: Number(statsRow?.total_employees || 0),
    activeEmployees: Number(statsRow?.active_employees || 0),
    inactiveEmployees: Number(statsRow?.inactive_employees || 0),
    newHires30d: Number(statsRow?.new_hires_30d || 0)
  };

  return json({
    data: rows,
    employees: rows,
    meta: {
      total,
      page,
      pageSize,
      totalPages,
      counts: {
        total: overview.totalEmployees,
        active: overview.activeEmployees,
        inactiveSuspended: overview.inactiveEmployees,
        newHires30d: overview.newHires30d,
        pendingActivation: Number(statsRow?.pending_activation || 0)
      }
    },
    actorRankLevel,
    overview,
    pagination: {
      page,
      pageSize,
      total,
      totalPages
    },
    timing: {
      dbMs,
      totalMs: Date.now() - startedAt
    },
    config: configBootstrap || undefined
  });
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.create']);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const discordUserId = normalizeDiscordUserId(payload?.discordUserId);
  const providedRoleIds = Array.isArray(payload?.roleIds)
    ? [...new Set(payload.roleIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
    : [];
  if (!/^\d{6,30}$/.test(discordUserId)) {
    return json({ error: 'discordUserId is required and must be a Discord snowflake.' }, 400);
  }
  if (providedRoleIds.length && !hasPermission(session, 'user_groups.assign')) {
    return json({ error: 'Forbidden. Missing required permission.' }, 403);
  }
  if (providedRoleIds.length) {
    const forbiddenRoles = await env.DB
      .prepare(
        `SELECT id
         FROM app_roles
         WHERE id IN (${providedRoleIds.map(() => '?').join(', ')})
           AND role_key IN ('owner', 'employee')
         LIMIT 1`
      )
      .bind(...providedRoleIds)
      .first();
    if (forbiddenRoles?.id) {
      return json({ error: 'System roles cannot be assigned through user groups.' }, 400);
    }
  }
  const duplicate = await findDuplicateEmployee(env, {
    robloxUsername: payload?.robloxUsername,
    robloxUserId: payload?.robloxUserId
  });
  if (duplicate) {
    if (normalizeText(duplicate.roblox_username).toLowerCase() === normalizeText(payload?.robloxUsername).toLowerCase() && normalizeText(payload?.robloxUsername)) {
      return json({ error: 'Roblox Username already exists for another employee.' }, 400);
    }
    if (normalizeText(duplicate.roblox_user_id) === normalizeText(payload?.robloxUserId) && normalizeText(payload?.robloxUserId)) {
      return json({ error: 'Roblox User ID already exists for another employee.' }, 400);
    }
    return json({ error: 'Roblox Username/User ID must be unique.' }, 400);
  }
  const actorScope = await getActorAccessScope(env, session);
  const actorEmployee = actorScope.actorEmployee;

  if (!hasHierarchyBypass(env, session)) {
    if (!actorEmployee?.id) return json({ error: 'You do not have an employee profile to manage users.' }, 403);
    const proposedRankLevel = await env.DB
      .prepare(`SELECT level FROM config_ranks WHERE LOWER(value) = LOWER(?) LIMIT 1`)
      .bind(String(payload?.rank || '').trim())
      .first();
    const nextRankLevel = Number(proposedRankLevel?.level || 0);
    if (!(Number(actorScope.actorRankLevel) > nextRankLevel)) {
      return json({ error: 'You can only create employees beneath your rank hierarchy.' }, 403);
    }
  }

  const rolesToAssign = [];
  if (providedRoleIds.length) {
    if (!hasHierarchyBypass(env, session)) {
      const roleValidation = await validateRoleSetManageable(env, actorScope, providedRoleIds);
      if (!roleValidation.ok) {
        return json({ error: roleValidation.error || 'One or more selected roles are outside your hierarchy.' }, 403);
      }
    }
    rolesToAssign.push(...providedRoleIds);
  }

  try {
    const lifecycleStatus = normalizeLifecycleInput(payload?.employeeStatus || payload?.activationStatus || 'ACTIVE', 'ACTIVE');
    const insert = await env.DB.prepare(
      `INSERT INTO employees
       (discord_user_id, roblox_username, roblox_user_id, rank, employee_status, activation_status, hire_date, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
      .bind(
        discordUserId,
        String(payload?.robloxUsername || '').trim(),
        String(payload?.robloxUserId || '').trim(),
        String(payload?.rank || '').trim(),
        lifecycleStatus,
        toLegacyActivationStatus(lifecycleStatus),
        String(payload?.hireDate || '').trim()
      )
      .run();

    const employeeId = Number(insert?.meta?.last_row_id);
    if (employeeId > 0) {
      if (rolesToAssign.length) {
        await env.DB.batch(
          rolesToAssign.map((roleId) =>
            env.DB.prepare('INSERT OR IGNORE INTO employee_role_assignments (employee_id, role_id) VALUES (?, ?)').bind(employeeId, roleId)
          )
        );
      }
      await writeAdminActivityEvent(env, {
        actorEmployeeId: actorEmployee?.id || null,
        actorName: session.displayName || session.userId,
        actorDiscordUserId: session.userId,
        actionType: 'EMPLOYEE_CREATED',
        targetEmployeeId: employeeId,
        summary: `Created employee ${String(payload?.robloxUsername || '').trim() || `#${employeeId}`}.`,
        metadata: {
          rank: String(payload?.rank || '').trim(),
          status: String(payload?.employeeStatus || '').trim()
        }
      });
    }
  } catch (error) {
    return json({ error: error.message || 'Unable to create employee.' }, 500);
  }

  const created = await env.DB.prepare('SELECT * FROM employees WHERE discord_user_id = ?').bind(discordUserId).first();
  return json({ employee: created }, 201);
}
