import { cachedJson, json } from '../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../_lib/college.js';

function toId(value) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function onRequestGet(context) {
  const { env, request, params } = context;
  const { errorResponse, employee } = await requireCollegeSession(context);
  if (errorResponse) return errorResponse;

  const courseId = toId(params?.id);
  if (!courseId) return json({ error: 'Invalid course id.' }, 400);
  const employeeId = Number(employee?.id || 0);

  const enrollment = await env.DB
    .prepare(
      `SELECT e.id, e.status, e.required, e.final_quiz_passed, e.terms_acknowledged,
              c.id AS course_id, c.code, c.title, c.description, c.estimated_minutes
       FROM college_enrollments e
       INNER JOIN college_courses c ON c.id = e.course_id
       WHERE e.user_employee_id = ? AND e.course_id = ?
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
         m.content,
         m.attachment_url,
         m.video_url,
         CASE WHEN mp.id IS NULL THEN 0 ELSE 1 END AS completed
       FROM college_course_modules m
       LEFT JOIN college_module_progress mp
         ON mp.module_id = m.id AND mp.user_employee_id = ?
       WHERE m.course_id = ?
       ORDER BY m.order_index ASC, m.id ASC`
    )
    .bind(employeeId, courseId)
    .all();
  const modules = (modulesResult?.results || []).map((row) => ({
    id: Number(row.id || 0),
    title: String(row.title || '').trim(),
    orderIndex: Number(row.order_index || 0),
    contentType: String(row.content_type || 'markdown').trim().toLowerCase(),
    content: String(row.content || '').trim(),
    attachmentUrl: row.attachment_url || null,
    videoUrl: row.video_url || null,
    completed: Number(row.completed || 0) === 1
  }));

  const totalModules = modules.length;
  const completedModules = modules.filter((row) => row.completed).length;
  const progressPct = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0;

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
        modules
      }
    },
    { cacheControl: 'private, max-age=20, stale-while-revalidate=40' }
  );
}
