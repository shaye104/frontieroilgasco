import { json } from '../auth/_lib/auth.js';
import { requirePermission } from './_lib/admin-auth.js';
import { hasPermission } from '../_lib/permissions.js';
import { getEmployeeByDiscordUserId, normalizeDiscordUserId } from '../_lib/db.js';

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

  const url = new URL(request.url);
  const hasPaging = url.searchParams.has('page') || url.searchParams.has('pageSize');
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('pageSize')) || 100));
  const offset = (page - 1) * pageSize;

  const sql = hasPaging
    ? `SELECT e.id, e.discord_user_id, e.roblox_username, e.roblox_user_id, e.rank, e.grade, e.serial_number, e.employee_status, e.hire_date, e.updated_at,
              COALESCE(cr.level, 0) AS rank_level
       FROM employees e
       LEFT JOIN config_ranks cr ON LOWER(cr.value) = LOWER(COALESCE(e.rank, ''))
       ORDER BY e.id DESC
       LIMIT ? OFFSET ?`
    : `SELECT e.id, e.discord_user_id, e.roblox_username, e.roblox_user_id, e.rank, e.grade, e.serial_number, e.employee_status, e.hire_date, e.updated_at,
              COALESCE(cr.level, 0) AS rank_level
       FROM employees e
       LEFT JOIN config_ranks cr ON LOWER(cr.value) = LOWER(COALESCE(e.rank, ''))
       ORDER BY e.id DESC`;
  const result = hasPaging ? await env.DB.prepare(sql).bind(pageSize, offset).all() : await env.DB.prepare(sql).all();
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM employees`).first();
  const actorEmployee = await getEmployeeByDiscordUserId(env, session.userId);
  const actorRankLevelRow = actorEmployee?.rank
    ? await env.DB
        .prepare('SELECT level FROM config_ranks WHERE LOWER(value) = LOWER(?) LIMIT 1')
        .bind(actorEmployee.rank)
        .first()
    : null;
  const actorRankLevel = Number(actorRankLevelRow?.level || 0);

  return json({
    employees: result?.results || [],
    actorRankLevel,
    pagination: {
      page: hasPaging ? page : 1,
      pageSize: hasPaging ? pageSize : Number(totalRow?.total || 0),
      total: Number(totalRow?.total || 0)
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
    }
  } catch (error) {
    return json({ error: error.message || 'Unable to create employee.' }, 500);
  }

  const created = await env.DB.prepare('SELECT * FROM employees WHERE discord_user_id = ?').bind(discordUserId).first();
  return json({ employee: created }, 201);
}
