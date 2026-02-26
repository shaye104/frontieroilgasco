import { json } from '../auth/_lib/auth.js';
import { requirePermission } from './_lib/admin-auth.js';
import { hasPermission } from '../_lib/permissions.js';
import { getEmployeeByDiscordUserId, normalizeDiscordUserId, writeAdminActivityEvent } from '../_lib/db.js';

function normalizeText(value) {
  return String(value || '').trim();
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
  const gradeFilter = normalizeText(url.searchParams.get('grade'));
  const statusFilter = normalizeText(url.searchParams.get('status'));
  const hireDateFrom = normalizeText(url.searchParams.get('hireFrom') || url.searchParams.get('hireDateFrom'));
  const hireDateTo = normalizeText(url.searchParams.get('hireTo') || url.searchParams.get('hireDateTo'));
  const sortByInput = normalizeText(url.searchParams.get('sortBy')).toLowerCase();
  const sortDirInput = normalizeText(url.searchParams.get('sortDir')).toLowerCase();
  const sortDir = sortDirInput === 'asc' ? 'ASC' : 'DESC';
  const sortableColumns = new Map([
    ['id', 'e.id'],
    ['username', 'LOWER(COALESCE(e.roblox_username, \'\'))'],
    ['roblox_username', 'LOWER(COALESCE(e.roblox_username, \'\'))'],
    ['roblox_user_id', 'COALESCE(e.roblox_user_id, \'\')'],
    ['rank', 'LOWER(COALESCE(e.rank, \'\'))'],
    ['grade', 'LOWER(COALESCE(e.grade, \'\'))'],
    ['serial_number', 'LOWER(COALESCE(e.serial_number, \'\'))'],
    ['employee_status', 'LOWER(COALESCE(e.employee_status, \'\'))'],
    ['hire_date', 'COALESCE(e.hire_date, \'\')'],
    ['updated_at', 'COALESCE(e.updated_at, \'\')']
  ]);
  const sortBySql = sortableColumns.get(sortByInput) || 'e.id';

  const whereParts = [];
  const whereBindings = [];
  if (query) {
    whereParts.push(
      `(LOWER(COALESCE(e.roblox_username, '')) LIKE ? OR LOWER(COALESCE(e.roblox_user_id, '')) LIKE ? OR LOWER(COALESCE(e.serial_number, '')) LIKE ?)`
    );
    whereBindings.push(`%${query}%`, `%${query}%`, `%${query}%`);
  }
  if (rankFilter) {
    whereParts.push(`LOWER(COALESCE(e.rank, '')) = LOWER(?)`);
    whereBindings.push(rankFilter);
  }
  if (gradeFilter) {
    whereParts.push(`LOWER(COALESCE(e.grade, '')) = LOWER(?)`);
    whereBindings.push(gradeFilter);
  }
  if (statusFilter) {
    whereParts.push(`LOWER(COALESCE(e.employee_status, '')) = LOWER(?)`);
    whereBindings.push(statusFilter);
  }
  if (hireDateFrom) {
    whereParts.push(`DATE(COALESCE(e.hire_date, '')) >= DATE(?)`);
    whereBindings.push(hireDateFrom);
  }
  if (hireDateTo) {
    whereParts.push(`DATE(COALESCE(e.hire_date, '')) <= DATE(?)`);
    whereBindings.push(hireDateTo);
  }
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';

  const dbStartedAt = Date.now();
  const [result, totalRow, statsRow] = await Promise.all([
    env.DB
      .prepare(
        `SELECT e.id, e.roblox_username, e.roblox_user_id, e.rank, e.grade, e.serial_number, e.employee_status, e.hire_date, e.updated_at,
                COALESCE(cr.level, 0) AS rank_level
         FROM employees e
         LEFT JOIN config_ranks cr ON LOWER(cr.value) = LOWER(COALESCE(e.rank, ''))
         ${whereSql}
         ORDER BY ${sortBySql} ${sortDir}, e.id DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...whereBindings, pageSize, offset)
      .all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM employees e ${whereSql}`).bind(...whereBindings).first(),
    env.DB
      .prepare(
        `SELECT
           COUNT(*) AS total_employees,
           SUM(CASE WHEN LOWER(COALESCE(employee_status, '')) IN ('active', 'on duty') THEN 1 ELSE 0 END) AS active_employees,
           SUM(CASE WHEN LOWER(COALESCE(employee_status, '')) IN ('suspended', 'inactive', 'terminated', 'on leave') THEN 1 ELSE 0 END) AS inactive_employees,
           SUM(CASE WHEN DATE(COALESCE(hire_date, '')) >= DATE('now', '-30 day') THEN 1 ELSE 0 END) AS new_hires_30d
         FROM employees`
      )
      .first()
  ]);
  const actorEmployee = await getEmployeeByDiscordUserId(env, session.userId);
  const actorRankLevelRow = actorEmployee?.rank
    ? await env.DB
        .prepare('SELECT level FROM config_ranks WHERE LOWER(value) = LOWER(?) LIMIT 1')
        .bind(actorEmployee.rank)
        .first()
    : null;
  const actorRankLevel = Number(actorRankLevelRow?.level || 0);
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
        newHires30d: overview.newHires30d
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
    }
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

  const actorEmployee = await getEmployeeByDiscordUserId(env, session.userId);

  try {
    const insert = await env.DB.prepare(
      `INSERT INTO employees
       (discord_user_id, roblox_username, roblox_user_id, rank, grade, serial_number, employee_status, hire_date, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
      .bind(
        discordUserId,
        String(payload?.robloxUsername || '').trim(),
        String(payload?.robloxUserId || '').trim(),
        String(payload?.rank || '').trim(),
        String(payload?.grade || '').trim(),
        String(payload?.serialNumber || '').trim(),
        String(payload?.employeeStatus || '').trim(),
        String(payload?.hireDate || '').trim()
      )
      .run();

    const employeeId = Number(insert?.meta?.last_row_id);
    if (employeeId > 0) {
      const rolesToAssign = [];
      if (providedRoleIds.length) {
        rolesToAssign.push(...providedRoleIds);
      } else {
        const employeeRole = await env.DB.prepare(`SELECT id FROM app_roles WHERE role_key = 'employee'`).first();
        if (employeeRole?.id) rolesToAssign.push(Number(employeeRole.id));
      }

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
          grade: String(payload?.grade || '').trim(),
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
