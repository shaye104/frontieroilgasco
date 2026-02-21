import { cachedJson, json } from '../../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../../_lib/college.js';

function toId(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function text(value) {
  return String(value || '').trim();
}

export async function onRequestGet(context) {
  const { env, request, params } = context;
  const { errorResponse } = await requireCollegeSession(context, {
    requiredAnyCapabilities: ['college:admin', 'progress:view']
  });
  if (errorResponse) return errorResponse;

  const employeeId = toId(params?.userId);
  if (!employeeId) return json({ error: 'Invalid user id.' }, 400);

  const employee = await env.DB
    .prepare(
      `SELECT
         id,
         discord_user_id,
         roblox_username,
         serial_number,
         rank,
         user_status,
         (
           SELECT trainee_status
           FROM college_profiles cp
           WHERE cp.user_employee_id = employees.id
           LIMIT 1
         ) AS trainee_status,
         (
           SELECT start_at
           FROM college_profiles cp
           WHERE cp.user_employee_id = employees.id
           LIMIT 1
         ) AS profile_start_at,
         (
           SELECT due_at
           FROM college_profiles cp
           WHERE cp.user_employee_id = employees.id
           LIMIT 1
         ) AS profile_due_at,
         (
           SELECT passed_at
           FROM college_profiles cp
           WHERE cp.user_employee_id = employees.id
           LIMIT 1
         ) AS profile_passed_at,
         (
           SELECT failed_at
           FROM college_profiles cp
           WHERE cp.user_employee_id = employees.id
           LIMIT 1
         ) AS profile_failed_at,
         college_start_at,
         college_due_at,
         college_passed_at
       FROM employees
       WHERE id = ?`
    )
    .bind(employeeId)
    .first();
  if (!employee) return json({ error: 'Employee not found.' }, 404);

  const [enrollmentsResult, moduleProgressResult, attemptsResult, rolesResult, auditResult] = await Promise.all([
    env.DB
      .prepare(
        `SELECT
           ce.id,
           ce.course_id,
           ce.required,
           ce.status,
           ce.enrolled_at,
           ce.completed_at,
           ce.passed_at,
           c.code,
           c.title
         FROM college_enrollments ce
         INNER JOIN college_courses c ON c.id = ce.course_id
         WHERE ce.user_employee_id = ?
         ORDER BY ce.required DESC, c.code ASC`
      )
      .bind(employeeId)
      .all(),
    env.DB
      .prepare(
        `SELECT
           mp.id,
           mp.module_id,
           mp.status,
           mp.requested_at,
           mp.completed_at,
           mp.completed_by_employee_id,
           m.course_id,
           m.title AS module_title,
           c.code AS course_code,
           c.title AS course_title
         FROM college_module_progress mp
         INNER JOIN college_course_modules m ON m.id = mp.module_id
         INNER JOIN college_courses c ON c.id = m.course_id
         WHERE mp.user_employee_id = ?
         ORDER BY COALESCE(mp.completed_at, mp.requested_at, mp.id) DESC`
      )
      .bind(employeeId)
      .all(),
    env.DB
      .prepare(
        `SELECT
           a.id,
           a.exam_id,
           a.submitted_at,
           a.score,
           a.passed,
           a.grading_notes,
           ex.title AS exam_title,
           c.code AS course_code
         FROM college_exam_attempts a
         INNER JOIN college_exams ex ON ex.id = a.exam_id
         LEFT JOIN college_courses c ON c.id = ex.course_id
         WHERE a.user_employee_id = ?
         ORDER BY COALESCE(a.submitted_at, a.created_at) DESC, a.id DESC
         LIMIT 100`
      )
      .bind(employeeId)
      .all(),
    env.DB
      .prepare(`SELECT role_key FROM college_role_assignments WHERE employee_id = ? ORDER BY role_key ASC`)
      .bind(employeeId)
      .all(),
    env.DB
      .prepare(
        `SELECT
           e.id,
           e.action,
           e.created_at,
           e.meta_json,
           actor.roblox_username AS actor_name
         FROM college_audit_events e
         LEFT JOIN employees actor ON actor.id = e.performed_by_employee_id
         WHERE e.user_employee_id = ?
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT 100`
      )
      .bind(employeeId)
      .all()
  ]);

  return cachedJson(
    request,
    {
      ok: true,
      trainee: {
        id: Number(employee.id || 0),
        discordUserId: text(employee.discord_user_id),
        username: text(employee.roblox_username),
        serialNumber: text(employee.serial_number),
        rank: text(employee.rank),
        userStatus: text(employee.user_status).toUpperCase(),
        traineeStatus: text(
          employee.trainee_status ||
            (employee.college_passed_at ? 'TRAINEE_PASSED' : text(employee.user_status).toUpperCase() === 'APPLICANT_ACCEPTED' ? 'TRAINEE_ACTIVE' : 'NOT_A_TRAINEE')
        ).toUpperCase(),
        collegeStartAt: employee.profile_start_at || employee.college_start_at || null,
        collegeDueAt: employee.profile_due_at || employee.college_due_at || null,
        collegePassedAt: employee.profile_passed_at || employee.college_passed_at || null,
        collegeFailedAt: employee.profile_failed_at || null,
        roles: (rolesResult?.results || []).map((row) => text(row.role_key).toUpperCase()).filter(Boolean)
      },
      enrollments: (enrollmentsResult?.results || []).map((row) => ({
        enrollmentId: Number(row.id || 0),
        courseId: Number(row.course_id || 0),
        courseCode: text(row.code),
        courseTitle: text(row.title),
        required: Number(row.required || 0) === 1,
        status: text(row.status || 'in_progress'),
        enrolledAt: row.enrolled_at || null,
        completedAt: row.completed_at || null,
        passedAt: row.passed_at || null
      })),
      moduleProgress: (moduleProgressResult?.results || []).map((row) => ({
        id: Number(row.id || 0),
        moduleId: Number(row.module_id || 0),
        courseId: Number(row.course_id || 0),
        courseCode: text(row.course_code),
        courseTitle: text(row.course_title),
        moduleTitle: text(row.module_title),
        status: text(row.status || 'available').toLowerCase(),
        requestedAt: row.requested_at || null,
        completedAt: row.completed_at || null,
        completedByEmployeeId: Number(row.completed_by_employee_id || 0) || null
      })),
      attempts: (attemptsResult?.results || []).map((row) => ({
        id: Number(row.id || 0),
        examId: Number(row.exam_id || 0),
        examTitle: text(row.exam_title),
        courseCode: text(row.course_code),
        submittedAt: row.submitted_at || null,
        score: row.score == null ? null : Number(row.score),
        passed: Number(row.passed || 0) === 1,
        notes: text(row.grading_notes)
      })),
      audit: (auditResult?.results || []).map((row) => {
        let meta = {};
        try {
          meta = JSON.parse(row.meta_json || '{}');
        } catch {
          meta = {};
        }
        return {
          id: Number(row.id || 0),
          action: text(row.action),
          createdAt: row.created_at || null,
          actorName: text(row.actor_name),
          meta
        };
      })
    },
    { cacheControl: 'private, max-age=5, stale-while-revalidate=10' }
  );
}
