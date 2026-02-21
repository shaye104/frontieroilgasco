import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { ensureCoreSchema } from './db.js';
import { enrichSessionWithPermissions, hasPermission } from './permissions.js';

export const USER_STATUSES = {
  APPLICANT_ACCEPTED: 'APPLICANT_ACCEPTED',
  ACTIVE_STAFF: 'ACTIVE_STAFF',
  INSTRUCTOR: 'INSTRUCTOR',
  COLLEGE_ADMIN: 'COLLEGE_ADMIN'
};

export const COLLEGE_TRAINEE_STATUSES = {
  NOT_A_TRAINEE: 'NOT_A_TRAINEE',
  TRAINEE_ACTIVE: 'TRAINEE_ACTIVE',
  TRAINEE_PASSED: 'TRAINEE_PASSED',
  TRAINEE_FAILED: 'TRAINEE_FAILED',
  TRAINEE_WITHDRAWN: 'TRAINEE_WITHDRAWN'
};

export const COLLEGE_ROLE_KEYS = ['COLLEGE_ADMIN', 'INSTRUCTOR', 'EXAMINER', 'TRAINEE', 'STAFF_VIEWER'];
export const COLLEGE_CAPABILITIES = [
  'college:read',
  'college:admin',
  'college:manage_users',
  'college:manage_courses',
  'college:manage_library',
  'college:manage_exams',
  'college:mark_exams',
  'college:audit_read',
  'course:manage',
  'enrollment:manage',
  'progress:view',
  'progress:override',
  'exam:view',
  'exam:mark',
  'library:manage',
  'library:view'
];

const COLLEGE_CAPABILITY_PERMISSION_MAP = {
  'college:read': ['college:read', 'college.view', 'library:view', 'college:admin'],
  'college:admin': [
    'college:admin',
    'college.manage',
    'college.roles.manage',
    'college.enrollments.manage',
    'college.courses.manage',
    'college.library.manage',
    'college.exams.manage',
    'admin.override'
  ],
  'college:manage_users': [
    'college:manage_users',
    'college.manage',
    'college.roles.manage',
    'college.enrollments.manage',
    'college:admin'
  ],
  'college:manage_courses': ['college:manage_courses', 'college.courses.manage', 'course:manage', 'college:admin'],
  'college:manage_library': ['college:manage_library', 'college.library.manage', 'library:manage', 'college:admin'],
  'college:manage_exams': ['college:manage_exams', 'college.exams.manage', 'exam:view', 'college:admin'],
  'college:mark_exams': ['college:mark_exams', 'college.exams.grade', 'exam:mark', 'college:admin'],
  'college:audit_read': ['college:audit_read', 'college.manage', 'college:admin'],
  'course:manage': ['course:manage', 'college.courses.manage', 'college.manage', 'college:admin'],
  'enrollment:manage': ['enrollment:manage', 'college.enrollments.manage', 'college.manage', 'college:admin'],
  'progress:view': ['progress:view', 'college.manage', 'college:admin'],
  'progress:override': ['progress:override', 'college.exams.grade', 'college.manage', 'college:admin'],
  'exam:view': ['exam:view', 'college.exams.manage', 'college.exams.grade', 'college.manage', 'college:admin'],
  'exam:mark': ['exam:mark', 'college.exams.grade', 'college.manage', 'college:admin'],
  'library:manage': ['library:manage', 'college.library.manage', 'college.manage', 'college:admin'],
  'library:view': ['library:view', 'college.view', 'college.manage', 'college:admin']
};

const COLLEGE_ROLE_CAPABILITIES = {
  COLLEGE_ADMIN: COLLEGE_CAPABILITIES,
  INSTRUCTOR: [
    'college:read',
    'college:manage_courses',
    'college:manage_library',
    'college:mark_exams',
    'course:manage',
    'progress:view',
    'exam:view',
    'library:manage',
    'library:view'
  ],
  EXAMINER: [
    'college:read',
    'college:manage_exams',
    'college:mark_exams',
    'exam:view',
    'exam:mark',
    'progress:view',
    'progress:override',
    'library:view'
  ],
  TRAINEE: ['college:read', 'library:view'],
  STAFF_VIEWER: ['college:read', 'library:view']
};

function normalizeTraineeStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  if (Object.values(COLLEGE_TRAINEE_STATUSES).includes(status)) return status;
  return COLLEGE_TRAINEE_STATUSES.NOT_A_TRAINEE;
}

function deriveLegacyTraineeStatus(employee = null) {
  if (!employee) return COLLEGE_TRAINEE_STATUSES.NOT_A_TRAINEE;
  if (employee.college_passed_at) return COLLEGE_TRAINEE_STATUSES.TRAINEE_PASSED;
  const userStatus = normalizeUserStatus(employee.user_status);
  if (userStatus === USER_STATUSES.APPLICANT_ACCEPTED) return COLLEGE_TRAINEE_STATUSES.TRAINEE_ACTIVE;
  return COLLEGE_TRAINEE_STATUSES.NOT_A_TRAINEE;
}

export function normalizeCollegeRoleKey(value) {
  const role = String(value || '').trim().toUpperCase();
  return COLLEGE_ROLE_KEYS.includes(role) ? role : null;
}

export async function getCollegeRoleKeysForEmployee(env, employeeId) {
  const id = Number(employeeId || 0);
  if (!Number.isInteger(id) || id <= 0) return [];
  const rows = await env.DB
    .prepare(
      `SELECT role_key
       FROM college_role_assignments
       WHERE employee_id = ?
       ORDER BY role_key ASC`
    )
    .bind(id)
    .all();

  return [...new Set((rows?.results || []).map((row) => normalizeCollegeRoleKey(row.role_key)).filter(Boolean))];
}

export async function getCollegeProfileForEmployee(env, employee = null) {
  const employeeId = Number(employee?.id || 0);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return null;

  const existing = await env.DB
    .prepare(
      `SELECT
         user_employee_id,
         trainee_status,
         start_at,
         due_at,
         passed_at,
         failed_at,
         assigned_by_user_employee_id,
         last_activity_at,
         notes
       FROM college_profiles
       WHERE user_employee_id = ?
       LIMIT 1`
    )
    .bind(employeeId)
    .first();
  if (existing) {
    return {
      userEmployeeId: Number(existing.user_employee_id || 0),
      traineeStatus: normalizeTraineeStatus(existing.trainee_status),
      startAt: existing.start_at || null,
      dueAt: existing.due_at || null,
      passedAt: existing.passed_at || null,
      failedAt: existing.failed_at || null,
      assignedByUserEmployeeId: Number(existing.assigned_by_user_employee_id || 0) || null,
      lastActivityAt: existing.last_activity_at || null,
      notes: String(existing.notes || '').trim() || null
    };
  }

  const legacyStatus = deriveLegacyTraineeStatus(employee);
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO college_profiles
       (user_employee_id, trainee_status, start_at, due_at, passed_at, assigned_by_user_employee_id, last_activity_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(
      employeeId,
      legacyStatus,
      employee?.college_start_at || null,
      employee?.college_due_at || null,
      employee?.college_passed_at || null
    )
    .run();

  return {
    userEmployeeId: employeeId,
    traineeStatus: legacyStatus,
    startAt: employee?.college_start_at || null,
    dueAt: employee?.college_due_at || null,
    passedAt: employee?.college_passed_at || null,
    failedAt: null,
    assignedByUserEmployeeId: null,
    lastActivityAt: null,
    notes: null
  };
}

function normalizeCapability(value) {
  const capability = String(value || '').trim();
  return COLLEGE_CAPABILITIES.includes(capability) ? capability : null;
}

export function hasCollegeCapability(session, roleKeys = [], capability, options = {}) {
  const normalizedCapability = normalizeCapability(capability);
  if (!normalizedCapability) return false;
  if (
    session?.isAdmin ||
    hasPermission(session, 'admin.override') ||
    hasPermission(session, 'super.admin') ||
    hasPermission(session, 'admin.access')
  ) {
    return true;
  }

  const restricted = Boolean(options.restricted);
  const permittedByRole = (Array.isArray(roleKeys) ? roleKeys : []).some((roleKey) => {
    const normalizedRole = normalizeCollegeRoleKey(roleKey);
    if (!normalizedRole) return false;
    const capabilities = COLLEGE_ROLE_CAPABILITIES[normalizedRole] || [];
    return capabilities.includes(normalizedCapability);
  });
  if (permittedByRole) return true;

  const permissionCandidates = COLLEGE_CAPABILITY_PERMISSION_MAP[normalizedCapability] || [normalizedCapability];
  if (permissionCandidates.some((permissionKey) => hasPermission(session, permissionKey))) return true;

  if (restricted && normalizedCapability === 'library:view') return true;
  return false;
}

export function getCollegeCapabilities(session, roleKeys = [], options = {}) {
  const restricted = Boolean(options.restricted);
  const capabilityState = {};
  COLLEGE_CAPABILITIES.forEach((capability) => {
    capabilityState[capability] = hasCollegeCapability(session, roleKeys, capability, { restricted });
  });
  return capabilityState;
}

function hasCollegeManagePermission(session, roleKeys = []) {
  return hasCollegeCapability(session, roleKeys, 'college:admin');
}

export function normalizeUserStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  if (!status) return USER_STATUSES.ACTIVE_STAFF;
  if (Object.values(USER_STATUSES).includes(status)) return status;
  return USER_STATUSES.ACTIVE_STAFF;
}

