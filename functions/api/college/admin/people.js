import { cachedJson } from '../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../_lib/college.js';

function text(value) {
  return String(value || '').trim();
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requireCollegeSession(context, { requiredAnyCapabilities: ['college:admin', 'progress:view'] });
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const search = text(url.searchParams.get('search')).toLowerCase();
  const status = text(url.searchParams.get('status')).toUpperCase();
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(10, Number(url.searchParams.get('pageSize')) || 20));
  const offset = (page - 1) * pageSize;

  const where = [];
  const binds = [];
  if (search) {
    const term = `%${search}%`;
    where.push(`(
      LOWER(COALESCE(e.roblox_username, '')) LIKE ?
      OR LOWER(COALESCE(e.serial_number, '')) LIKE ?
      OR LOWER(COALESCE(e.discord_user_id, '')) LIKE ?
    )`);
    binds.push(term, term, term);
  }
  if (status) {
    where.push(`UPPER(COALESCE(cp.trainee_status,
      CASE
        WHEN e.college_passed_at IS NOT NULL THEN 'TRAINEE_PASSED'
        WHEN UPPER(COALESCE(e.user_status, '')) = 'APPLICANT_ACCEPTED' THEN 'TRAINEE_ACTIVE'
        ELSE 'NOT_A_TRAINEE'
      END
    )) = ?`);
    binds.push(status);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await env.DB
    .prepare(
      `SELECT COUNT(*) AS total
       FROM employees e
       LEFT JOIN college_profiles cp ON cp.user_employee_id = e.id
       ${whereSql}`
    )
    .bind(...binds)
    .first();

  const rowsResult = await env.DB
    .prepare(
      `SELECT
         e.id,
         e.discord_user_id,
         e.roblox_username,
         e.serial_number,
         e.rank,
         e.user_status,
         cp.trainee_status,
         cp.start_at,
         cp.due_at,
         cp.passed_at,
         cp.failed_at,
         e.college_start_at,
         e.college_due_at,
         e.college_passed_at,
         (
           SELECT COUNT(*)
           FROM college_enrollments ce
           WHERE ce.user_employee_id = e.id
             AND ce.required = 1
         ) AS required_courses,
         (
           SELECT COUNT(*)
           FROM college_enrollments ce
           WHERE ce.user_employee_id = e.id
             AND ce.required = 1
             AND ce.status IN ('completed', 'passed')
         ) AS completed_required_courses,
         (
           SELECT COUNT(*)
           FROM college_course_modules m
           INNER JOIN college_enrollments ce ON ce.course_id = m.course_id
           WHERE ce.user_employee_id = e.id
             AND ce.required = 1
         ) AS required_modules,
         (
           SELECT COUNT(*)
           FROM college_module_progress mp
           INNER JOIN college_course_modules m ON m.id = mp.module_id
           INNER JOIN college_enrollments ce ON ce.course_id = m.course_id
           WHERE ce.user_employee_id = e.id
             AND ce.required = 1
             AND mp.user_employee_id = e.id
             AND (mp.completed_at IS NOT NULL OR LOWER(COALESCE(mp.status, '')) = 'complete')
         ) AS completed_required_modules,
         (
           SELECT MAX(activity_at)
           FROM (
             SELECT COALESCE(ce.passed_at, ce.completed_at, ce.enrolled_at) AS activity_at
             FROM college_enrollments ce
             WHERE ce.user_employee_id = e.id
             UNION ALL
             SELECT mp.completed_at AS activity_at
             FROM college_module_progress mp
             WHERE mp.user_employee_id = e.id
             UNION ALL
             SELECT a.submitted_at AS activity_at
             FROM college_exam_attempts a
             WHERE a.user_employee_id = e.id
           )
         ) AS last_activity_at,
         GROUP_CONCAT(cra.role_key) AS college_roles
       FROM employees e
       LEFT JOIN college_profiles cp ON cp.user_employee_id = e.id
       LEFT JOIN college_role_assignments cra ON cra.employee_id = e.id
       ${whereSql}
       GROUP BY e.id
       ORDER BY e.updated_at DESC, e.id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, pageSize, offset)
    .all();

  return cachedJson(
    request,
    {
      ok: true,
      rows: (rowsResult?.results || []).map((row) => ({
        id: Number(row.id || 0),
        discordUserId: text(row.discord_user_id),
        robloxUsername: text(row.roblox_username),
        serialNumber: text(row.serial_number),
        rank: text(row.rank),
        userStatus: text(row.user_status || 'ACTIVE_STAFF').toUpperCase(),
        traineeStatus: text(
          row.trainee_status ||
            (row.college_passed_at ? 'TRAINEE_PASSED' : text(row.user_status).toUpperCase() === 'APPLICANT_ACCEPTED' ? 'TRAINEE_ACTIVE' : 'NOT_A_TRAINEE')
        ).toUpperCase(),
        collegeStartAt: row.start_at || row.college_start_at || null,
        collegeDueAt: row.due_at || row.college_due_at || null,
        collegePassedAt: row.passed_at || row.college_passed_at || null,
        collegeFailedAt: row.failed_at || null,
        requiredCourses: Number(row.required_courses || 0),
        completedRequiredCourses: Number(row.completed_required_courses || 0),
        progressPct: (() => {
          const total = Math.max(0, Number(row.required_modules || 0));
          const completed = Math.max(0, Number(row.completed_required_modules || 0));
          if (!total) return 0;
          return Math.max(0, Math.min(100, Math.round((completed / total) * 100)));
        })(),
        lastActivityAt: row.last_activity_at || null,
        collegeRoles: text(row.college_roles)
          .split(',')
          .map((entry) => text(entry).toUpperCase())
          .filter(Boolean)
      })),
      pagination: {
        page,
        pageSize,
        total: Number(totalRow?.total || 0),
        totalPages: Math.max(1, Math.ceil(Number(totalRow?.total || 0) / pageSize))
      }
    },
    { cacheControl: 'private, max-age=10, stale-while-revalidate=20' }
  );
}
