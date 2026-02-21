import { json, readSessionFromRequest } from './_lib/auth.js';
import { createOrRefreshAccessRequest, getEmployeeByDiscordUserId } from '../_lib/db.js';
import { buildPermissionContext, hasPermission } from '../_lib/permissions.js';

export async function onRequest(context) {
  const { env, request } = context;
  if (!env.SESSION_SECRET) {
    return json({ loggedIn: false, error: 'SESSION_SECRET is not configured.' }, 500);
  }

  const payload = await readSessionFromRequest(env, request);

  if (!payload) {
    return json({ loggedIn: false });
  }

  let employee = null;
  let permissionContext = null;
  let collegeProfile = null;
  try {
    permissionContext = await buildPermissionContext(env, {
      discordUserId: payload.userId,
      discordRoleIds: Array.isArray(payload.discordRoles) ? payload.discordRoles : [],
      isSuperAdmin: Boolean(payload.isAdmin)
    });
    employee = permissionContext.employee;
    if (employee?.id) {
      collegeProfile = await env.DB
        .prepare(
          `SELECT trainee_status, start_at, due_at, passed_at
           FROM college_profiles
           WHERE user_employee_id = ?
           LIMIT 1`
        )
        .bind(Number(employee.id))
        .first();
    }
    if (!payload.isAdmin && !employee) {
      await createOrRefreshAccessRequest(env, {
        discordUserId: payload.userId,
        displayName: payload.displayName
      });
    }
  } catch (error) {
    return json({ loggedIn: false, error: error.message || 'Database error.' }, 500);
  }

  const collegeTraineeStatus = String(
    collegeProfile?.trainee_status ||
      (employee?.college_passed_at ? 'TRAINEE_PASSED' : String(employee?.user_status || payload.userStatus || '').trim().toUpperCase() === 'APPLICANT_ACCEPTED' ? 'TRAINEE_ACTIVE' : 'NOT_A_TRAINEE')
  )
    .trim()
    .toUpperCase();
  const collegeStartAt = collegeProfile?.start_at || employee?.college_start_at || payload.collegeStartAt || null;
  const collegeDueAt = collegeProfile?.due_at || employee?.college_due_at || payload.collegeDueAt || null;
  const collegePassedAt = collegeProfile?.passed_at || employee?.college_passed_at || payload.collegePassedAt || null;
  const collegeRestricted = !payload.isAdmin && collegeTraineeStatus === 'TRAINEE_ACTIVE' && !collegePassedAt;

  return json({
    loggedIn: true,
    userId: payload.userId,
    displayName: payload.displayName,
    roles: Array.isArray(payload.discordRoles) ? payload.discordRoles : [],
    appRoleIds: permissionContext?.appRoleIds || [],
    appRoles: permissionContext?.appRoles || [],
    permissions: permissionContext?.permissions || [],
    isAdmin: Boolean(payload.isAdmin),
    hasFormsAdmin: hasPermission({ permissions: permissionContext?.permissions || [] }, 'forms.manage'),
    hasEmployee: payload.isAdmin ? true : Boolean(employee),
    accessPending: payload.isAdmin ? false : !employee,
    userStatus: String(employee?.user_status || payload.userStatus || '').trim() || 'ACTIVE_STAFF',
    collegeTraineeStatus,
    collegeStartAt,
    collegeDueAt,
    collegePassedAt,
    collegeRestricted,
    canAccessCollege:
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college.view') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college:read') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college.manage') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college:manage_users') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college:manage_courses') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college:manage_library') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college:manage_exams') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college:mark_exams') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college:audit_read') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college.roles.manage') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college.enrollments.manage') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college.courses.manage') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college.library.manage') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college.exams.manage') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college.exams.grade') ||
      collegeTraineeStatus === 'TRAINEE_ACTIVE',
    canManageCollege:
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college.manage') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college:admin') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college:manage_users') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college:manage_courses') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college:manage_library') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college:manage_exams') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college:mark_exams') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college.roles.manage') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college.enrollments.manage') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college.courses.manage') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college.library.manage') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college.exams.manage') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'college.exams.grade') ||
      hasPermission({ permissions: permissionContext?.permissions || [] }, 'admin.override'),
    canAccessAdminPanel: hasPermission({ permissions: permissionContext?.permissions || [] }, 'admin.access'),
    canManageRoles: hasPermission({ permissions: permissionContext?.permissions || [] }, 'user_groups.manage'),
    canManageConfig: hasPermission({ permissions: permissionContext?.permissions || [] }, 'config.manage'),
    canReadFormResponses: hasPermission({ permissions: permissionContext?.permissions || [] }, 'forms.responses.read')
  });
}
