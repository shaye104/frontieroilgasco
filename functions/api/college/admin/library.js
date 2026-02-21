import { cachedJson, json } from '../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../_lib/college.js';

function toId(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function text(value) {
  return String(value || '').trim();
}

function normalizeVisibility(value) {
  const raw = text(value).toLowerCase();
  if (['public', 'staff', 'trainee', 'enrolled', 'private'].includes(raw)) return raw;
  return 'public';
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requireCollegeSession(context, { requireManage: true });
  if (errorResponse) return errorResponse;

  const rows = await env.DB
    .prepare(
      `SELECT
         d.id,
         d.title,
         d.category,
         d.tags,
         d.summary,
         d.content_markdown,
         d.document_url,
         d.visibility,
         d.course_id,
         d.published,
         d.updated_at,
         c.code AS course_code,
         c.title AS course_title
       FROM college_library_documents d
       LEFT JOIN college_courses c ON c.id = d.course_id
       ORDER BY d.updated_at DESC, d.id DESC`
    )
    .all();

  return cachedJson(
    request,
    {
      ok: true,
      rows: (rows?.results || []).map((row) => ({
        id: Number(row.id || 0),
        title: text(row.title),
        category: text(row.category),
        tags: text(row.tags),
        summary: text(row.summary),
        contentMarkdown: text(row.content_markdown),
        documentUrl: text(row.document_url),
        visibility: normalizeVisibility(row.visibility),
        courseId: Number(row.course_id || 0) || null,
        courseCode: text(row.course_code),
        courseTitle: text(row.course_title),
        published: Number(row.published || 0) === 1,
        updatedAt: row.updated_at || null
      }))
    },
    { cacheControl: 'private, max-age=10, stale-while-revalidate=20' }
  );
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const { errorResponse, session } = await requireCollegeSession(context, { requireManage: true });
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const id = toId(payload?.id);
  const title = text(payload?.title);
  const category = text(payload?.category || 'General');
  const tags = text(payload?.tags);
  const summary = text(payload?.summary);
  const contentMarkdown = text(payload?.contentMarkdown);
  const documentUrl = text(payload?.documentUrl);
  const visibility = normalizeVisibility(payload?.visibility);
  const published = Number(payload?.published ? 1 : 0);
  const courseId = toId(payload?.courseId);

  if (!title) return json({ error: 'Document title is required.' }, 400);

  if (id) {
    await env.DB
      .prepare(
        `UPDATE college_library_documents
         SET title = ?,
             category = ?,
             tags = ?,
             summary = ?,
             content_markdown = ?,
             document_url = ?,
             visibility = ?,
             course_id = ?,
             published = ?,
             updated_by_employee_id = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(
        title,
        category,
        tags || null,
        summary || null,
        contentMarkdown || null,
        documentUrl || null,
        visibility,
        courseId || null,
        published,
        Number(session.employee?.id || 0) || null,
        id
      )
      .run();

    await env.DB
      .prepare(
        `INSERT INTO college_audit_events
         (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
         VALUES (?, 'library_update', ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(
        Number(session.employee?.id || 0) || null,
        Number(session.employee?.id || 0) || null,
        JSON.stringify({ libraryId: id, title, visibility, published: Boolean(published), courseId: courseId || null })
      )
      .run();

    return json({ ok: true, id });
  }

  const inserted = await env.DB
    .prepare(
      `INSERT INTO college_library_documents
       (title, category, tags, summary, content_markdown, document_url, visibility, course_id, published, updated_by_employee_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(title, category, tags || null, summary || null, contentMarkdown || null, documentUrl || null, visibility, courseId || null, published, Number(session.employee?.id || 0) || null)
    .run();

  const newId = Number(inserted?.meta?.last_row_id || 0);
  await env.DB
    .prepare(
      `INSERT INTO college_audit_events
       (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
       VALUES (?, 'library_create', ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(
      Number(session.employee?.id || 0) || null,
      Number(session.employee?.id || 0) || null,
      JSON.stringify({ libraryId: newId, title, visibility, published: Boolean(published), courseId: courseId || null })
    )
    .run();

  return json({ ok: true, id: newId });
}

