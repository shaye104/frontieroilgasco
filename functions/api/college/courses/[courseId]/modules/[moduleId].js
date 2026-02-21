import { cachedJson, json } from '../../../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../../../_lib/college.js';

function toId(value) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function onRequestGet(context) {
  const { env, request, params } = context;
  const { errorResponse, employee, canManage } = await requireCollegeSession(context);
  if (errorResponse) return errorResponse;

  const courseId = toId(params?.courseId);
  const moduleId = toId(params?.moduleId);
  if (!courseId || !moduleId) return json({ error: 'Invalid course or module id.' }, 400);

  const employeeId = Number(employee?.id || 0);
  const moduleRow = canManage
    ? await env.DB
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
             c.code,
             c.title AS course_title,
             CASE WHEN mp.id IS NULL THEN 0
                  WHEN mp.completed_at IS NOT NULL OR LOWER(COALESCE(mp.status, '')) = 'complete' THEN 1
                  ELSE 0 END AS completed
           FROM college_course_modules m
           INNER JOIN college_courses c ON c.id = m.course_id
           LEFT JOIN college_module_progress mp ON mp.module_id = m.id AND mp.user_employee_id = ?
           WHERE m.course_id = ? AND m.id = ? AND c.published = 1
             AND c.archived_at IS NULL
             AND m.archived_at IS NULL
           LIMIT 1`
        )
        .bind(employeeId, courseId, moduleId)
        .first()
    : await env.DB
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
             c.code,
             c.title AS course_title,
             CASE WHEN mp.id IS NULL THEN 0
                  WHEN mp.completed_at IS NOT NULL OR LOWER(COALESCE(mp.status, '')) = 'complete' THEN 1
                  ELSE 0 END AS completed
           FROM college_course_modules m
           INNER JOIN college_enrollments e
             ON e.course_id = m.course_id
            AND e.user_employee_id = ?
            AND LOWER(COALESCE(e.status, 'in_progress')) != 'removed'
           INNER JOIN college_courses c ON c.id = m.course_id
           LEFT JOIN college_module_progress mp ON mp.module_id = m.id AND mp.user_employee_id = ?
           WHERE m.course_id = ? AND m.id = ? AND c.published = 1 AND m.published = 1
             AND c.archived_at IS NULL AND m.archived_at IS NULL
           LIMIT 1`
        )
        .bind(employeeId, employeeId, courseId, moduleId)
        .first();
  if (!moduleRow) return json({ error: 'Module not found for this user.' }, 404);

  return cachedJson(
    request,
    {
      ok: true,
      module: {
        id: Number(moduleRow.id || 0),
        courseId: Number(moduleRow.course_id || 0),
        courseCode: String(moduleRow.code || '').trim(),
        courseTitle: String(moduleRow.course_title || '').trim(),
        title: String(moduleRow.title || '').trim(),
        orderIndex: Number(moduleRow.order_index || 0),
        contentType: String(moduleRow.content_type || 'markdown').trim().toLowerCase(),
        completionRule: String(moduleRow.completion_rule || 'manual').trim().toLowerCase(),
        selfCompletable: Number(moduleRow.self_completable || 0) === 1,
        required: Number(moduleRow.required ?? 1) === 1,
        content: String(moduleRow.content || '').trim(),
        contentLink: moduleRow.content_link || null,
        attachmentUrl: moduleRow.attachment_url || null,
        videoUrl: moduleRow.video_url || null,
        completed: Number(moduleRow.completed || 0) === 1
      }
    },
    { cacheControl: 'private, max-age=20, stale-while-revalidate=40' }
  );
}
