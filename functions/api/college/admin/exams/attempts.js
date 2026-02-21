import { cachedJson } from '../../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../../_lib/college.js';

function text(value) {
  return String(value || '').trim();
}

function toInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse, capabilities } = await requireCollegeSession(context, {
    requiredAnyCapabilities: ['college:admin', 'exam:view', 'exam:mark']
  });
  if (errorResponse) return errorResponse;
  if (!(capabilities?.['college:admin'] || capabilities?.['exam:view'] || capabilities?.['exam:mark'])) {
    return new Response(JSON.stringify({ error: 'Forbidden. Missing required permission.' }), {
      status: 403,
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(10, Number(url.searchParams.get('pageSize')) || 20));
  const offset = (page - 1) * pageSize;
  const pendingOnly = String(url.searchParams.get('pendingOnly') || '0') === '1';

  const where = [];
  if (pendingOnly) where.push('a.submitted_at IS NOT NULL AND a.score IS NULL');
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await env.DB
    .prepare(
      `SELECT COUNT(*) AS total
       FROM college_exam_attempts a
       ${whereSql}`
    )
    .first();

  const rowsResult = await env.DB
    .prepare(
      `SELECT
         a.id,
         a.exam_id,
         a.user_employee_id,
         a.started_at,
         a.submitted_at,
         a.score,
         a.passed,
         a.grading_notes,
         a.created_at,
         ex.title AS exam_title,
         c.code AS course_code,
         c.title AS course_title,
         e.roblox_username AS employee_name,
         e.serial_number AS employee_serial,
         grader.roblox_username AS graded_by_name
       FROM college_exam_attempts a
       INNER JOIN college_exams ex ON ex.id = a.exam_id
       LEFT JOIN college_courses c ON c.id = ex.course_id
       LEFT JOIN employees e ON e.id = a.user_employee_id
       LEFT JOIN employees grader ON grader.id = a.graded_by_employee_id
       ${whereSql}
       ORDER BY COALESCE(a.submitted_at, a.created_at) DESC, a.id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(pageSize, offset)
    .all();

  return cachedJson(
    request,
    {
      ok: true,
      rows: (rowsResult?.results || []).map((row) => ({
        id: Number(row.id || 0),
        examId: Number(row.exam_id || 0),
        examTitle: text(row.exam_title),
        courseCode: text(row.course_code),
        courseTitle: text(row.course_title),
        employeeId: Number(row.user_employee_id || 0),
        employeeName: text(row.employee_name),
        employeeSerial: text(row.employee_serial),
        startedAt: row.started_at || null,
        submittedAt: row.submitted_at || null,
        score: row.score == null ? null : toInt(row.score),
        passed: Number(row.passed || 0) === 1,
        gradingNotes: text(row.grading_notes),
        gradedByName: text(row.graded_by_name)
      })),
      pagination: {
        page,
        pageSize,
        total: Number(totalRow?.total || 0),
        totalPages: Math.max(1, Math.ceil(Number(totalRow?.total || 0) / pageSize))
      }
    },
    { cacheControl: 'private, max-age=5, stale-while-revalidate=10' }
  );
}
