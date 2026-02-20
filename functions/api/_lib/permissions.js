import { ensureCoreSchema, getEmployeeByDiscordUserId } from './db.js';

export const SUPER_ADMIN_PERMISSION = 'super.admin';

export const PERMISSION_GROUPS = [
  {
    key: 'general',
    label: 'General',
    permissions: [
      { key: 'admin.access', label: 'Admin Panel Access', description: 'View the admin panel entry points.' },
      { key: 'dashboard.view', label: 'Dashboard View', description: 'Access the intranet dashboard.' },
      { key: 'my_details.view', label: 'My Details View', description: 'View employee self-service details.' }
    ]
  },
  {
    key: 'employees',
    label: 'Employees',
    permissions: [
      { key: 'employees.read', label: 'View Employees', description: 'View employee lists and employee profiles.' },
      { key: 'employees.create', label: 'Create Employees', description: 'Create employee records.' },
      { key: 'employees.edit', label: 'Edit Employees', description: 'Edit employee profile fields.' },
      { key: 'employees.discipline', label: 'Manage Discipline', description: 'Create and update disciplinary records.' },
      { key: 'employees.notes', label: 'Manage Notes', description: 'Add employee notes and activity log entries.' },
      {
        key: 'employees.access_requests.review',
        label: 'Review Access Requests',
        description: 'Approve or deny employee access requests.'
      }
    ]
  },
  {
    key: 'config',
    label: 'System Config',
    permissions: [
      { key: 'config.manage', label: 'Manage Config', description: 'Manage statuses, ranks, grades, and disciplinary types.' }
    ]
  },
  {
    key: 'roles',
    label: 'Roles',
    permissions: [
      { key: 'roles.read', label: 'View Roles', description: 'View role definitions and permissions.' },
      { key: 'roles.manage', label: 'Manage Roles', description: 'Create, edit, delete, and reorder roles.' },
      { key: 'roles.assign', label: 'Assign Roles', description: 'Assign and unassign roles for employees.' }
    ]
  },
  {
    key: 'activity_tracker',
    label: 'Activity Tracker',
    permissions: [
      { key: 'activity_tracker.view', label: 'View Activity Tracker', description: 'View voyage activity statistics for employees.' },
      { key: 'activity_tracker.manage', label: 'Manage Activity Tracker', description: 'Manage advanced activity tracker actions.' }
    ]
  },
  {
    key: 'forms',
    label: 'Forms',
    permissions: [
      { key: 'forms.read', label: 'View Forms', description: 'View forms list and form details.' },
      { key: 'forms.submit', label: 'Submit Forms', description: 'Submit form responses.' },
      { key: 'forms.manage', label: 'Manage Forms', description: 'Create/edit forms, categories, and question builders.' },
      { key: 'forms.responses.read', label: 'View Form Responses', description: 'Read form responses.' },
      { key: 'forms.responses.manage', label: 'Manage Form Responses', description: 'Manage/export/delete responses.' }
    ]
  },
  {
    key: 'voyages',
    label: 'Voyages & Fleet',
    permissions: [
      { key: 'voyages.read', label: 'View Voyages', description: 'View voyage tracker.' },
      { key: 'voyages.create', label: 'Create Voyages', description: 'Create voyage entries.' },
      { key: 'voyages.edit', label: 'Edit Voyages', description: 'Edit voyage entries.' },
      { key: 'voyages.end', label: 'End Voyages', description: 'End voyages and finalize voyage accounting.' },
      { key: 'voyages.config.manage', label: 'Manage Voyage Config', description: 'Manage voyage config lists for ports and vessels.' },
      { key: 'cargo.manage', label: 'Manage Cargo', description: 'Manage cargo type definitions for manifests.' },
      { key: 'fleet.read', label: 'View Fleet', description: 'View fleet information.' },
      { key: 'fleet.manage', label: 'Manage Fleet', description: 'Manage fleet assignments/settings.' }
    ]
  }
];

export function getPermissionCatalog() {
  return PERMISSION_GROUPS.flatMap((group) =>
    group.permissions.map((permission) => ({
      ...permission,
      group: group.key,
      groupLabel: group.label
    }))
  );
}

export function getPermissionKeys() {
  return getPermissionCatalog().map((permission) => permission.key);
}

export function normalizePermissionKeys(values) {
  const allowed = new Set([...getPermissionKeys(), SUPER_ADMIN_PERMISSION]);
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map((value) => String(value || '').trim()).filter((value) => allowed.has(value)))];
}

export function hasPermission(session, permissionKey) {
  if (!session || !permissionKey) return false;
  const permissions = Array.isArray(session.permissions) ? session.permissions : [];
  return permissions.includes(SUPER_ADMIN_PERMISSION) || permissions.includes(permissionKey);
}

