import { cachedJson } from '../auth/_lib/auth.js';
import { requireCollegeSession } from '../_lib/college.js';

function text(value) {
  return String(value || '').trim();
}

function hasTable(result, tableName) {
  const wanted = String(tableName || '').trim().toLowerCase();
  return (result?.results || []).some((row) => String(row?.name || '').trim().toLowerCase() === wanted);
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { errorResponse, employee, isRestricted, capabilities } = await requireCollegeSession(context);
  if (errorResponse) return errorResponse;

  const employeeId = Number(employee?.id || 0);
  const canManageLibrary = Boolean(capabilities?.['library:manage'] || capabilities?.['college:admin']);
  const enrollmentRows = employeeId
    ? await env.DB
        .prepare(
          `SELECT course_id
           FROM college_enrollments
           WHERE user_employee_id = ?`
        )
        .bind(employeeId)
        .all()
    : { results: [] };
  const enrolledCourseIds = [...new Set((enrollmentRows?.results || []).map((row) => Number(row.course_id || 0)).filter((id) => id > 0))];

  const url = new URL(request.url);
  const search = text(url.searchParams.get('search')).toLowerCase();
  const category = text(url.searchParams.get('category'));
  const tag = text(url.searchParams.get('tag')).toLowerCase();

  const libraryColumnResult = await env.DB.prepare(`PRAGMA table_info(college_library_documents)`).all();
  const libraryColumns = new Set((libraryColumnResult?.results || []).map((row) => String(row.name || '').toLowerCase()));
  const hasVisibility = libraryColumns.has('visibility');
  const hasArchivedAt = libraryColumns.has('archived_at');
  const hasContentMarkdown = libraryColumns.has('content_markdown');
  const hasDocumentUrl = libraryColumns.has('document_url');
  const hasUpdatedAt = libraryColumns.has('updated_at');
  const hasCourseIdLegacy = libraryColumns.has('course_id');

  const tableResult = await env.DB
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('college_library_doc_links', 'college_course_modules')`)
    .all();
  const hasDocLinksTable = hasTable(tableResult, 'college_library_doc_links');
  const hasModulesTable = hasTable(tableResult, 'college_course_modules');

  const clauses = ['published = 1'];
  if (hasArchivedAt) clauses.push('archived_at IS NULL');
  const bindings = [];
  if (!canManageLibrary && hasVisibility) {
    const linkedVisibilityClause =
      hasDocLinksTable && hasModulesTable
        ? `(
            UPPER(COALESCE(visibility, 'PUBLIC')) = 'COURSE_LINKED'
            AND EXISTS (
              SELECT 1
              FROM college_library_doc_links l
              LEFT JOIN college_course_modules m ON m.id = l.module_id
              WHERE l.doc_id = college_library_documents.id
                AND (
                  (l.course_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM college_enrollments ce
                    WHERE ce.user_employee_id = ?
                      AND ce.course_id = l.course_id
                  ))
                  OR (l.module_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM college_module_progress mp
                    WHERE mp.user_employee_id = ?
                      AND mp.module_id = l.module_id
                  ))
                  OR (l.module_id IS NOT NULL AND EXISTS (
                    SELECT 1 FROM college_enrollments ce2
                    WHERE ce2.user_employee_id = ?
                      AND ce2.course_id = m.course_id
                  ))
                )
            )
          )`
        : `(
            UPPER(COALESCE(visibility, 'PUBLIC')) = 'COURSE_LINKED'
            AND ${hasCourseIdLegacy ? `EXISTS (
              SELECT 1 FROM college_enrollments ce
              WHERE ce.user_employee_id = ?
                AND ce.course_id = college_library_documents.course_id
            )` : '0 = 1'}
          )`;

    clauses.push(`(
      UPPER(COALESCE(visibility, 'PUBLIC')) = 'PUBLIC'
      OR (
        UPPER(COALESCE(visibility, 'PUBLIC')) = 'STAFF'
        AND ? = 0
      )
      OR ${linkedVisibilityClause}
    )`);
    bindings.push(isRestricted ? 1 : 0);
    if (hasDocLinksTable && hasModulesTable) {
      bindings.push(employeeId, employeeId, employeeId);
    } else if (hasCourseIdLegacy) {
      bindings.push(employeeId);
    }
  }

  if (search) {
    const term = `%${search}%`;
    clauses.push(`(LOWER(COALESCE(title, '')) LIKE ? OR LOWER(COALESCE(summary, '')) LIKE ? OR LOWER(COALESCE(tags, '')) LIKE ?)`);
    bindings.push(term, term, term);
  }
  if (category) {
    clauses.push(`LOWER(COALESCE(category, '')) = LOWER(?)`);
    bindings.push(category);
  }
  if (tag) {
    clauses.push(`LOWER(COALESCE(tags, '')) LIKE ?`);
    bindings.push(`%${tag}%`);
  }

  const rowsResult = await env.DB
    .prepare(
      `SELECT
         id,
         title,
         category,
         tags,
         summary,
         ${hasContentMarkdown ? 'content_markdown' : "'' AS content_markdown"},
         ${hasDocumentUrl ? 'document_url' : "'' AS document_url"},
         ${hasVisibility ? 'visibility' : "'PUBLIC' AS visibility"},
         ${hasUpdatedAt ? 'updated_at' : 'NULL AS updated_at'}
       FROM college_library_documents
       WHERE ${clauses.join(' AND ')}
       ORDER BY updated_at DESC, id DESC`
    )
    .bind(...bindings)
    .all();
  const rows = rowsResult?.results || [];
  const docIds = rows.map((row) => Number(row.id || 0)).filter((id) => id > 0);
  let linksByDoc = new Map();
  if (docIds.length && hasDocLinksTable && hasModulesTable) {
    const placeholders = docIds.map(() => '?').join(', ');
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
         LEFT JOIN college_course_modules m ON m.id = l.module_id
         WHERE l.doc_id IN (${placeholders})
         ORDER BY l.id ASC`
      )
      .bind(...docIds)
      .all();
    linksByDoc = new Map();
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
  }
  const canSeeRelationMetadata = Boolean(canManageLibrary || capabilities?.['course:manage'] || capabilities?.['progress:view']);

  return cachedJson(
    request,
    {
      ok: true,
      documents: rows.map((row) => ({
        id: Number(row.id || 0),
        title: text(row.title),
        category: text(row.category),
        tags: text(row.tags)
          .split(',')
          .map((value) => value.trim())
          .filter(Boolean),
        summary: text(row.summary),
        contentMarkdown: text(row.content_markdown),
        visibility: text(row.visibility || 'PUBLIC').toUpperCase(),
        relatedTo: canSeeRelationMetadata ? linksByDoc.get(Number(row.id || 0)) || [] : undefined,
        documentUrl: text(row.document_url),
        updatedAt: row.updated_at || null
      }))
    },
    { cacheControl: 'private, max-age=30, stale-while-revalidate=60' }
  );
}
