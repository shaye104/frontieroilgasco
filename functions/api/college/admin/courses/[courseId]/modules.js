import { cachedJson, json } from '../../../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../../../_lib/college.js';

function toId(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function text(value) {
  return String(value || '').trim();
}

function normalizeContentType(value) {
  const raw = text(value).toLowerCase();
  if (['markdown', 'video', 'pdf', 'quiz', 'link'].includes(raw)) return raw;
  return 'markdown';
}

function normalizeCompletionRule(value) {
  const raw = text(value).toLowerCase();
  if (['manual', 'quiz_required', 'instructor_approval'].includes(raw)) return raw;
  return 'manual';
}

export async function onRequestGet(context) {
  const { env, request, params } = context;
  const { errorResponse } = await requireCollegeSession(context, { requireManage: true });
  if (errorResponse) return errorResponse;

  const courseId = toId(params?.courseId);
  if (!courseId) return json({ error: 'Invalid course id.' }, 400);

  const rows = await env.DB
    .prepare(
      `SELECT
         id,
         title,
         order_index,
         content_type,
         completion_rule,
         content,
         content_link,
         attachment_url,
         video_url,
         published,
         updated_at
       FROM college_course_modules
       WHERE course_id = ?
       ORDER BY order_index ASC, id ASC`
    )
    .bind(courseId)
    .all();

  return cachedJson(
    request,
    {
      ok: true,
      rows: (rows?.results || []).map((row) => ({
        id: Number(row.id || 0),
        title: text(row.title),
        orderIndex: Number(row.order_index || 0),
        contentType: normalizeContentType(row.content_type),
        completionRule: normalizeCompletionRule(row.completion_rule),
        content: text(row.content),
        contentLink: text(row.content_link),
        attachmentUrl: text(row.attachment_url),
        videoUrl: text(row.video_url),
        published: Number(row.published || 0) === 1,
        updatedAt: row.updated_at || null
      }))
    },
    { cacheControl: 'private, max-age=10, stale-while-revalidate=20' }
  );
}

export async function onRequestPost(context) {
  const { env, request, params } = context;
  const { errorResponse, session } = await requireCollegeSession(context, { requireManage: true });
  if (errorResponse) return errorResponse;

  const courseId = toId(params?.courseId);
  if (!courseId) return json({ error: 'Invalid course id.' }, 400);

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const title = text(payload?.title);
  const orderIndex = Math.max(1, Number(payload?.orderIndex || 1));
  const contentType = normalizeContentType(payload?.contentType);
  const completionRule = normalizeCompletionRule(payload?.completionRule);
  const content = text(payload?.content);
  const contentLink = text(payload?.contentLink);
  const attachmentUrl = text(payload?.attachmentUrl);
  const videoUrl = text(payload?.videoUrl);
  const published = Number(payload?.published ? 1 : 0);
  const moduleId = toId(payload?.id);

  if (!title) return json({ error: 'Module title is required.' }, 400);

  if (moduleId) {
    await env.DB
      .prepare(
        `UPDATE college_course_modules
         SET title = ?,
             order_index = ?,
             content_type = ?,
             completion_rule = ?,
             content = ?,
             content_link = ?,
             attachment_url = ?,
             video_url = ?,
             published = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND course_id = ?`
      )
      .bind(title, orderIndex, contentType, completionRule, content || null, contentLink || null, attachmentUrl || null, videoUrl || null, published, moduleId, courseId)
      .run();

    await env.DB
      .prepare(
        `INSERT INTO college_audit_events
         (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
         VALUES (?, 'module_update', ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(
        Number(session.employee?.id || 0) || null,
        Number(session.employee?.id || 0) || null,
        JSON.stringify({ courseId, moduleId, title, orderIndex, contentType, completionRule, published: Boolean(published) })
      )
      .run();

    return json({ ok: true, id: moduleId });
  }

  const inserted = await env.DB
    .prepare(
      `INSERT INTO college_course_modules
       (course_id, title, order_index, content_type, completion_rule, content, content_link, attachment_url, video_url, published, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(courseId, title, orderIndex, contentType, completionRule, content || null, contentLink || null, attachmentUrl || null, videoUrl || null, published)
    .run();

  const id = Number(inserted?.meta?.last_row_id || 0);
  await env.DB
    .prepare(
      `INSERT INTO college_audit_events
       (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
       VALUES (?, 'module_create', ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(
      Number(session.employee?.id || 0) || null,
      Number(session.employee?.id || 0) || null,
      JSON.stringify({ courseId, moduleId: id, title, orderIndex, contentType, completionRule, published: Boolean(published) })
    )
    .run();

  return json({ ok: true, id });
}