export function isCollegeRestrictedEmployee(employee, collegeProfile = null) {
  if (!employee) return false;
  const traineeStatus = normalizeTraineeStatus(collegeProfile?.traineeStatus || collegeProfile?.trainee_status || deriveLegacyTraineeStatus(employee));
  if (traineeStatus !== COLLEGE_TRAINEE_STATUSES.TRAINEE_ACTIVE) return false;
  return !employee.college_passed_at;
}

export async function requireCollegeSession(context, options = {}) {
  const { env, request } = context;
  const rawSession = await readSessionFromRequest(env, request);
  const session = rawSession ? await enrichSessionWithPermissions(env, rawSession) : null;
  if (!session) {
    return { errorResponse: json({ error: 'Authentication required.' }, 401), session: null, employee: null, isRestricted: false };
  }

  try {
    await ensureCoreSchema(env);
  } catch (error) {
    return { errorResponse: json({ error: error.message || 'Database unavailable.' }, 500), session: null, employee: null, isRestricted: false };
  }

  const employee = session.employee || null;
  if (!employee && !session.isAdmin) {
    return { errorResponse: json({ error: 'Employee profile required.' }, 403), session: null, employee: null, isRestricted: false };
  }

  const roleKeys = employee?.id ? await getCollegeRoleKeysForEmployee(env, employee.id) : [];
  const collegeProfile = employee?.id ? await getCollegeProfileForEmployee(env, employee) : null;
  const traineeStatus = normalizeTraineeStatus(collegeProfile?.traineeStatus || deriveLegacyTraineeStatus(employee));
  const isRestricted = isCollegeRestrictedEmployee(employee, collegeProfile);
  const capabilities = getCollegeCapabilities(session, roleKeys, { restricted: isRestricted });
  const canManage = Boolean(
    hasCollegeManagePermission(session, roleKeys) ||
      capabilities['college:manage_users'] ||
      capabilities['college:manage_courses'] ||
      capabilities['college:manage_library'] ||
      capabilities['college:manage_exams'] ||
      capabilities['college:mark_exams']
  );
  const canView = Boolean(canManage || capabilities['college:read'] || capabilities['library:view'] || session?.isAdmin || isRestricted);

  if (!canView) {
    return { errorResponse: json({ error: 'Forbidden. Missing required permission.' }, 403), session: null, employee: null, isRestricted: false };
  }

  if (options.requireManage && !canManage) {
    return { errorResponse: json({ error: 'Forbidden. Missing required permission.' }, 403), session: null, employee: null, isRestricted: false };
  }

  const requiredCapabilities = Array.isArray(options.requiredCapabilities)
    ? options.requiredCapabilities.map((capability) => normalizeCapability(capability)).filter(Boolean)
    : [];
  if (requiredCapabilities.length && !requiredCapabilities.every((capability) => capabilities[capability])) {
    return { errorResponse: json({ error: 'Forbidden. Missing required permission.' }, 403), session: null, employee: null, isRestricted: false };
  }

  const requiredAnyCapabilities = Array.isArray(options.requiredAnyCapabilities)
    ? options.requiredAnyCapabilities.map((capability) => normalizeCapability(capability)).filter(Boolean)
    : [];
  if (requiredAnyCapabilities.length && !requiredAnyCapabilities.some((capability) => capabilities[capability])) {
    return { errorResponse: json({ error: 'Forbidden. Missing required permission.' }, 403), session: null, employee: null, isRestricted: false };
  }

  return { errorResponse: null, session, employee, isRestricted, roleKeys, canManage, capabilities, collegeProfile, traineeStatus };
}

