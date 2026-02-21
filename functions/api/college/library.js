import { cachedJson } from '../auth/_lib/auth.js';
import { requireCollegeSession } from '../_lib/college.js';

function text(value) {
  return String(value || '').trim();
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const { errorResponse, employee, isRestricted, canManage } = await requireCollegeSession(context);
  if (errorResponse) return errorResponse;

  const employeeId = Number(employee?.id || 0);
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
  const enrolledPlaceholders = enrolledCourseIds.map(() => '?').join(', ');

  const url = new URL(request.url);
  const search = text(url.searchParams.get('search')).toLowerCase();
  const category = text(url.searchParams.get('category'));
  const tag = text(url.searchParams.get('tag')).toLowerCase();

  const clauses = ['published = 1'];
  const bindings = [];
  if (!canManage) {
    if (isRestricted) {
      if (enrolledCourseIds.length) {
        clauses.push(`(
          LOWER(COALESCE(visibility, 'public')) IN ('public', 'trainee')
          OR (LOWER(COALESCE(visibility, 'public')) = 'enrolled' AND course_id IN (${enrolledPlaceholders}))
        )`);
        bindings.push(...enrolledCourseIds);
      } else {
        clauses.push(`LOWER(COALESCE(visibility, 'public')) IN ('public', 'trainee')`);
      }
    } else if (enrolledCourseIds.length) {
      clauses.push(`(
        LOWER(COALESCE(visibility, 'public')) IN ('public', 'staff')
        OR (LOWER(COALESCE(visibility, 'public')) = 'enrolled' AND course_id IN (${enrolledPlaceholders}))
      )`);
      bindings.push(...enrolledCourseIds);
    } else {
      clauses.push(`LOWER(COALESCE(visibility, 'public')) IN ('public', 'staff')`);
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
      `SELECT id, title, category, tags, summary, content_markdown, document_url, visibility, course_id, updated_at
       FROM college_library_documents
       WHERE ${clauses.join(' AND ')}
       ORDER BY updated_at DESC, id DESC`
    )
    .bind(...bindings)
    .all();
  const rows = rowsResult?.results || [];

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
        visibility: text(row.visibility || 'public').toLowerCase(),
        courseId: Number(row.course_id || 0) || null,
        documentUrl: text(row.document_url),
        updatedAt: row.updated_at || null
      }))
    },
    { cacheControl: 'private, max-age=30, stale-while-revalidate=60' }
  );
}
