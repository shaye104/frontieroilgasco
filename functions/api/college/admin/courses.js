import { cachedJson, json } from '../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../_lib/college.js';

function text(value) {
  return String(value || '').trim();
}

function normalizeVisibility(value) {
  const raw = text(value).toLowerCase();
  if (['all', 'trainee', 'staff', 'private'].includes(raw)) return raw;
  return 'all';
}

function toPositiveInteger(value, fallback = 0) {
  const n = Math.round(Number(value || 0));
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requireCollegeSession(context, { requiredCapabilities: ['course:manage'] });
  if (errorResponse) return errorResponse;

  const rows = await env.DB
    .prepare(
       `SELECT
         c.id,
         c.code,
         c.title,
         c.description,
         c.visibility,
         c.is_required_for_applicants,
         c.published,
         c.archived_at,
         c.estimated_minutes,
         c.updated_at,
         (
           SELECT COUNT(*) FROM college_course_modules m WHERE m.course_id = c.id
         ) AS module_count
       FROM college_courses c
       WHERE c.archived_at IS NULL
       ORDER BY c.updated_at DESC, c.id DESC`
    )
    .all();

  return cachedJson(
    request,
    {
      ok: true,
      rows: (rows?.results || []).map((row) => ({
        id: Number(row.id || 0),
        code: text(row.code),
        title: text(row.title),
        description: text(row.description),
        visibility: normalizeVisibility(row.visibility),
        requiredForApplicants: Number(row.is_required_for_applicants || 0) === 1,
        published: Number(row.published || 0) === 1,
        archivedAt: row.archived_at || null,
        estimatedMinutes: toPositiveInteger(row.estimated_minutes, 0),
        moduleCount: Number(row.module_count || 0),
        updatedAt: row.updated_at || null
      }))
    },
    { cacheControl: 'private, max-age=10, stale-while-revalidate=20' }
  );
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const { errorResponse, session } = await requireCollegeSession(context, { requiredCapabilities: ['course:manage'] });
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const code = text(payload?.code).toUpperCase();
  const title = text(payload?.title);
  const description = text(payload?.description);
  const visibility = normalizeVisibility(payload?.visibility);
  const published = Number(payload?.published ? 1 : 0);
  const requiredForApplicants = Number(payload?.requiredForApplicants ? 1 : 0);
  const estimatedMinutes = toPositiveInteger(payload?.estimatedMinutes, 60);

  if (!code) return json({ error: 'Course code is required.' }, 400);
  if (!title) return json({ error: 'Course title is required.' }, 400);

  const courseId = Number(payload?.id || 0);
  if (courseId > 0) {
    const before = await env.DB
      .prepare(
        `SELECT code, title, description, visibility, published, is_required_for_applicants, estimated_minutes
         FROM college_courses
         WHERE id = ?`
      )
      .bind(courseId)
      .first();
    if (!before) return json({ error: 'Course not found.' }, 404);

    await env.DB
      .prepare(
        `UPDATE college_courses
         SET code = ?,
             title = ?,
             description = ?,
             visibility = ?,
             published = ?,
             is_required_for_applicants = ?,
             estimated_minutes = ?,
             updated_by_employee_id = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(
        code,
        title,
        description || null,
        visibility,
        published,
        requiredForApplicants,
        estimatedMinutes,
        Number(session.employee?.id || 0) || null,
        courseId
      )
      .run();

    await env.DB
      .prepare(
        `INSERT INTO college_audit_events
         (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
         VALUES (?, 'course_update', ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(
        Number(session.employee?.id || 0) || null,
        Number(session.employee?.id || 0) || null,
        JSON.stringify({
          target: { type: 'course', id: courseId },
          before,
          after: {
            code,
            title,
            description: description || null,
            visibility,
            published: Boolean(published),
            requiredForApplicants: Boolean(requiredForApplicants),
            estimatedMinutes
          }
        })
      )
      .run();

    return json({ ok: true, id: courseId });
  }

  const inserted = await env.DB
    .prepare(
      `INSERT INTO college_courses
       (code, title, description, visibility, is_required_for_applicants, published, estimated_minutes, created_by_employee_id, updated_by_employee_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(
      code,
      title,
      description || null,
      visibility,
      requiredForApplicants,
      published,
      estimatedMinutes,
      Number(session.employee?.id || 0) || null,
      Number(session.employee?.id || 0) || null
    )
    .run();

  const id = Number(inserted?.meta?.last_row_id || 0);
  await env.DB
    .prepare(
      `INSERT INTO college_audit_events
       (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
       VALUES (?, 'course_create', ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(
      Number(session.employee?.id || 0) || null,
      Number(session.employee?.id || 0) || null,
      JSON.stringify({
        target: { type: 'course', id },
        before: null,
        after: {
          code,
          title,
          description: description || null,
          visibility,
          published: Boolean(published),
          requiredForApplicants: Boolean(requiredForApplicants),
          estimatedMinutes
        }
      })
    )
    .run();

  return json({ ok: true, id });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const { errorResponse, session } = await requireCollegeSession(context, { requiredCapabilities: ['course:manage'] });
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const courseId = Number(payload?.id || 0);
  if (!Number.isInteger(courseId) || courseId <= 0) return json({ error: 'Course id is required.' }, 400);

  const before = await env.DB
    .prepare(`SELECT id, code, title, archived_at FROM college_courses WHERE id = ?`)
    .bind(courseId)
    .first();
  if (!before) return json({ error: 'Course not found.' }, 404);

  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE college_courses
         SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
             published = 0,
             updated_by_employee_id = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(Number(session.employee?.id || 0) || null, courseId),
    env.DB
      .prepare(
        `UPDATE college_course_modules
         SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
             published = 0,
             updated_at = CURRENT_TIMESTAMP
         WHERE course_id = ?`
      )
      .bind(courseId),
    env.DB
      .prepare(
        `INSERT INTO college_audit_events
         (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
         VALUES (?, 'course_archive', ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(
        Number(session.employee?.id || 0) || null,
        Number(session.employee?.id || 0) || null,
        JSON.stringify({
          target: { type: 'course', id: courseId },
          before,
          after: { archivedAt: new Date().toISOString() }
        })
      )
  ]);

  return json({ ok: true });
}