function toMoney(value) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
}

export async function enrollEmployeeInRequiredCollegeCourses(env, employeeId) {
  const id = Number(employeeId || 0);
  if (!Number.isInteger(id) || id <= 0) return;
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO college_enrollments
       (user_employee_id, course_id, required, status, enrolled_at)
       SELECT ?, c.id, 1, 'in_progress', CURRENT_TIMESTAMP
       FROM college_courses c
       WHERE c.published = 1
         AND c.archived_at IS NULL
         AND c.is_required_for_applicants = 1`
    )
    .bind(id)
    .run();
}

async function getEnrollmentStats(env, employeeId) {
  const rowsResult = await env.DB
    .prepare(
      `SELECT
         e.id,
         e.user_employee_id,
         e.course_id,
         e.required,
         e.status,
         e.final_quiz_passed,
         e.terms_acknowledged,
         e.practical_approved,
         e.passed_at,
         c.code,
         c.title,
         c.description,
         c.estimated_minutes,
         c.is_required_for_applicants,
         (
           SELECT COUNT(*) FROM college_course_modules m
           WHERE m.course_id = e.course_id
         ) AS total_modules,
         (
           SELECT COUNT(*)
           FROM college_module_progress mp
           INNER JOIN college_course_modules m ON m.id = mp.module_id
           WHERE mp.user_employee_id = e.user_employee_id
             AND m.course_id = e.course_id
             AND (
               mp.completed_at IS NOT NULL
               OR LOWER(COALESCE(mp.status, '')) = 'complete'
             )
         ) AS completed_modules
       FROM college_enrollments e
       INNER JOIN college_courses c ON c.id = e.course_id
       WHERE e.user_employee_id = ?
         AND LOWER(COALESCE(e.status, 'in_progress')) != 'removed'
       ORDER BY e.required DESC, c.code ASC, c.title ASC`
    )
    .bind(employeeId)
    .all();

  const rows = rowsResult?.results || [];
  const enriched = rows.map((row) => {
    const totalModules = Math.max(0, Number(row.total_modules || 0));
    const completedModules = Math.max(0, Number(row.completed_modules || 0));
    const progressPct = totalModules > 0 ? Math.min(100, toMoney((completedModules / totalModules) * 100)) : 0;
    return {
      enrollmentId: Number(row.id || 0),
      employeeId: Number(row.user_employee_id || 0),
      courseId: Number(row.course_id || 0),
      code: String(row.code || '').trim(),
      title: String(row.title || '').trim(),
      description: String(row.description || '').trim(),
      estimatedMinutes: Math.max(0, Number(row.estimated_minutes || 0)),
      required: Number(row.required || 0) === 1 || Number(row.is_required_for_applicants || 0) === 1,
      status: String(row.status || 'in_progress').trim(),
      finalQuizPassed: Number(row.final_quiz_passed || 0) === 1,
      termsAcknowledged: Number(row.terms_acknowledged || 0) === 1,
      practicalApproved: Number(row.practical_approved || 0) === 1,
      passedAt: row.passed_at || null,
      totalModules,
      completedModules,
      progressPct
    };
  });

  const requiredRows = enriched.filter((row) => row.required);
  const requiredCount = requiredRows.length;
  const completedRequired = requiredRows.filter((row) => row.progressPct >= 100).length;
  const quizPassed = requiredRows.every((row) => row.finalQuizPassed || row.totalModules === 0);
  const termsAck = requiredRows.every((row) => row.termsAcknowledged || row.totalModules === 0);
  const overallProgress = requiredCount
    ? toMoney(requiredRows.reduce((sum, row) => sum + row.progressPct, 0) / requiredCount)
    : 0;

  return {
    enrollments: enriched,
    requirements: {
      requiredCount,
      completedRequired,
      inductionCompleted: requiredCount > 0 && completedRequired === requiredCount,
      finalQuizPassed: quizPassed,
      termsAcknowledged: termsAck
    },
    overallProgress
  };
}

export async function evaluateAndApplyCollegePass(env, employee, performedByEmployeeId = null, reason = 'auto') {
  if (!employee) return { passed: false, changed: false, summary: null };
  const employeeId = Number(employee.id || 0);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return { passed: false, changed: false, summary: null };

  const summary = await getEnrollmentStats(env, employeeId);
  const passed =
    summary.requirements.requiredCount > 0 &&
    summary.requirements.inductionCompleted &&
    summary.requirements.finalQuizPassed &&
    summary.requirements.termsAcknowledged;

  const currentStatus = normalizeUserStatus(employee.user_status);
  const collegeProfile = await getCollegeProfileForEmployee(env, employee);
  const traineeStatus = normalizeTraineeStatus(collegeProfile?.traineeStatus);
  const alreadyPassed =
    Boolean(employee.college_passed_at) ||
    traineeStatus === COLLEGE_TRAINEE_STATUSES.TRAINEE_PASSED ||
    traineeStatus === COLLEGE_TRAINEE_STATUSES.NOT_A_TRAINEE ||
    traineeStatus === COLLEGE_TRAINEE_STATUSES.TRAINEE_WITHDRAWN ||
    traineeStatus === COLLEGE_TRAINEE_STATUSES.TRAINEE_FAILED ||
    currentStatus !== USER_STATUSES.APPLICANT_ACCEPTED;
  if (!passed || alreadyPassed) return { passed, changed: false, summary };

  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE employees
         SET user_status = 'ACTIVE_STAFF',
             college_passed_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(employeeId),
    env.DB
      .prepare(
        `INSERT INTO college_profiles
         (user_employee_id, trainee_status, start_at, due_at, passed_at, failed_at, assigned_by_user_employee_id, last_activity_at, updated_at)
         VALUES (?, 'TRAINEE_PASSED', COALESCE(?, CURRENT_TIMESTAMP), ?, CURRENT_TIMESTAMP, NULL, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(user_employee_id)
         DO UPDATE SET
           trainee_status = 'TRAINEE_PASSED',
           start_at = COALESCE(college_profiles.start_at, excluded.start_at),
           due_at = COALESCE(college_profiles.due_at, excluded.due_at),
           passed_at = COALESCE(college_profiles.passed_at, CURRENT_TIMESTAMP),
           failed_at = NULL,
           assigned_by_user_employee_id = COALESCE(excluded.assigned_by_user_employee_id, college_profiles.assigned_by_user_employee_id),
           last_activity_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP`
      )
      .bind(
        employeeId,
        employee?.college_start_at || null,
        employee?.college_due_at || null,
        Number(performedByEmployeeId || employeeId) || null
      ),
    env.DB
      .prepare(
        `DELETE FROM college_role_assignments
         WHERE employee_id = ? AND role_key = 'TRAINEE'`
      )
      .bind(employeeId),
    env.DB
      .prepare(
        `INSERT INTO college_audit_events
         (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
         VALUES (?, 'passed', ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(employeeId, Number(performedByEmployeeId || employeeId) || null, JSON.stringify({ reason }))
  ]);

  return { passed: true, changed: true, summary };
}

export async function getCollegeOverview(env, employee) {
  const employeeId = Number(employee?.id || 0);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return null;

  await enrollEmployeeInRequiredCollegeCourses(env, employeeId);
  const passResult = await evaluateAndApplyCollegePass(env, employee, employeeId, 'overview_check');
  const refreshedEmployee = passResult.changed
    ? await env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(employeeId).first()
    : employee;
  const collegeProfile = await getCollegeProfileForEmployee(env, refreshedEmployee);
  const traineeStatus = normalizeTraineeStatus(collegeProfile?.traineeStatus);
  const isRestricted = isCollegeRestrictedEmployee(refreshedEmployee, collegeProfile);
  const status = normalizeUserStatus(refreshedEmployee?.user_status);

  const enrollmentSummary = await getEnrollmentStats(env, employeeId);

  const modulesResult = await env.DB
    .prepare(
      `SELECT
         m.id,
         m.course_id,
         m.title,
         m.order_index,
         m.content_type,
         m.completion_rule,
         m.self_completable,
         m.required,
         m.content,
         m.content_link,
         m.attachment_url,
         m.video_url,
         CASE WHEN mp.id IS NULL THEN 0
              WHEN mp.completed_at IS NOT NULL OR LOWER(COALESCE(mp.status, '')) = 'complete' THEN 1
              ELSE 0 END AS completed,
         COALESCE(mp.status, 'available') AS progress_status
       FROM college_course_modules m
       LEFT JOIN college_module_progress mp
         ON mp.module_id = m.id AND mp.user_employee_id = ?
       WHERE m.course_id IN (
         SELECT course_id
         FROM college_enrollments
         WHERE user_employee_id = ?
           AND LOWER(COALESCE(status, 'in_progress')) != 'removed'
       )
         AND m.archived_at IS NULL
       ORDER BY m.course_id ASC, m.order_index ASC, m.id ASC`
    )
    .bind(employeeId, employeeId)
    .all();
  const moduleRows = modulesResult?.results || [];
  const modulesByCourse = new Map();
  moduleRows.forEach((row) => {
    const courseId = Number(row.course_id || 0);
    if (!modulesByCourse.has(courseId)) modulesByCourse.set(courseId, []);
    modulesByCourse.get(courseId).push({
      id: Number(row.id || 0),
      title: String(row.title || '').trim(),
      orderIndex: Number(row.order_index || 0),
      contentType: String(row.content_type || 'markdown').trim().toLowerCase(),
      completionRule: String(row.completion_rule || 'manual').trim().toLowerCase(),
      selfCompletable: Number(row.self_completable || 0) === 1,
      required: Number(row.required ?? 1) === 1,
      content: String(row.content || '').trim(),
      contentLink: row.content_link || null,
      attachmentUrl: row.attachment_url || null,
      videoUrl: row.video_url || null,
      completed: Number(row.completed || 0) === 1,
      progressStatus: String(row.progress_status || 'available').trim().toLowerCase()
    });
  });

  const examsResult = await env.DB
    .prepare(
      `SELECT
         ex.id,
         ex.course_id,
         ex.module_id,
         ex.title,
         ex.passing_score,
         ex.attempt_limit,
         ex.time_limit_minutes,
         ex.published,
         (
           SELECT COUNT(*)
           FROM college_exam_attempts a
           WHERE a.exam_id = ex.id AND a.user_employee_id = ?
         ) AS attempts_used,
         (
           SELECT MAX(a.score)
           FROM college_exam_attempts a
           WHERE a.exam_id = ex.id AND a.user_employee_id = ?
         ) AS best_score,
         (
           SELECT MAX(a.passed)
           FROM college_exam_attempts a
           WHERE a.exam_id = ex.id AND a.user_employee_id = ?
         ) AS has_passed
       FROM college_exams ex
       WHERE ex.course_id IN (
         SELECT course_id
         FROM college_enrollments
         WHERE user_employee_id = ?
           AND LOWER(COALESCE(status, 'in_progress')) != 'removed'
       )
         AND ex.archived_at IS NULL
         AND ex.published = 1
       ORDER BY ex.course_id ASC, ex.module_id ASC, ex.id ASC`
    )
    .bind(employeeId, employeeId, employeeId, employeeId)
    .all();
  const examsByCourse = new Map();
  (examsResult?.results || []).forEach((row) => {
    const courseId = Number(row.course_id || 0);
    if (!courseId) return;
    if (!examsByCourse.has(courseId)) examsByCourse.set(courseId, []);
    const attemptLimit = Math.max(1, Number(row.attempt_limit || 3));
    const attemptsUsed = Number(row.attempts_used || 0);
    examsByCourse.get(courseId).push({
      id: Number(row.id || 0),
      courseId,
      moduleId: Number(row.module_id || 0) || null,
      title: String(row.title || '').trim(),
      passingScore: Math.max(1, Math.min(100, Number(row.passing_score || 70))),
      attemptLimit,
      attemptsUsed,
      remainingAttempts: Math.max(0, attemptLimit - attemptsUsed),
      bestScore: row.best_score == null ? null : Number(row.best_score),
      hasPassed: Number(row.has_passed || 0) === 1,
      timeLimitMinutes: Number(row.time_limit_minutes || 0) || null,
      published: Number(row.published || 0) === 1,
      canAttempt: attemptsUsed < attemptLimit
    });
  });

  const enrollments = enrollmentSummary.enrollments.map((enrollment) => {
    const modules = modulesByCourse.get(enrollment.courseId) || [];
    const exams = examsByCourse.get(enrollment.courseId) || [];
    const nextModule = modules.find((module) => !module.completed) || modules[modules.length - 1] || null;
    return {
      ...enrollment,
      modules,
      exams,
      nextModuleId: nextModule?.id || null,
      nextModuleTitle: nextModule?.title || null
    };
  });

  const currentEnrollment = enrollments.find((row) => row.required && row.progressPct < 100) || enrollments[0] || null;
  const dueAtValue = collegeProfile?.dueAt || refreshedEmployee?.college_due_at || null;
  const dueAt = dueAtValue ? new Date(dueAtValue) : null;
  const dueMs = dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt.getTime() : null;
  const nowMs = Date.now();
  const dueInSeconds = dueMs != null ? Math.max(0, Math.floor((dueMs - nowMs) / 1000)) : null;
  const overdue = Boolean(dueMs != null && dueMs < nowMs && traineeStatus === COLLEGE_TRAINEE_STATUSES.TRAINEE_ACTIVE);
  const dueSoon = Boolean(!overdue && traineeStatus === COLLEGE_TRAINEE_STATUSES.TRAINEE_ACTIVE && dueInSeconds != null && dueInSeconds <= 3 * 24 * 60 * 60);
  const statusPill =
    traineeStatus === COLLEGE_TRAINEE_STATUSES.TRAINEE_PASSED
      ? 'Passed'
      : traineeStatus === COLLEGE_TRAINEE_STATUSES.TRAINEE_FAILED
      ? 'Failed'
      : traineeStatus === COLLEGE_TRAINEE_STATUSES.TRAINEE_WITHDRAWN
      ? 'Withdrawn'
      : overdue
      ? 'Overdue'
      : dueSoon
      ? 'Due Soon'
      : traineeStatus === COLLEGE_TRAINEE_STATUSES.TRAINEE_ACTIVE
      ? 'In progress'
      : 'Staff';

  return {
    employee: {
      id: employeeId,
      robloxUsername: String(refreshedEmployee?.roblox_username || '').trim(),
      serialNumber: String(refreshedEmployee?.serial_number || '').trim(),
      userStatus: status,
      traineeStatus,
      collegeRoles: await getCollegeRoleKeysForEmployee(env, employeeId),
      collegeStartAt: collegeProfile?.startAt || refreshedEmployee?.college_start_at || null,
      collegeDueAt: dueAtValue,
      collegePassedAt: collegeProfile?.passedAt || refreshedEmployee?.college_passed_at || null
    },
    isRestricted,
    statusPill,
    dueInSeconds,
    overdue,
    dueSoon,
    progressPct: Math.max(0, Math.min(100, Number(enrollmentSummary.overallProgress || 0))),
    requirements: {
      completeInductionCourse: enrollmentSummary.requirements.inductionCompleted,
      passFinalQuiz: enrollmentSummary.requirements.finalQuizPassed,
      acknowledgeTerms: enrollmentSummary.requirements.termsAcknowledged
    },
    current: {
      courseId: currentEnrollment?.courseId || null,
      moduleId: currentEnrollment?.nextModuleId || null
    },
    enrollments
  };
}
