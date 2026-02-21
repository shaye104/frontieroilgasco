import { json } from '../../../auth/_lib/auth.js';
import { evaluateAndApplyCollegePass, requireCollegeSession } from '../../../_lib/college.js';

function text(value) {
  return String(value || '').trim();
}

function toId(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeAnswer(value) {
  return text(value).toLowerCase();
}

function parseChoices(value) {
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map((entry) => text(entry)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

export async function onRequestPost(context) {
  const { env, request, params } = context;
  const { errorResponse, employee, canManage } = await requireCollegeSession(context);
  if (errorResponse) return errorResponse;

  const examId = toId(params?.examId);
  if (!examId) return json({ error: 'Invalid exam id.' }, 400);
  const employeeId = Number(employee?.id || 0);
  if (!employeeId) return json({ error: 'Employee profile required.' }, 403);

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const exam = await env.DB
    .prepare(
      `SELECT
         ex.id,
         ex.course_id,
         ex.passing_score,
         ex.attempt_limit,
         ex.published
       FROM college_exams ex
       WHERE ex.id = ?`
    )
    .bind(examId)
    .first();
  if (!exam) return json({ error: 'Exam not found.' }, 404);
  if (!canManage && Number(exam.published || 0) !== 1) return json({ error: 'Exam is not available.' }, 404);

  const courseId = Number(exam.course_id || 0);
  if (!canManage) {
    const enrollment = await env.DB
      .prepare(`SELECT id FROM college_enrollments WHERE user_employee_id = ? AND course_id = ? LIMIT 1`)
      .bind(employeeId, courseId)
      .first();
    if (!enrollment) return json({ error: 'You are not enrolled for this exam.' }, 403);
  }

  const attemptsRow = await env.DB
    .prepare(`SELECT COUNT(*) AS total FROM college_exam_attempts WHERE exam_id = ? AND user_employee_id = ?`)
    .bind(examId, employeeId)
    .first();
  const attemptsUsed = Number(attemptsRow?.total || 0);
  const attemptLimit = Math.max(1, Number(exam.attempt_limit || 3));
  if (!canManage && attemptsUsed >= attemptLimit) {
    return json({ error: 'No attempts remaining for this exam.' }, 400);
  }

  const questionsResult = await env.DB
    .prepare(
      `SELECT
         id,
         question_type,
         prompt,
         choices_json,
         correct_answer_json,
         points
       FROM college_exam_questions
       WHERE exam_id = ?
       ORDER BY order_index ASC, id ASC`
    )
    .bind(examId)
    .all();
  const questions = questionsResult?.results || [];
  if (!questions.length) return json({ error: 'Exam has no questions.' }, 400);

  const answers = payload?.answers && typeof payload.answers === 'object' ? payload.answers : {};

  let totalPoints = 0;
  let earnedPoints = 0;
  let requiresManualGrading = false;

  const savedAnswers = questions.map((question) => {
    const qid = Number(question.id || 0);
    const type = text(question.question_type).toLowerCase() || 'mcq';
    const points = Math.max(1, Number(question.points || 1));
    const prompt = text(question.prompt);
    const choices = parseChoices(question.choices_json);
    const rawAnswer = answers[String(qid)] ?? answers[qid];
    const candidateAnswer = text(rawAnswer);
    const expectedAnswer = text(question.correct_answer_json);

    totalPoints += points;

    let isCorrect = false;
    if (type === 'mcq') {
      isCorrect = normalizeAnswer(candidateAnswer) === normalizeAnswer(expectedAnswer);
    } else if (expectedAnswer) {
      isCorrect = normalizeAnswer(candidateAnswer) === normalizeAnswer(expectedAnswer);
    } else {
      requiresManualGrading = true;
    }

    if (isCorrect) earnedPoints += points;

    return {
      questionId: qid,
      questionType: type,
      prompt,
      choices,
      answer: candidateAnswer,
      expectedAnswer: type === 'mcq' ? expectedAnswer : undefined,
      points,
      isCorrect: requiresManualGrading ? null : isCorrect
    };
  });

  const finalScore = totalPoints > 0 ? Math.round((earnedPoints / totalPoints) * 100) : 0;
  const passThreshold = Math.max(1, Math.min(100, Number(exam.passing_score || 70)));
  const passed = !requiresManualGrading && finalScore >= passThreshold;

  const inserted = await env.DB
    .prepare(
      `INSERT INTO college_exam_attempts
       (exam_id, user_employee_id, started_at, submitted_at, score, passed, graded_by_employee_id, grading_notes, answers_json, created_at)
       VALUES (?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(
      examId,
      employeeId,
      requiresManualGrading ? null : finalScore,
      passed ? 1 : 0,
      requiresManualGrading ? null : employeeId,
      requiresManualGrading ? 'Pending manual grading' : 'Auto graded',
      JSON.stringify({
        answers: savedAnswers,
        totalPoints,
        earnedPoints
      })
    )
    .run();

  const attemptId = Number(inserted?.meta?.last_row_id || 0);

  await env.DB
    .prepare(
      `INSERT INTO college_audit_events
       (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(
      employeeId,
      requiresManualGrading ? 'exam_attempt_submitted_pending_grade' : 'exam_attempt_submitted',
      employeeId,
      JSON.stringify({
        examId,
        attemptId,
        score: requiresManualGrading ? null : finalScore,
        passed
      })
    )
    .run();

  if (passed && courseId) {
    await env.DB
      .prepare(
        `UPDATE college_enrollments
         SET final_quiz_passed = 1,
             status = CASE WHEN status = 'passed' THEN status ELSE 'in_progress' END
         WHERE user_employee_id = ? AND course_id = ?`
      )
      .bind(employeeId, courseId)
      .run();

    const candidate = await env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(employeeId).first();
    if (candidate) {
      await evaluateAndApplyCollegePass(env, candidate, employeeId, 'exam_submit_passed');
    }
  }

  return json({
    ok: true,
    attemptId,
    status: requiresManualGrading ? 'pending_manual_grade' : 'graded',
    score: requiresManualGrading ? null : finalScore,
    passed: Boolean(passed),
    remainingAttempts: Math.max(0, attemptLimit - (attemptsUsed + 1))
  });
}
