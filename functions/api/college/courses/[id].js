import { cachedJson, json } from '../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../_lib/college.js';

function toId(value) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function onRequestGet(context) {
  const { env, request, params } = context;
  const { errorResponse, employee, canManage } = await requireCollegeSession(context);
  if (errorResponse) return errorResponse;

  const courseId = toId(params?.id);
  if (!courseId) return json({ error: 'Invalid course id.' }, 400);
  const employeeId = Number(employee?.id || 0);

  const enrollment = canManage
    ? await env.DB
        .prepare(
          `SELECT
             NULL AS id,
             'in_progress' AS status,
             0 AS required,
             0 AS final_quiz_passed,
             0 AS terms_acknowledged,
             c.id AS course_id, c.code, c.title, c.description, c.estimated_minutes
           FROM college_courses c
           WHERE c.id = ? AND c.published = 1 AND c.archived_at IS NULL
           LIMIT 1`
        )
        .bind(courseId)
        .first()
    : await env.DB
        .prepare(
          `SELECT e.id, e.status, e.required, e.final_quiz_passed, e.terms_acknowledged,
                  c.id AS course_id, c.code, c.title, c.description, c.estimated_minutes
           FROM college_enrollments e
           INNER JOIN college_courses c ON c.id = e.course_id
           WHERE e.user_employee_id = ? AND e.course_id = ? AND c.published = 1
             AND c.archived_at IS NULL
             AND LOWER(COALESCE(e.status, 'in_progress')) != 'removed'
           LIMIT 1`
        )
        .bind(employeeId, courseId)
        .first();
  if (!enrollment) return json({ error: 'Course not found for this user.' }, 404);

  const modulesResult = await env.DB
    .prepare(
      `SELECT
         m.id,
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
       WHERE m.course_id = ?
         AND m.archived_at IS NULL
         ${canManage ? '' : `AND m.published = 1`}
       ORDER BY m.order_index ASC, m.id ASC`
    )
    .bind(employeeId, courseId)
    .all();
  const modules = (modulesResult?.results || []).map((row) => ({
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
  }));

  const totalModules = modules.length;
  const completedModules = modules.filter((row) => row.completed).length;
  const progressPct = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0;

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
       WHERE ex.course_id = ?
         AND ex.archived_at IS NULL
         ${canManage ? '' : 'AND ex.published = 1'}
       ORDER BY ex.module_id ASC, ex.id ASC`
    )
    .bind(employeeId, employeeId, employeeId, courseId)
    .all();
  const exams = (examsResult?.results || []).map((row) => {
    const attemptLimit = Math.max(1, Number(row.attempt_limit || 3));
    const attemptsUsed = Number(row.attempts_used || 0);
    return {
      id: Number(row.id || 0),
      title: String(row.title || '').trim(),
      courseId: Number(row.course_id || 0) || null,
      moduleId: Number(row.module_id || 0) || null,
      passingScore: Math.max(1, Math.min(100, Number(row.passing_score || 70))),
      attemptLimit,
      attemptsUsed,
      remainingAttempts: Math.max(0, attemptLimit - attemptsUsed),
      bestScore: row.best_score == null ? null : Number(row.best_score),
      hasPassed: Number(row.has_passed || 0) === 1,
      timeLimitMinutes: Number(row.time_limit_minutes || 0) || null,
      published: Number(row.published || 0) === 1,
      canAttempt: canManage || attemptsUsed < attemptLimit
    };
  });

  return cachedJson(
    request,
    {
      ok: true,
      course: {
        id: Number(enrollment.course_id || 0),
        code: String(enrollment.code || '').trim(),
        title: String(enrollment.title || '').trim(),
        description: String(enrollment.description || '').trim(),
        estimatedMinutes: Number(enrollment.estimated_minutes || 0),
        enrollmentId: Number(enrollment.id || 0),
        status: String(enrollment.status || 'in_progress').trim(),
        required: Number(enrollment.required || 0) === 1,
        finalQuizPassed: Number(enrollment.final_quiz_passed || 0) === 1,
        termsAcknowledged: Number(enrollment.terms_acknowledged || 0) === 1,
        progressPct,
        modules,
        exams
      }
    },
    { cacheControl: 'private, max-age=20, stale-while-revalidate=40' }
  );
}
