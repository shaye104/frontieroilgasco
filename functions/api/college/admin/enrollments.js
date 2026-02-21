import { cachedJson, json } from '../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../_lib/college.js';

function toId(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toRequiredFlag(value) {
  return Number(value ? 1 : 0);
}

function text(value) {
  return String(value || '').trim();
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requireCollegeSession(context, { requiredCapabilities: ['enrollment:manage'] });
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const search = text(url.searchParams.get('search')).toLowerCase();
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(10, Number(url.searchParams.get('pageSize')) || 20));
  const offset = (page - 1) * pageSize;

  const where = [];
  const binds = [];
  if (search) {
    const term = `%${search}%`;
    where.push(`(
      LOWER(COALESCE(e.roblox_username, '')) LIKE ?
      OR LOWER(COALESCE(c.title, '')) LIKE ?
      OR LOWER(COALESCE(c.code, '')) LIKE ?
      OR LOWER(COALESCE(e.serial_number, '')) LIKE ?
    )`);
    binds.push(term, term, term, term);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = await env.DB
    .prepare(
      `SELECT COUNT(*) AS total
       FROM college_enrollments ce
       INNER JOIN employees e ON e.id = ce.user_employee_id
       INNER JOIN college_courses c ON c.id = ce.course_id
       ${whereSql}`
    )
    .bind(...binds)
    .first();

  const rowsResult = await env.DB
    .prepare(
      `SELECT
         ce.id,
         ce.user_employee_id,
         ce.course_id,
         ce.enrolled_at,
         ce.required,
         ce.status,
         ce.completed_at,
         ce.passed_at,
         ce.final_quiz_passed,
         ce.terms_acknowledged,
         e.roblox_username,
         e.serial_number,
         c.code,
         c.title
       FROM college_enrollments ce
       INNER JOIN employees e ON e.id = ce.user_employee_id
       INNER JOIN college_courses c ON c.id = ce.course_id
       ${whereSql}
       ORDER BY ce.enrolled_at DESC, ce.id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(...binds, pageSize, offset)
    .all();

  return cachedJson(
    request,
    {
      ok: true,
      rows: (rowsResult?.results || []).map((row) => ({
        id: Number(row.id || 0),
        employeeId: Number(row.user_employee_id || 0),
        courseId: Number(row.course_id || 0),
        employeeName: text(row.roblox_username),
        serialNumber: text(row.serial_number),
        courseCode: text(row.code),
        courseTitle: text(row.title),
        enrolledAt: row.enrolled_at || null,
        required: Number(row.required || 0) === 1,
        status: text(row.status || 'in_progress'),
        completedAt: row.completed_at || null,
        passedAt: row.passed_at || null,
        finalQuizPassed: Number(row.final_quiz_passed || 0) === 1,
        termsAcknowledged: Number(row.terms_acknowledged || 0) === 1
      })),
      pagination: {
        page,
        pageSize,
        total: Number(totalRow?.total || 0),
        totalPages: Math.max(1, Math.ceil(Number(totalRow?.total || 0) / pageSize))
      }
    },
    { cacheControl: 'private, max-age=10, stale-while-revalidate=20' }
  );
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const { errorResponse, session } = await requireCollegeSession(context, { requiredCapabilities: ['enrollment:manage'] });
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const employeeId = toId(payload?.employeeId);
  const courseId = toId(payload?.courseId);
  const required = toRequiredFlag(payload?.required);
  if (!employeeId || !courseId) return json({ error: 'employeeId and courseId are required.' }, 400);

  const [employee, course] = await Promise.all([
    env.DB.prepare(`SELECT id FROM employees WHERE id = ?`).bind(employeeId).first(),
    env.DB.prepare(`SELECT id, title FROM college_courses WHERE id = ?`).bind(courseId).first()
  ]);
  if (!employee) return json({ error: 'Employee not found.' }, 404);
  if (!course) return json({ error: 'Course not found.' }, 404);

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO college_enrollments
         (user_employee_id, course_id, enrolled_at, required, status)
         VALUES (?, ?, CURRENT_TIMESTAMP, ?, 'in_progress')
         ON CONFLICT(user_employee_id, course_id)
         DO UPDATE SET
           required = excluded.required,
           status = CASE
             WHEN college_enrollments.status IN ('passed', 'completed') THEN college_enrollments.status
             ELSE 'in_progress'
           END`
      )
      .bind(employeeId, courseId, required),
    env.DB
      .prepare(
        `INSERT INTO college_audit_events
         (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
         VALUES (?, 'enrollment_update', ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(
        employeeId,
        Number(session.employee?.id || 0) || null,
        JSON.stringify({
          target: { type: 'enrollment', userEmployeeId: employeeId, courseId },
          before: null,
          after: {
            courseId,
            courseTitle: text(course.title),
            required: required === 1
          }
        })
      )
  ]);

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const { errorResponse, session } = await requireCollegeSession(context, { requiredCapabilities: ['enrollment:manage'] });
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const employeeId = toId(payload?.employeeId);
  const courseId = toId(payload?.courseId);
  if (!employeeId || !courseId) return json({ error: 'employeeId and courseId are required.' }, 400);

  const existing = await env.DB
    .prepare(
      `SELECT id, required, status, completed_at, passed_at
       FROM college_enrollments
       WHERE user_employee_id = ? AND course_id = ?`
    )
    .bind(employeeId, courseId)
    .first();
  if (!existing) return json({ error: 'Enrollment not found.' }, 404);

  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE college_enrollments
         SET status = 'removed'
         WHERE user_employee_id = ? AND course_id = ?`
      )
      .bind(employeeId, courseId),
    env.DB
      .prepare(
        `INSERT INTO college_audit_events
         (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
         VALUES (?, 'enrollment_remove', ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(
        employeeId,
        Number(session.employee?.id || 0) || null,
        JSON.stringify({
          target: { type: 'enrollment', userEmployeeId: employeeId, courseId },
          before: {
            required: Number(existing.required || 0) === 1,
            status: text(existing.status),
            completedAt: existing.completed_at || null,
            passedAt: existing.passed_at || null
          },
          after: null
        })
      )
  ]);

  return json({ ok: true });
}
