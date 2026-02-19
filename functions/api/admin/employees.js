import { json } from '../auth/_lib/auth.js';
import { requirePermission } from './_lib/admin-auth.js';
import { normalizeDiscordUserId } from '../_lib/db.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requirePermission(context, ['employees.read']);
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const hasPaging = url.searchParams.has('page') || url.searchParams.has('pageSize');
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('pageSize')) || 100));
  const offset = (page - 1) * pageSize;

  const sql = hasPaging
    ? `SELECT id, discord_user_id, roblox_username, roblox_user_id, rank, grade, serial_number, employee_status, hire_date, updated_at
       FROM employees
       ORDER BY id DESC
       LIMIT ? OFFSET ?`
    : `SELECT id, discord_user_id, roblox_username, roblox_user_id, rank, grade, serial_number, employee_status, hire_date, updated_at
       FROM employees
       ORDER BY id DESC`;
  const result = hasPaging ? await env.DB.prepare(sql).bind(pageSize, offset).all() : await env.DB.prepare(sql).all();
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM employees`).first();

  return json({
    employees: result?.results || [],
    pagination: {
      page: hasPaging ? page : 1,
      pageSize: hasPaging ? pageSize : Number(totalRow?.total || 0),
      total: Number(totalRow?.total || 0)
    }
  });
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse } = await requirePermission(context, ['employees.create']);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const discordUserId = normalizeDiscordUserId(payload?.discordUserId);
  if (!/^\d{6,30}$/.test(discordUserId)) {
    return json({ error: 'discordUserId is required and must be a Discord snowflake.' }, 400);
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
      const providedRoleIds = Array.isArray(payload?.roleIds)
        ? [...new Set(payload.roleIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
        : [];
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
