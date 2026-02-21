import { cachedJson } from '../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../_lib/college.js';

function text(value) {
  return String(value || '').trim();
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requireCollegeSession(context, {
    requiredAnyCapabilities: ['college:admin', 'college:manage_users', 'course:manage', 'enrollment:manage', 'college:manage_courses']
  });
  if (errorResponse) return errorResponse;

  const [usersResult, coursesResult, modulesResult, examsResult, attemptsResult] = await Promise.all([
    env.DB
      .prepare(
        `SELECT
           e.id,
           e.roblox_username,
           e.serial_number,
           e.discord_user_id,
           COALESCE(cp.trainee_status,
             CASE
               WHEN e.college_passed_at IS NOT NULL THEN 'TRAINEE_PASSED'
               WHEN UPPER(COALESCE(e.user_status, '')) = 'APPLICANT_ACCEPTED' THEN 'TRAINEE_ACTIVE'
               ELSE 'NOT_A_TRAINEE'
             END
           ) AS trainee_status
         FROM employees e
         LEFT JOIN college_profiles cp ON cp.user_employee_id = e.id
         ORDER BY e.roblox_username ASC, e.id ASC
         LIMIT 1000`
      )
      .all(),
    env.DB
      .prepare(
        `SELECT id, code, title
         FROM college_courses
         WHERE archived_at IS NULL
         ORDER BY code ASC, title ASC`
      )
      .all(),
    env.DB
      .prepare(
        `SELECT id, course_id, title
         FROM college_course_modules
         WHERE archived_at IS NULL
         ORDER BY course_id ASC, order_index ASC, id ASC`
      )
      .all(),
    env.DB
      .prepare(
        `SELECT id, course_id, module_id, title
         FROM college_exams
         WHERE archived_at IS NULL
         ORDER BY title ASC, id ASC`
      )
      .all(),
    env.DB
      .prepare(
        `SELECT id, exam_id
         FROM college_exam_attempts
         ORDER BY id DESC
         LIMIT 500`
      )
      .all()
  ]);

  return cachedJson(
    request,
    {
      ok: true,
      users: (usersResult?.results || []).map((row) => ({
        id: Number(row.id || 0),
        name: text(row.roblox_username) || `Employee #${Number(row.id || 0)}`,
        serialNumber: text(row.serial_number),
        discordUserId: text(row.discord_user_id),
        traineeStatus: text(row.trainee_status).toUpperCase()
      })),
      courses: (coursesResult?.results || []).map((row) => ({
        id: Number(row.id || 0),
        code: text(row.code),
        title: text(row.title)
      })),
      modules: (modulesResult?.results || []).map((row) => ({
        id: Number(row.id || 0),
        courseId: Number(row.course_id || 0) || null,
        title: text(row.title)
      })),
      exams: (examsResult?.results || []).map((row) => ({
        id: Number(row.id || 0),
        courseId: Number(row.course_id || 0) || null,
        moduleId: Number(row.module_id || 0) || null,
        title: text(row.title)
      })),
      attempts: (attemptsResult?.results || []).map((row) => ({
        id: Number(row.id || 0),
        examId: Number(row.exam_id || 0) || null
      }))
    },
    { cacheControl: 'private, max-age=10, stale-while-revalidate=20' }
  );
}
