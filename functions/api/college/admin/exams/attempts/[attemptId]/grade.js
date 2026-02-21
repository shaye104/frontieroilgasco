import { json } from '../../../../../auth/_lib/auth.js';
import { evaluateAndApplyCollegePass, requireCollegeSession } from '../../../../../_lib/college.js';

function text(value) {
  return String(value || '').trim();
}

function toId(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toScore(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n));
}

export async function onRequestPost(context) {
  const { env, request, params } = context;
  const { errorResponse, employee, capabilities } = await requireCollegeSession(context, {
    requiredAnyCapabilities: ['college:admin', 'exam:mark', 'progress:override']
  });
  if (errorResponse) return errorResponse;
  if (!(capabilities?.['college:admin'] || capabilities?.['exam:mark'] || capabilities?.['progress:override'])) {
    return json({ error: 'Forbidden. Missing required permission.' }, 403);
  }

  const attemptId = toId(params?.attemptId);
  if (!attemptId) return json({ error: 'Invalid attempt id.' }, 400);

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const score = toScore(payload?.score);
  const notes = text(payload?.gradingNotes || payload?.notes);
  if (score == null) return json({ error: 'score must be between 0 and 100.' }, 400);

  const attempt = await env.DB
    .prepare(
      `SELECT
         a.id,
         a.exam_id,
         a.user_employee_id,
         a.submitted_at,
         a.score,
         a.passed,
         ex.passing_score,
         ex.course_id,
         ex.module_id
       FROM college_exam_attempts a
       INNER JOIN college_exams ex ON ex.id = a.exam_id
       WHERE a.id = ?`
    )
    .bind(attemptId)
    .first();
  if (!attempt) return json({ error: 'Attempt not found.' }, 404);
  if (!attempt.submitted_at) return json({ error: 'Attempt has not been submitted yet.' }, 400);

  const passThreshold = Math.max(1, Math.min(100, Number(attempt.passing_score || 70)));
  const passed = score >= passThreshold ? 1 : 0;
  const actorId = Number(employee?.id || 0) || null;
  const targetEmployeeId = Number(attempt.user_employee_id || 0) || null;
  const courseId = Number(attempt.course_id || 0) || null;

  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE college_exam_attempts
         SET score = ?,
             passed = ?,
             graded_by_employee_id = ?,
             grading_notes = ?
         WHERE id = ?`
      )
      .bind(score, passed, actorId, notes || null, attemptId),
    env.DB
      .prepare(
        `INSERT INTO college_audit_events
         (user_employee_id, action, performed_by_employee_id, meta_json, created_at)
         VALUES (?, 'exam_attempt_graded', ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(
        targetEmployeeId || actorId,
        actorId,
        JSON.stringify({
          target: { type: 'exam_attempt', id: attemptId, examId: Number(attempt.exam_id || 0) },
          before: {
            score: attempt.score == null ? null : Number(attempt.score),
            passed: Number(attempt.passed || 0) === 1
          },
          after: {
            score,
            passed: Boolean(passed),
            markedByEmployeeId: actorId
          }
        })
      )
  ]);

  if (passed && targetEmployeeId && courseId) {
    const updates = [
      env.DB
        .prepare(
          `UPDATE college_enrollments
           SET final_quiz_passed = 1,
               status = CASE WHEN status = 'passed' THEN status ELSE 'in_progress' END
           WHERE user_employee_id = ? AND course_id = ?`
        )
        .bind(targetEmployeeId, courseId)
    ];
    const moduleId = Number(attempt.module_id || 0);
    if (moduleId > 0) {
      updates.push(
        env.DB
          .prepare(
            `INSERT INTO college_module_progress
             (user_employee_id, module_id, status, completed_at, completed_by_employee_id, completion_meta_json)
             VALUES (?, ?, 'complete', CURRENT_TIMESTAMP, ?, ?)
             ON CONFLICT(user_employee_id, module_id)
             DO UPDATE SET
               status = 'complete',
               completed_at = CURRENT_TIMESTAMP,
               completed_by_employee_id = excluded.completed_by_employee_id,
               completion_meta_json = excluded.completion_meta_json`
          )
          .bind(
            targetEmployeeId,
            moduleId,
            actorId,
            JSON.stringify({
              source: 'exam_marked_pass',
              examId: Number(attempt.exam_id || 0),
              attemptId
            })
          )
      );
    }
    await env.DB.batch(updates);

    const candidate = await env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(targetEmployeeId).first();
    if (candidate) {
      await evaluateAndApplyCollegePass(env, candidate, actorId, 'exam_graded_passed');
    }
  }

  return json({ ok: true, attemptId, score, passed: Boolean(passed) });
}
