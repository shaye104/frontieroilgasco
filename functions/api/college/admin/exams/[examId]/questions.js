import { cachedJson, json } from '../../../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../../../_lib/college.js';

function text(value) {
  return String(value || '').trim();
}

function toId(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toPoints(value) {
  const n = Math.round(Number(value || 1));
  if (!Number.isFinite(n)) return 1;
  return Math.min(20, Math.max(1, n));
}

function normalizeQuestionType(value) {
  const type = text(value).toLowerCase();
  if (['mcq', 'short'].includes(type)) return type;
  return 'mcq';
}

function parseArrayJson(value) {
  if (Array.isArray(value)) return value.map((entry) => text(entry)).filter(Boolean);
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
  const { errorResponse, capabilities } = await requireCollegeSession(context, {
    requiredAnyCapabilities: ['college:admin', 'exam:view', 'exam:mark']
  });
  if (errorResponse) return errorResponse;
  if (!(capabilities?.['college:admin'] || capabilities?.['exam:view'] || capabilities?.['exam:mark'])) {
    return json({ error: 'Forbidden. Missing required permission.' }, 403);
  }

  const examId = toId(params?.examId);
  if (!examId) return json({ error: 'Invalid exam id.' }, 400);

  const rowsResult = await env.DB
    .prepare(
      `SELECT
         q.id,
         q.question_type,
         q.prompt,
         q.choices_json,
         q.correct_answer_json,
         q.points,
         q.order_index,
         q.updated_at
       FROM college_exam_questions q
       WHERE q.exam_id = ?
       ORDER BY q.order_index ASC, q.id ASC`
    )
    .bind(examId)
    .all();

  return cachedJson(
    request,
    {
      ok: true,
      rows: (rowsResult?.results || []).map((row) => ({
        id: Number(row.id || 0),
        questionType: normalizeQuestionType(row.question_type),
        prompt: text(row.prompt),
        choices: parseArrayJson(row.choices_json),
        correctAnswer: text(row.correct_answer_json),
        points: toPoints(row.points),
        orderIndex: Number(row.order_index || 0),
        updatedAt: row.updated_at || null
      }))
    },
    { cacheControl: 'private, max-age=5, stale-while-revalidate=10' }
  );
}

export async function onRequestPost(context) {
  const { env, request, params } = context;
  const { errorResponse, employee, capabilities } = await requireCollegeSession(context, {
    requiredAnyCapabilities: ['college:admin', 'course:manage', 'exam:mark']
  });
  if (errorResponse) return errorResponse;
  if (!(capabilities?.['college:admin'] || capabilities?.['course:manage'] || capabilities?.['exam:mark'])) {
    return json({ error: 'Forbidden. Missing required permission.' }, 403);
  }

  const examId = toId(params?.examId);
  if (!examId) return json({ error: 'Invalid exam id.' }, 400);

  const exam = await env.DB.prepare(`SELECT id FROM college_exams WHERE id = ?`).bind(examId).first();
  if (!exam) return json({ error: 'Exam not found.' }, 404);

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const id = toId(payload?.id);
  const questionType = normalizeQuestionType(payload?.questionType);
  const prompt = text(payload?.prompt);
  const choices = parseArrayJson(payload?.choices);
  const correctAnswer = text(payload?.correctAnswer);
  const points = toPoints(payload?.points);
  const orderIndex = Math.max(1, Number(payload?.orderIndex || 1));
  const actorId = Number(employee?.id || 0) || null;

  if (!prompt) return json({ error: 'Question prompt is required.' }, 400);
  if (questionType === 'mcq') {
    if (choices.length < 2) return json({ error: 'MCQ requires at least 2 choices.' }, 400);
    if (!correctAnswer) return json({ error: 'MCQ requires a correct answer.' }, 400);
  }

  if (id) {
    await env.DB.batch([
      env.DB
        .prepare(
          `UPDATE college_exam_questions
           SET question_type = ?,
               prompt = ?,
               choices_json = ?,
               correct_answer_json = ?,
               points = ?,
               order_index = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND exam_id = ?`
        )
        .bind(
          questionType,
          prompt,
          questionType === 'mcq' ? JSON.stringify(choices) : null,
          correctAnswer || null,
          points,
          orderIndex,
          id,
          examId
        ),
      env.DB
        .prepare(
          `INSERT INTO college_audit_events
           (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
           VALUES (?, 'exam_question_update', ?, ?, CURRENT_TIMESTAMP)`
        )
        .bind(
          actorId,
          actorId,
          JSON.stringify({
            examId,
            questionId: id,
            questionType,
            points
          })
        )
    ]);

    return json({ ok: true, id });
  }

  const inserted = await env.DB
    .prepare(
      `INSERT INTO college_exam_questions
       (exam_id, question_type, prompt, choices_json, correct_answer_json, points, order_index, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(
      examId,
      questionType,
      prompt,
      questionType === 'mcq' ? JSON.stringify(choices) : null,
      correctAnswer || null,
      points,
      orderIndex
    )
    .run();

  const questionId = Number(inserted?.meta?.last_row_id || 0);
  await env.DB
    .prepare(
      `INSERT INTO college_audit_events
       (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
       VALUES (?, 'exam_question_create', ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(
      actorId,
      actorId,
      JSON.stringify({
        examId,
        questionId,
        questionType,
        points
      })
    )
    .run();

  return json({ ok: true, id: questionId });
}
