import { ensureCoreSchema, getEmployeeByDiscordUserId } from './db.js';

export const SUPER_ADMIN_PERMISSION = 'super.admin';
export const ADMIN_OVERRIDE_PERMISSION = 'admin.override';

const PERMISSION_ALIASES = {
  'roles.read': 'user_groups.read',
  'roles.manage': 'user_groups.manage',
  'roles.assign': 'user_groups.assign',
  'user_groups.read': 'roles.read',
  'user_groups.manage': 'roles.manage',
  'user_groups.assign': 'roles.assign',

  // College capability aliases (legacy <-> capability keys)
  'college:admin': 'college.manage',
  'college:read': 'college.view',
  'college:manage_users': 'college.manage',
  'college:manage_courses': 'college.courses.manage',
  'college:manage_library': 'college.library.manage',
  'college:manage_exams': 'college.exams.manage',
  'college:mark_exams': 'college.exams.grade',
  'college:audit_read': 'college.manage',
  'course:manage': 'college.courses.manage',
  'enrollment:manage': 'college.enrollments.manage',
  'progress:view': 'college.manage',
  'progress:override': 'college.exams.grade',
  'exam:view': 'college.exams.manage',
  'exam:mark': 'college.exams.grade',
  'library:manage': 'college.library.manage',
  'library:view': 'college.view',

  'college.manage': 'college:admin',
  'college.view': 'college:read',
  'college.courses.manage': 'course:manage',
  'college.enrollments.manage': 'enrollment:manage',
  'college.exams.grade': 'exam:mark',
  'college.exams.manage': 'exam:view',
  'college.library.manage': 'library:manage'
};

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
    key: 'user_groups',
    label: 'User Groups',
    permissions: [
      { key: 'user_groups.read', label: 'View User Groups', description: 'View user group definitions and permissions.' },
      { key: 'user_groups.manage', label: 'Manage User Groups', description: 'Create, edit, delete, and reorder user groups.' },
      { key: 'user_groups.assign', label: 'Assign User Groups', description: 'Assign and unassign user groups for employees.' }
    ]
  },
  {
    key: 'user_ranks',
    label: 'User Ranks',
    permissions: [
      { key: 'user_ranks.manage', label: 'Manage User Ranks', description: 'Create, edit, delete, and reorder user ranks.' },
      {
        key: 'user_ranks.permissions.manage',
        label: 'Manage User Rank Permissions',
        description: 'Edit permission mappings granted by user ranks.'
      }
    ]
  },
  {
    key: 'admin',
    label: 'Admin',
    permissions: [
      { key: ADMIN_OVERRIDE_PERMISSION, label: 'Admin Override', description: 'Grant all permissions across the application.' }
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
  },
  {
    key: 'finances',
    label: 'Finances',
    permissions: [
      { key: 'finances.view', label: 'View Finances', description: 'View the finance dashboard and debt summaries.' },
      { key: 'finances.debts.settle', label: 'Settle Finance Debts', description: 'Settle outstanding company share debts.' },
      { key: 'finances.audit.view', label: 'View Finance Audit', description: 'View finance settlement audit logs.' }
    ]
  },
  {
    key: 'college',
    label: 'College',
    permissions: [
      { key: 'college.view', label: 'View College', description: 'Access the college training centre.' },
      { key: 'college.manage', label: 'Manage College', description: 'Manage college deadlines and pass overrides.' },
      { key: 'college.roles.manage', label: 'Manage College Roles', description: 'Assign college-scoped roles.' },
      { key: 'college.enrollments.manage', label: 'Manage College Enrollments', description: 'Enroll or remove users from courses.' },
      { key: 'college.courses.manage', label: 'Manage College Courses', description: 'Create and update college courses/modules.' },
      { key: 'college.library.manage', label: 'Manage College Library', description: 'Create and publish college library documents.' },
      { key: 'college.exams.manage', label: 'Manage College Exams', description: 'Create/update college exams and question banks.' },
      { key: 'college.exams.grade', label: 'Grade College Exams', description: 'Grade and override exam attempts.' },
      { key: 'college:read', label: 'College Read', description: 'Read college training pages and allowed resources.' },
      { key: 'college:manage_users', label: 'College Manage Users', description: 'Create, extend, fail, pass, and withdraw trainees.' },
      { key: 'college:manage_courses', label: 'College Manage Courses', description: 'Create, edit, publish, and archive courses/modules.' },
      { key: 'college:manage_library', label: 'College Manage Library', description: 'Create, edit, publish, and archive library documents.' },
      { key: 'college:manage_exams', label: 'College Manage Exams', description: 'Create and maintain exams and question banks.' },
      { key: 'college:mark_exams', label: 'College Mark Exams', description: 'Mark exam attempts and override module completion.' },
      { key: 'college:audit_read', label: 'College Audit Read', description: 'Read college audit log events.' },
      { key: 'college:admin', label: 'College Admin', description: 'Manage all college administration features.' },
      { key: 'course:manage', label: 'Course Manage', description: 'Create, edit, publish, and archive courses/modules/material.' },
      { key: 'enrollment:manage', label: 'Enrollment Manage', description: 'Manage course enrollments and required flags.' },
      { key: 'progress:view', label: 'Progress View', description: 'View progress for other users.' },
      { key: 'progress:override', label: 'Progress Override', description: 'Override module progress and assessment outcomes.' },
      { key: 'exam:view', label: 'Exam View', description: 'View exam definitions and attempts.' },
      { key: 'exam:mark', label: 'Exam Mark', description: 'Mark exam attempts pass/fail.' },
      { key: 'library:manage', label: 'Library Manage', description: 'Create, update, map, and publish college library docs.' },
      { key: 'library:view', label: 'Library View', description: 'View college library documents per visibility rules.' }
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
  const allowed = new Set([...getPermissionKeys(), SUPER_ADMIN_PERMISSION, ...Object.keys(PERMISSION_ALIASES)]);
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map((value) => String(value || '').trim()).filter((value) => allowed.has(value)))];
}

function expandPermissionAliases(values) {
  const normalized = normalizePermissionKeys(values);
  const expanded = new Set(normalized);
  normalized.forEach((permission) => {
    const alias = PERMISSION_ALIASES[permission];
    if (alias) expanded.add(alias);
  });
  return [...expanded];
}

export function hasPermission(session, permissionKey) {
  if (!session || !permissionKey) return false;
  const permissions = expandPermissionAliases(Array.isArray(session.permissions) ? session.permissions : []);
  const requested = String(permissionKey || '').trim();
  const requestedAlias = PERMISSION_ALIASES[requested];
  return (
    permissions.includes(SUPER_ADMIN_PERMISSION) ||
    permissions.includes(ADMIN_OVERRIDE_PERMISSION) ||
    permissions.includes(requested) ||
    (requestedAlias ? permissions.includes(requestedAlias) : false)
  );
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

  const normalizedPermissions = expandPermissionAliases(
    isSuperAdmin
      ? [...permissions, ...rankPermissions, SUPER_ADMIN_PERMISSION, ADMIN_OVERRIDE_PERMISSION, ...getPermissionKeys()]
      : [...permissions, ...rankPermissions]
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
