import { cachedJson, json } from '../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../_lib/college.js';

function text(value) {
  return String(value || '').trim();
}

function toId(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function parseChoices(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => text(entry)).filter(Boolean);
  } catch {
    return [];
  }
}

export async function onRequestGet(context) {
  const { env, request, params } = context;
  const { errorResponse, employee, canManage } = await requireCollegeSession(context);
  if (errorResponse) return errorResponse;

  const examId = toId(params?.examId);
  if (!examId) return json({ error: 'Invalid exam id.' }, 400);

  const employeeId = Number(employee?.id || 0);
  if (!employeeId) return json({ error: 'Employee profile required.' }, 403);

  const exam = await env.DB
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
         c.code AS course_code,
         c.title AS course_title
       FROM college_exams ex
       LEFT JOIN college_courses c ON c.id = ex.course_id
       WHERE ex.id = ?`
    )
    .bind(examId)
    .first();
  if (!exam) return json({ error: 'Exam not found.' }, 404);
  if (!canManage && Number(exam.published || 0) !== 1) return json({ error: 'Exam is not available.' }, 404);

  if (!canManage) {
    const enrollment = await env.DB
      .prepare(`SELECT id FROM college_enrollments WHERE user_employee_id = ? AND course_id = ? LIMIT 1`)
      .bind(employeeId, Number(exam.course_id || 0))
      .first();
    if (!enrollment) return json({ error: 'You are not enrolled for this exam.' }, 403);
  }

  const [questionRowsResult, attemptsResult] = await Promise.all([
    env.DB
      .prepare(
        `SELECT id, question_type, prompt, choices_json, points, order_index
         FROM college_exam_questions
         WHERE exam_id = ?
         ORDER BY order_index ASC, id ASC`
      )
      .bind(examId)
      .all(),
    env.DB
      .prepare(
        `SELECT id, submitted_at, score, passed, created_at
         FROM college_exam_attempts
         WHERE exam_id = ? AND user_employee_id = ?
         ORDER BY created_at DESC, id DESC`
      )
      .bind(examId, employeeId)
      .all()
  ]);

  const questions = (questionRowsResult?.results || []).map((row) => ({
    id: Number(row.id || 0),
    questionType: text(row.question_type).toLowerCase() || 'mcq',
    prompt: text(row.prompt),
    choices: parseChoices(row.choices_json),
    points: Math.max(1, Number(row.points || 1)),
    orderIndex: Number(row.order_index || 0)
  }));

  const attempts = (attemptsResult?.results || []).map((row) => ({
    id: Number(row.id || 0),
    submittedAt: row.submitted_at || null,
    score: row.score == null ? null : Number(row.score),
    passed: Number(row.passed || 0) === 1,
    createdAt: row.created_at || null
  }));
  const attemptLimit = Math.max(1, Number(exam.attempt_limit || 3));
  const attemptsUsed = attempts.length;
  const canAttempt = canManage || attemptsUsed < attemptLimit;

  return cachedJson(
    request,
    {
      ok: true,
      exam: {
        id: Number(exam.id || 0),
        title: text(exam.title),
        courseId: Number(exam.course_id || 0) || null,
        courseCode: text(exam.course_code),
        courseTitle: text(exam.course_title),
        moduleId: Number(exam.module_id || 0) || null,
        passingScore: Math.max(1, Math.min(100, Number(exam.passing_score || 70))),
        attemptLimit,
        attemptsUsed,
        remainingAttempts: Math.max(0, attemptLimit - attemptsUsed),
        timeLimitMinutes: Number(exam.time_limit_minutes || 0) || null,
        canAttempt
      },
      questions,
      attempts
    },
    { cacheControl: 'private, max-age=0, stale-while-revalidate=0' }
  );
}
