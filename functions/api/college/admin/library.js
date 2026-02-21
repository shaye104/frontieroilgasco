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
  const raw = text(value).toUpperCase();
  if (['PUBLIC', 'STAFF', 'COURSE_LINKED'].includes(raw)) return raw;
  return 'PUBLIC';
}

function parseIdList(values) {
  const source = Array.isArray(values) ? values : [];
  return [
    ...new Set(
      source
        .map((value) => toId(value))
        .filter(Boolean)
    )
  ];
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requireCollegeSession(context, { requiredCapabilities: ['library:manage'] });
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
         d.published,
         d.archived_at,
         d.updated_at,
         d.updated_by_employee_id
       FROM college_library_documents d
       WHERE d.archived_at IS NULL
       ORDER BY d.updated_at DESC, d.id DESC`
    )
    .all();
  const linksResult = await env.DB
    .prepare(
      `SELECT
         l.doc_id,
         l.course_id,
         l.module_id,
         c.code AS course_code,
         c.title AS course_title,
         m.title AS module_title
       FROM college_library_doc_links l
       LEFT JOIN college_courses c ON c.id = l.course_id
       LEFT JOIN college_course_modules m ON m.id = l.module_id`
    )
    .all();
  const linksByDoc = new Map();
  (linksResult?.results || []).forEach((row) => {
    const docId = Number(row.doc_id || 0);
    if (!docId) return;
    if (!linksByDoc.has(docId)) linksByDoc.set(docId, []);
    linksByDoc.get(docId).push({
      courseId: Number(row.course_id || 0) || null,
      moduleId: Number(row.module_id || 0) || null,
      courseCode: text(row.course_code),
      courseTitle: text(row.course_title),
      moduleTitle: text(row.module_title)
    });
  });

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
        links: linksByDoc.get(Number(row.id || 0)) || [],
        linkedCourseIds: [...new Set((linksByDoc.get(Number(row.id || 0)) || []).map((entry) => entry.courseId).filter(Boolean))],
        linkedModuleIds: [...new Set((linksByDoc.get(Number(row.id || 0)) || []).map((entry) => entry.moduleId).filter(Boolean))],
        published: Number(row.published || 0) === 1,
        archivedAt: row.archived_at || null,
        updatedAt: row.updated_at || null
      }))
    },
    { cacheControl: 'private, max-age=10, stale-while-revalidate=20' }
  );
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const { errorResponse, session } = await requireCollegeSession(context, { requiredCapabilities: ['library:manage'] });
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
  const linkedCourseIds = parseIdList(payload?.linkedCourseIds || (payload?.courseId ? [payload.courseId] : []));
  const linkedModuleIds = parseIdList(payload?.linkedModuleIds);
  const legacyCourseId = linkedCourseIds[0] || null;

  if (!title) return json({ error: 'Document title is required.' }, 400);
  if (visibility === 'COURSE_LINKED' && linkedCourseIds.length === 0 && linkedModuleIds.length === 0) {
    return json({ error: 'COURSE_LINKED documents require at least one linked course or module.' }, 400);
  }

  if (id) {
    const before = await env.DB
      .prepare(
        `SELECT
           id,
           title,
           category,
           tags,
           summary,
           content_markdown,
           document_url,
           visibility,
           course_id,
           published
         FROM college_library_documents
         WHERE id = ?`
      )
      .bind(id)
      .first();
    if (!before) return json({ error: 'Document not found.' }, 404);

    await env.DB.batch([
      env.DB
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
          legacyCourseId,
          published,
          Number(session.employee?.id || 0) || null,
          id
        ),
      env.DB.prepare(`DELETE FROM college_library_doc_links WHERE doc_id = ?`).bind(id),
      ...linkedCourseIds.map((courseId) =>
        env.DB
          .prepare(
            `INSERT INTO college_library_doc_links
             (doc_id, course_id, module_id, created_at)
             VALUES (?, ?, NULL, CURRENT_TIMESTAMP)`
          )
          .bind(id, courseId)
      ),
      ...linkedModuleIds.map((moduleId) =>
        env.DB
          .prepare(
            `INSERT INTO college_library_doc_links
             (doc_id, course_id, module_id, created_at)
             VALUES (?, NULL, ?, CURRENT_TIMESTAMP)`
          )
          .bind(id, moduleId)
      )
    ]);

    await env.DB
      .prepare(
        `INSERT INTO college_audit_events
         (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
         VALUES (?, 'library_update', ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(
        Number(session.employee?.id || 0) || null,
        Number(session.employee?.id || 0) || null,
        JSON.stringify({
          target: { type: 'library_document', id },
          before,
          after: {
            title,
            category,
            tags: tags || null,
            summary: summary || null,
            contentMarkdown: contentMarkdown || null,
            documentUrl: documentUrl || null,
            visibility,
            linkedCourseIds,
            linkedModuleIds,
            published: Boolean(published)
          }
        })
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
    .bind(
      title,
      category,
      tags || null,
      summary || null,
      contentMarkdown || null,
      documentUrl || null,
      visibility,
      legacyCourseId,
      published,
      Number(session.employee?.id || 0) || null
    )
    .run();

  const newId = Number(inserted?.meta?.last_row_id || 0);
  if (newId > 0 && (linkedCourseIds.length || linkedModuleIds.length)) {
    await env.DB.batch([
      ...linkedCourseIds.map((courseId) =>
        env.DB
          .prepare(
            `INSERT INTO college_library_doc_links
             (doc_id, course_id, module_id, created_at)
             VALUES (?, ?, NULL, CURRENT_TIMESTAMP)`
          )
          .bind(newId, courseId)
      ),
      ...linkedModuleIds.map((moduleId) =>
        env.DB
          .prepare(
            `INSERT INTO college_library_doc_links
             (doc_id, course_id, module_id, created_at)
             VALUES (?, NULL, ?, CURRENT_TIMESTAMP)`
          )
          .bind(newId, moduleId)
      )
    ]);
  }
  await env.DB
    .prepare(
      `INSERT INTO college_audit_events
       (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
       VALUES (?, 'library_create', ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(
      Number(session.employee?.id || 0) || null,
      Number(session.employee?.id || 0) || null,
      JSON.stringify({
        target: { type: 'library_document', id: newId },
        before: null,
        after: {
          title,
          category,
          tags: tags || null,
          summary: summary || null,
          contentMarkdown: contentMarkdown || null,
          documentUrl: documentUrl || null,
          visibility,
          linkedCourseIds,
          linkedModuleIds,
          published: Boolean(published)
        }
      })
    )
    .run();

  return json({ ok: true, id: newId });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const { errorResponse, session } = await requireCollegeSession(context, { requiredCapabilities: ['library:manage'] });
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  const id = toId(payload?.id);
  if (!id) return json({ error: 'Document id is required.' }, 400);

  const before = await env.DB
    .prepare(
      `SELECT id, title, category, visibility, archived_at
       FROM college_library_documents
       WHERE id = ?`
    )
    .bind(id)
    .first();
  if (!before) return json({ error: 'Document not found.' }, 404);

  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE college_library_documents
         SET archived_at = COALESCE(archived_at, CURRENT_TIMESTAMP),
             published = 0,
             updated_by_employee_id = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(Number(session.employee?.id || 0) || null, id),
    env.DB
      .prepare(
        `INSERT INTO college_audit_events
         (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
         VALUES (?, 'library_archive', ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(
        Number(session.employee?.id || 0) || null,
        Number(session.employee?.id || 0) || null,
        JSON.stringify({
          target: { type: 'library_document', id },
          before,
          after: { archivedAt: new Date().toISOString() }
        })
      )
  ]);
  return json({ ok: true });
}
