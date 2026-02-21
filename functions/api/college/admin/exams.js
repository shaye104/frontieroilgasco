import { cachedJson, json } from '../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../_lib/college.js';
import { hasPermission } from '../../_lib/permissions.js';

function text(value) {
  return String(value || '').trim();
}

function toId(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toBoundedInt(value, fallback, min, max) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function canManageExams(session, roleKeys) {
  return (
    Boolean(session?.isAdmin) ||
    hasPermission(session, 'admin.override') ||
    hasPermission(session, 'college.exams.manage') ||
    Array.isArray(roleKeys) && roleKeys.includes('COLLEGE_ADMIN')
  );
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse, session, roleKeys } = await requireCollegeSession(context, { requireManage: true });
  if (errorResponse) return errorResponse;
  if (!canManageExams(session, roleKeys)) return json({ error: 'Forbidden. Missing required permission.' }, 403);

  const url = new URL(request.url);
  const courseId = toId(url.searchParams.get('courseId'));
  const where = [];
  const binds = [];
  if (courseId) {
    where.push('ex.course_id = ?');
    binds.push(courseId);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const rowsResult = await env.DB
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
         ex.updated_at,
         c.code AS course_code,
         c.title AS course_title,
         (
           SELECT COUNT(*) FROM college_exam_questions q WHERE q.exam_id = ex.id
         ) AS question_count,
         (
           SELECT COUNT(*) FROM college_exam_attempts a WHERE a.exam_id = ex.id
         ) AS attempt_count,
         (
           SELECT COUNT(*) FROM college_exam_attempts a
           WHERE a.exam_id = ex.id AND a.submitted_at IS NOT NULL AND a.score IS NULL
         ) AS pending_grading_count
       FROM college_exams ex
       LEFT JOIN college_courses c ON c.id = ex.course_id
       ${whereSql}
       ORDER BY ex.updated_at DESC, ex.id DESC`
    )
    .bind(...binds)
    .all();

  return cachedJson(
    request,
    {
      ok: true,
      rows: (rowsResult?.results || []).map((row) => ({
        id: Number(row.id || 0),
        courseId: Number(row.course_id || 0) || null,
        moduleId: Number(row.module_id || 0) || null,
        title: text(row.title),
        passingScore: toBoundedInt(row.passing_score, 70, 1, 100),
        attemptLimit: toBoundedInt(row.attempt_limit, 3, 1, 20),
        timeLimitMinutes: toId(row.time_limit_minutes),
        published: Number(row.published || 0) === 1,
        updatedAt: row.updated_at || null,
        courseCode: text(row.course_code),
        courseTitle: text(row.course_title),
        questionCount: Number(row.question_count || 0),
        attemptCount: Number(row.attempt_count || 0),
        pendingGradingCount: Number(row.pending_grading_count || 0)
      }))
    },
    { cacheControl: 'private, max-age=10, stale-while-revalidate=20' }
  );
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const { errorResponse, session, roleKeys, employee } = await requireCollegeSession(context, { requireManage: true });
  if (errorResponse) return errorResponse;
  if (!canManageExams(session, roleKeys)) return json({ error: 'Forbidden. Missing required permission.' }, 403);

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const id = toId(payload?.id);
  const title = text(payload?.title);
  const courseId = toId(payload?.courseId);
  const moduleId = toId(payload?.moduleId);
  const passingScore = toBoundedInt(payload?.passingScore, 70, 1, 100);
  const attemptLimit = toBoundedInt(payload?.attemptLimit, 3, 1, 20);
  const timeLimitMinutes = toId(payload?.timeLimitMinutes);
  const published = Number(payload?.published ? 1 : 0);
  const actorId = Number(employee?.id || 0) || null;

  if (!title) return json({ error: 'Exam title is required.' }, 400);
  if (!courseId) return json({ error: 'courseId is required.' }, 400);

  const course = await env.DB.prepare(`SELECT id, title, code FROM college_courses WHERE id = ?`).bind(courseId).first();
  if (!course) return json({ error: 'Course not found.' }, 404);

  if (moduleId) {
    const module = await env.DB.prepare(`SELECT id FROM college_course_modules WHERE id = ? AND course_id = ?`).bind(moduleId, courseId).first();
    if (!module) return json({ error: 'Module not found for selected course.' }, 404);
  }

  if (id) {
    await env.DB.batch([
      env.DB
        .prepare(
          `UPDATE college_exams
           SET course_id = ?,
               module_id = ?,
               title = ?,
               passing_score = ?,
               attempt_limit = ?,
               time_limit_minutes = ?,
               published = ?,
               updated_by_employee_id = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .bind(courseId, moduleId || null, title, passingScore, attemptLimit, timeLimitMinutes || null, published, actorId, id),
      env.DB
        .prepare(
          `INSERT INTO college_audit_events
           (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
           VALUES (?, 'exam_update', ?, ?, CURRENT_TIMESTAMP)`
        )
        .bind(
          actorId,
          actorId,
          JSON.stringify({
            examId: id,
            courseId,
            moduleId: moduleId || null,
            title,
            passingScore,
            attemptLimit,
            timeLimitMinutes: timeLimitMinutes || null,
            published: Boolean(published)
          })
        )
    ]);

    return json({ ok: true, id });
  }

  const inserted = await env.DB
    .prepare(
      `INSERT INTO college_exams
       (course_id, module_id, title, passing_score, attempt_limit, time_limit_minutes, published, created_by_employee_id, updated_by_employee_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(courseId, moduleId || null, title, passingScore, attemptLimit, timeLimitMinutes || null, published, actorId, actorId)
    .run();

  const createdId = Number(inserted?.meta?.last_row_id || 0);
  await env.DB
    .prepare(
      `INSERT INTO college_audit_events
       (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
       VALUES (?, 'exam_create', ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(
      actorId,
      actorId,
      JSON.stringify({
        examId: createdId,
        courseId,
        moduleId: moduleId || null,
        title,
        passingScore,
        attemptLimit,
        timeLimitMinutes: timeLimitMinutes || null,
        published: Boolean(published)
      })
    )
    .run();

  return json({ ok: true, id: createdId });
}
