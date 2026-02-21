import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { ensureCoreSchema } from './db.js';
import { enrichSessionWithPermissions, hasPermission } from './permissions.js';

export const USER_STATUSES = {
  APPLICANT_ACCEPTED: 'APPLICANT_ACCEPTED',
  ACTIVE_STAFF: 'ACTIVE_STAFF',
  INSTRUCTOR: 'INSTRUCTOR',
  COLLEGE_ADMIN: 'COLLEGE_ADMIN'
};

export function normalizeUserStatus(value) {
  const status = String(value || '').trim().toUpperCase();
  if (!status) return USER_STATUSES.ACTIVE_STAFF;
  if (Object.values(USER_STATUSES).includes(status)) return status;
  return USER_STATUSES.ACTIVE_STAFF;
}

export function isCollegeRestrictedEmployee(employee) {
  if (!employee) return false;
  const status = normalizeUserStatus(employee.user_status);
  if (status !== USER_STATUSES.APPLICANT_ACCEPTED) return false;
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

  if (options.requireManage && !hasPermission(session, 'college.manage')) {
    return { errorResponse: json({ error: 'Forbidden. Missing required permission.' }, 403), session: null, employee: null, isRestricted: false };
  }

  const isRestricted = isCollegeRestrictedEmployee(employee);
  return { errorResponse: null, session, employee, isRestricted };
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
       WHERE c.published = 1 AND c.is_required_for_applicants = 1`
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
           WHERE mp.user_employee_id = e.user_employee_id AND m.course_id = e.course_id
         ) AS completed_modules
       FROM college_enrollments e
       INNER JOIN college_courses c ON c.id = e.course_id
       WHERE e.user_employee_id = ?
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
  const alreadyPassed = Boolean(employee.college_passed_at) || currentStatus !== USER_STATUSES.APPLICANT_ACCEPTED;
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
  const isRestricted = isCollegeRestrictedEmployee(refreshedEmployee);
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
         m.content,
         m.attachment_url,
         m.video_url,
         CASE WHEN mp.id IS NULL THEN 0 ELSE 1 END AS completed
       FROM college_course_modules m
       LEFT JOIN college_module_progress mp
         ON mp.module_id = m.id AND mp.user_employee_id = ?
       WHERE m.course_id IN (
         SELECT course_id FROM college_enrollments WHERE user_employee_id = ?
       )
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
      content: String(row.content || '').trim(),
      attachmentUrl: row.attachment_url || null,
      videoUrl: row.video_url || null,
      completed: Number(row.completed || 0) === 1
    });
  });

  const enrollments = enrollmentSummary.enrollments.map((enrollment) => {
    const modules = modulesByCourse.get(enrollment.courseId) || [];
    const nextModule = modules.find((module) => !module.completed) || modules[modules.length - 1] || null;
    return {
      ...enrollment,
      modules,
      nextModuleId: nextModule?.id || null,
      nextModuleTitle: nextModule?.title || null
    };
  });

  const currentEnrollment = enrollments.find((row) => row.required && row.progressPct < 100) || enrollments[0] || null;
  const dueAt = refreshedEmployee?.college_due_at ? new Date(refreshedEmployee.college_due_at) : null;
  const dueMs = dueAt && !Number.isNaN(dueAt.getTime()) ? dueAt.getTime() : null;
  const nowMs = Date.now();
  const dueInSeconds = dueMs != null ? Math.max(0, Math.floor((dueMs - nowMs) / 1000)) : null;
  const overdue = Boolean(dueMs != null && dueMs < nowMs && !refreshedEmployee?.college_passed_at && isRestricted);
  const statusPill = refreshedEmployee?.college_passed_at
    ? 'Passed'
    : overdue
    ? 'Overdue'
    : isRestricted
    ? 'In progress'
    : 'Active';

  return {
    employee: {
      id: employeeId,
      robloxUsername: String(refreshedEmployee?.roblox_username || '').trim(),
      serialNumber: String(refreshedEmployee?.serial_number || '').trim(),
      userStatus: status,
      collegeStartAt: refreshedEmployee?.college_start_at || null,
      collegeDueAt: refreshedEmployee?.college_due_at || null,
      collegePassedAt: refreshedEmployee?.college_passed_at || null
    },
    isRestricted,
    statusPill,
    dueInSeconds,
    overdue,
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
