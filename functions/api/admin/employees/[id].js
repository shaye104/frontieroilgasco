import { json } from '../../auth/_lib/auth.js';
import { requirePermission } from '../_lib/admin-auth.js';
import { hasPermission } from '../../_lib/permissions.js';
import { canEditEmployeeByRank, getEmployeeByDiscordUserId } from '../../_lib/db.js';

function valueText(value) {
  const text = String(value ?? '').trim();
  return text || 'Unset';
}

function buildChangeEntries(previous, next) {
  const tracked = [
    { key: 'rank', label: 'Rank changed' },
    { key: 'grade', label: 'Grade changed' },
    { key: 'employee_status', label: 'Status changed' },
    { key: 'serial_number', label: 'Serial Number changed' },
    { key: 'hire_date', label: 'Hire Date changed' }
  ];

  return tracked
    .filter(({ key }) => String(previous?.[key] || '').trim() !== String(next?.[key] || '').trim())
    .map(({ key, label }) => ({
      actionType: label,
      details: `${valueText(previous?.[key])} -> ${valueText(next?.[key])}`
    }));
}

function normalizeText(value) {
  return String(value || '').trim();
}

async function findDuplicateEmployee(env, { robloxUsername, robloxUserId }, excludeEmployeeId) {
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
  let sql = `SELECT id, roblox_username, roblox_user_id FROM employees WHERE (${clauses.join(' OR ')})`;
  if (Number.isInteger(excludeEmployeeId) && excludeEmployeeId > 0) {
    sql += ' AND id != ?';
    binds.push(excludeEmployeeId);
  }
  sql += ' LIMIT 1';
  return env.DB.prepare(sql).bind(...binds).first();
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.read']);
  if (errorResponse) return errorResponse;

  const employeeId = Number(params.id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return json({ error: 'Invalid employee id.' }, 400);

  const employee = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  if (!employee) return json({ error: 'Employee not found.' }, 404);
  const actorEmployee = await getEmployeeByDiscordUserId(env, session.userId);
  const canEditByRank = hasPermission(session, 'admin.override')
    ? true
    : actorEmployee
    ? await canEditEmployeeByRank(env, actorEmployee, employee)
    : false;

  const disciplinaries = await env.DB.prepare(
    `SELECT id, record_type, record_date, record_status, notes, issued_by, created_at
     FROM disciplinary_records
     WHERE employee_id = ?
     ORDER BY COALESCE(record_date, created_at) DESC`
  )
    .bind(employeeId)
    .all();

  const notes = await env.DB.prepare(
    `SELECT id, note, authored_by, created_at
     FROM employee_notes
     WHERE employee_id = ?
     ORDER BY created_at DESC`
  )
    .bind(employeeId)
    .all();

  const roleAssignments = await env.DB
    .prepare(
      `SELECT ar.id, ar.name, ar.description, ar.sort_order
       FROM employee_role_assignments era
       INNER JOIN app_roles ar ON ar.id = era.role_id
       WHERE era.employee_id = ?
       ORDER BY ar.sort_order ASC, ar.id ASC`
    )
    .bind(employeeId)
    .all();

  const availableRoles = await env.DB
    .prepare('SELECT id, name, description, sort_order, is_system FROM app_roles ORDER BY sort_order ASC, id ASC')
    .all();

  return json({
    employee,
    disciplinaries: disciplinaries?.results || [],
    notes: notes?.results || [],
    assignedRoles: roleAssignments?.results || [],
    availableRoles: availableRoles?.results || [],
    capabilities: {
      canEditByRank,
      canAssignUserGroups: hasPermission(session, 'user_groups.assign') && canEditByRank
    }
  });
}

export async function onRequestPut(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.edit']);
  if (errorResponse) return errorResponse;

  const employeeId = Number(params.id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return json({ error: 'Invalid employee id.' }, 400);

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const existing = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  if (!existing) return json({ error: 'Employee not found.' }, 404);
  const actorEmployee = await getEmployeeByDiscordUserId(env, session.userId);
  const canEditByRank = actorEmployee
    ? await canEditEmployeeByRank(env, actorEmployee, existing)
    : false;
  if (!hasPermission(session, 'admin.override') && !canEditByRank) {
    return json({ error: 'You cannot edit employees with a higher rank than yours.' }, 403);
  }
  const duplicate = await findDuplicateEmployee(
    env,
    {
      robloxUsername: payload?.robloxUsername,
      robloxUserId: payload?.robloxUserId
    },
    employeeId
  );
  if (duplicate) {
    if (
      normalizeText(duplicate.roblox_username).toLowerCase() === normalizeText(payload?.robloxUsername).toLowerCase() &&
      normalizeText(payload?.robloxUsername)
    ) {
      return json({ error: 'Roblox Username already exists for another employee.' }, 400);
    }
    if (normalizeText(duplicate.roblox_user_id) === normalizeText(payload?.robloxUserId) && normalizeText(payload?.robloxUserId)) {
      return json({ error: 'Roblox User ID already exists for another employee.' }, 400);
    }
    return json({ error: 'Roblox Username/User ID must be unique.' }, 400);
  }

  await env.DB.prepare(
    `UPDATE employees
     SET roblox_username = ?,
         roblox_user_id = ?,
         rank = ?,
         grade = ?,
         serial_number = ?,
         employee_status = ?,
         hire_date = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(
      String(payload?.robloxUsername || '').trim(),
      String(payload?.robloxUserId || '').trim(),
      String(payload?.rank || '').trim(),
      String(payload?.grade || '').trim(),
      String(payload?.serialNumber || '').trim(),
      String(payload?.employeeStatus || '').trim(),
      String(payload?.hireDate || '').trim(),
      employeeId
    )
    .run();

  const roleIds = Array.isArray(payload?.roleIds)
    ? [...new Set(payload.roleIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
    : null;
  if (roleIds) {
    if (!hasPermission(session, 'user_groups.assign')) {
      return json({ error: 'Forbidden. Missing required permission.' }, 403);
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM employee_role_assignments WHERE employee_id = ?').bind(employeeId),
      ...roleIds.map((roleId) =>
        env.DB.prepare('INSERT OR IGNORE INTO employee_role_assignments (employee_id, role_id) VALUES (?, ?)').bind(employeeId, roleId)
      )
    ]);
  }

  const employee = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  if (!employee) return json({ error: 'Employee not found.' }, 404);

  const actor = session.displayName || session.userId;
  const changes = buildChangeEntries(existing, employee);
  if (changes.length) {
    await env.DB.batch(
      changes.map((entry) =>
        env.DB
          .prepare('INSERT INTO employee_notes (employee_id, note, authored_by) VALUES (?, ?, ?)')
          .bind(employeeId, `[Activity] ${entry.actionType}: ${entry.details}`, actor)
      )
    );
  }

  return json({ employee });
}