export function hasAnyPermission(session, permissionKeys) {
  if (!Array.isArray(permissionKeys) || permissionKeys.length === 0) return true;
  return permissionKeys.some((permissionKey) => hasPermission(session, permissionKey));
}

async function getMappedRoleIdsByDiscordRoles(env, discordRoleIds) {
  if (!Array.isArray(discordRoleIds) || discordRoleIds.length === 0) return [];
  const normalizedRoleIds = [...new Set(discordRoleIds.map((value) => String(value || '').trim()).filter(Boolean))];
  if (!normalizedRoleIds.length) return [];

  const placeholders = normalizedRoleIds.map(() => '?').join(', ');
  const result = await env.DB
    .prepare(`SELECT role_id FROM auth_role_mappings WHERE discord_role_id IN (${placeholders})`)
    .bind(...normalizedRoleIds)
    .all();

  return [...new Set((result?.results || []).map((row) => Number(row.role_id)).filter((value) => Number.isInteger(value) && value > 0))];
}

async function getAssignedRoleIdsByEmployeeId(env, employeeId) {
  if (!Number.isInteger(employeeId) || employeeId <= 0) return [];
  const result = await env.DB
    .prepare('SELECT role_id FROM employee_role_assignments WHERE employee_id = ?')
    .bind(employeeId)
    .all();

  return [...new Set((result?.results || []).map((row) => Number(row.role_id)).filter((value) => Number.isInteger(value) && value > 0))];
}

async function getRolePermissions(env, roleIds) {
  if (!Array.isArray(roleIds) || roleIds.length === 0) return { roles: [], permissions: [] };

  const placeholders = roleIds.map(() => '?').join(', ');
  const roleRows = await env.DB
    .prepare(`SELECT id, name, description, sort_order FROM app_roles WHERE id IN (${placeholders}) ORDER BY sort_order ASC, id ASC`)
    .bind(...roleIds)
    .all();

  const permissionRows = await env.DB
    .prepare(
      `SELECT DISTINCT arp.permission_key
       FROM app_role_permissions arp
       WHERE arp.role_id IN (${placeholders})`
    )
    .bind(...roleIds)
    .all();

  return {
    roles: roleRows?.results || [],
    permissions: normalizePermissionKeys((permissionRows?.results || []).map((row) => row.permission_key))
  };
}

async function getRankPermissions(env, rankValue) {
  const rank = String(rankValue || '').trim();
  if (!rank) return [];
  const rows = await env.DB
    .prepare(
      `SELECT DISTINCT permission_key
       FROM rank_permission_mappings
       WHERE LOWER(rank_value) = LOWER(?)`
    )
    .bind(rank)
    .all();
  return normalizePermissionKeys((rows?.results || []).map((row) => row.permission_key));
}

export async function buildPermissionContext(env, { discordUserId, discordRoleIds = [], isSuperAdmin = false } = {}) {
  await ensureCoreSchema(env);

  const employee = discordUserId ? await getEmployeeByDiscordUserId(env, discordUserId) : null;
  const assignedRoleIds = employee ? await getAssignedRoleIdsByEmployeeId(env, Number(employee.id)) : [];
  const mappedRoleIds = await getMappedRoleIdsByDiscordRoles(env, discordRoleIds);

  const appRoleIds = [...new Set([...assignedRoleIds, ...mappedRoleIds])];
  const { roles, permissions } = await getRolePermissions(env, appRoleIds);
  const rankPermissions = await getRankPermissions(env, employee?.rank);

  const normalizedPermissions = normalizePermissionKeys(
    isSuperAdmin ? [...permissions, ...rankPermissions, SUPER_ADMIN_PERMISSION, ...getPermissionKeys()] : [...permissions, ...rankPermissions]
  );

  return {
    employee,
    appRoleIds,
    appRoles: roles,
    permissions: normalizedPermissions,
    isSuperAdmin: Boolean(isSuperAdmin)
  };
}

export async function enrichSessionWithPermissions(env, session) {
  if (!session) return null;
  const context = await buildPermissionContext(env, {
    discordUserId: session.userId,
    discordRoleIds: Array.isArray(session.discordRoles)
      ? session.discordRoles
      : Array.isArray(session.roles)
      ? session.roles
      : [],
    isSuperAdmin: Boolean(session.isAdmin)
  });

  return {
    ...session,
    roles: Array.isArray(session.discordRoles)
      ? session.discordRoles
      : Array.isArray(session.roles)
      ? session.roles
      : [],
    appRoleIds: context.appRoleIds,
    appRoles: context.appRoles,
    permissions: context.permissions,
    employee: context.employee
  };
}
