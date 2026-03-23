import { json } from '../../../auth/_lib/auth.js';
import { getActorAccessScope, canManageRoleRowByHierarchy, canViewEmployeeByHierarchy } from '../../_lib/access-scope.js';
import { requirePermission } from '../../_lib/admin-auth.js';

function toId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function text(value) {
  return String(value || '').trim();
}

async function getRoleRow(env, roleId) {
  return env.DB
    .prepare("SELECT id, name, sort_order FROM app_roles WHERE id = ? AND COALESCE(role_key, '') NOT IN ('owner', 'employee')")
    .bind(roleId)
    .first();
}

async function assertRoleManageable(env, scope, roleId) {
  const role = await getRoleRow(env, roleId);
  if (!role) return { error: json({ error: 'Role not found.' }, 404), role: null };
  if (!canManageRoleRowByHierarchy(scope, role)) {
    return { error: json({ error: 'You cannot manage this role by hierarchy.' }, 403), role };
  }
  return { error: null, role };
}

async function listMembers(env, roleId) {
  const result = await env.DB
    .prepare(
      `SELECT e.id, e.roblox_username, e.roblox_user_id, e.rank, e.grade, e.serial_number, e.employee_status, e.activation_status
       FROM employee_role_assignments era
       INNER JOIN employees e ON e.id = era.employee_id
       WHERE era.role_id = ?
       ORDER BY e.roblox_username ASC, e.id ASC`
    )
    .bind(roleId)
    .all();
  return result?.results || [];
}

async function listCandidates(env, roleId, query, limit) {
  if (!query) return [];
  const rows = await env.DB
    .prepare(
      `SELECT e.id, e.roblox_username, e.roblox_user_id, e.rank, e.grade, e.serial_number, e.employee_status, e.activation_status
       FROM employees e
       LEFT JOIN employee_role_assignments era
         ON era.employee_id = e.id AND era.role_id = ?
       WHERE era.role_id IS NULL
         AND (
           LOWER(COALESCE(e.roblox_username, '')) LIKE ?
           OR LOWER(COALESCE(e.serial_number, '')) LIKE ?
           OR LOWER(COALESCE(e.discord_display_name, '')) LIKE ?
         )
       ORDER BY e.roblox_username ASC, e.id ASC
       LIMIT ?`
    )
    .bind(roleId, `%${query}%`, `%${query}%`, `%${query}%`, limit)
    .all();
  return rows?.results || [];
}

export async function onRequestGet(context) {
  const { env, params, request } = context;
  const { errorResponse, session } = await requirePermission(context, ['user_groups.assign']);
  if (errorResponse) return errorResponse;

  const roleId = toId(params.id);
  if (!roleId) return json({ error: 'Invalid role id.' }, 400);

  const scope = await getActorAccessScope(env, session);
  const { error } = await assertRoleManageable(env, scope, roleId);
  if (error) return error;

  const url = new URL(request.url);
  const query = text(url.searchParams.get('query')).toLowerCase();
  const limit = Math.min(20, Math.max(1, Number(url.searchParams.get('limit')) || 10));

  const [membersRaw, candidatesRaw] = await Promise.all([
    listMembers(env, roleId),
    listCandidates(env, roleId, query, limit)
  ]);

  const members = [];
  for (const row of membersRaw) {
    if (await canViewEmployeeByHierarchy(env, scope, row, { allowSelf: true, allowEqual: false })) {
      members.push(row);
    }
  }

  const candidates = [];
  for (const row of candidatesRaw) {
    if (await canViewEmployeeByHierarchy(env, scope, row, { allowSelf: true, allowEqual: false })) {
      candidates.push(row);
    }
  }

  return json({ members, candidates });
}

export async function onRequestPost(context) {
  const { env, params, request } = context;
  const { errorResponse, session } = await requirePermission(context, ['user_groups.assign']);
  if (errorResponse) return errorResponse;

  const roleId = toId(params.id);
  if (!roleId) return json({ error: 'Invalid role id.' }, 400);

  const scope = await getActorAccessScope(env, session);
  const { error } = await assertRoleManageable(env, scope, roleId);
  if (error) return error;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const employeeId = toId(payload?.employeeId);
  if (!employeeId) return json({ error: 'employeeId is required.' }, 400);

  const employee = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  if (!employee) return json({ error: 'Employee not found.' }, 404);

  const allowed = await canViewEmployeeByHierarchy(env, scope, employee, { allowSelf: true, allowEqual: false });
  if (!allowed) return json({ error: 'You cannot manage this employee by hierarchy.' }, 403);

  await env.DB
    .prepare('INSERT OR IGNORE INTO employee_role_assignments (employee_id, role_id) VALUES (?, ?)')
    .bind(employeeId, roleId)
    .run();

  const members = await listMembers(env, roleId);
  return json({ ok: true, members });
}

export async function onRequestDelete(context) {
  const { env, params, request } = context;
  const { errorResponse, session } = await requirePermission(context, ['user_groups.assign']);
  if (errorResponse) return errorResponse;

  const roleId = toId(params.id);
  if (!roleId) return json({ error: 'Invalid role id.' }, 400);

  const scope = await getActorAccessScope(env, session);
  const { error } = await assertRoleManageable(env, scope, roleId);
  if (error) return error;

  const url = new URL(request.url);
  const employeeId = toId(url.searchParams.get('employeeId'));
  if (!employeeId) return json({ error: 'employeeId is required.' }, 400);

  const employee = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  if (!employee) return json({ error: 'Employee not found.' }, 404);

  const allowed = await canViewEmployeeByHierarchy(env, scope, employee, { allowSelf: true, allowEqual: false });
  if (!allowed) return json({ error: 'You cannot manage this employee by hierarchy.' }, 403);

  await env.DB
    .prepare('DELETE FROM employee_role_assignments WHERE employee_id = ? AND role_id = ?')
    .bind(employeeId, roleId)
    .run();

  const members = await listMembers(env, roleId);
  return json({ ok: true, members });
}
