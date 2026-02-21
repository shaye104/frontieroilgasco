import { json } from '../../../auth/_lib/auth.js';
import { evaluateAndApplyCollegePass, getCollegeOverview, requireCollegeSession } from '../../../_lib/college.js';

function toId(value) {
  const parsed = Number(value || 0);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

export async function onRequestPost(context) {
  const { env, params } = context;
  const { errorResponse, employee, capabilities, isRestricted } = await requireCollegeSession(context);
  if (errorResponse) return errorResponse;

  const moduleId = toId(params?.moduleId);
  if (!moduleId) return json({ error: 'Invalid module id.' }, 400);

  const employeeId = Number(employee?.id || 0);
  const moduleRow = await env.DB
    .prepare(
      `SELECT
         m.id,
         m.course_id,
         m.content_type,
         LOWER(COALESCE(m.completion_rule, 'manual')) AS completion_rule,
         COALESCE(m.self_completable, 0) AS self_completable
       FROM college_course_modules m
       INNER JOIN college_enrollments e
         ON e.course_id = m.course_id
       WHERE m.id = ? AND e.user_employee_id = ?
         AND LOWER(COALESCE(e.status, 'in_progress')) != 'removed'
       LIMIT 1`
    )
    .bind(moduleId, employeeId)
    .first();
  if (!moduleRow) return json({ error: 'Module not found for this user.' }, 404);

  const contentType = String(moduleRow.content_type || '').trim().toLowerCase();
  const completionRule = String(moduleRow.completion_rule || 'manual').trim().toLowerCase();
  const selfCompletable = Number(moduleRow.self_completable || 0) === 1;
  const courseId = Number(moduleRow.course_id || 0);
  const canOverrideProgress = Boolean(capabilities?.['progress:override'] || capabilities?.['exam:mark'] || capabilities?.['college:admin']);
  const canSelfComplete = selfCompletable || completionRule === 'self_complete';
  const shouldQueueReview = isRestricted || (!canOverrideProgress && !canSelfComplete);

  if (shouldQueueReview) {
    await env.DB
      .prepare(
        `INSERT INTO college_module_progress
         (user_employee_id, module_id, status, requested_at, completed_at, completed_by_employee_id, completion_meta_json)
         VALUES (?, ?, 'awaiting_marking', CURRENT_TIMESTAMP, NULL, NULL, ?)
         ON CONFLICT(user_employee_id, module_id)
         DO UPDATE SET
           status = 'awaiting_marking',
           requested_at = CURRENT_TIMESTAMP,
           completed_at = NULL,
           completed_by_employee_id = NULL,
           completion_meta_json = excluded.completion_meta_json`
      )
      .bind(
        employeeId,
        moduleId,
        JSON.stringify({
          source: 'self_submit_for_review',
          contentType
        })
      )
      .run();

    return json({
      ok: true,
      moduleId,
      action: 'awaiting_marking'
    });
  }

  await env.DB
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
      employeeId,
      moduleId,
      canOverrideProgress ? employeeId : null,
      JSON.stringify({
        source: canOverrideProgress ? 'override_complete' : 'self_complete',
        contentType
      })
    )
    .run();

  const totals = await env.DB
    .prepare(
      `SELECT
         (
           SELECT COUNT(*) FROM college_course_modules WHERE course_id = ?
         ) AS total_modules,
         (
           SELECT COUNT(*)
           FROM college_module_progress mp
           INNER JOIN college_course_modules m ON m.id = mp.module_id
           WHERE mp.user_employee_id = ? AND m.course_id = ?
             AND (
               mp.completed_at IS NOT NULL
               OR LOWER(COALESCE(mp.status, '')) = 'complete'
             )
         ) AS completed_modules`
    )
    .bind(courseId, employeeId, courseId)
    .first();
  const totalModules = Math.max(0, Number(totals?.total_modules || 0));
  const completedModules = Math.max(0, Number(totals?.completed_modules || 0));
  const isComplete = totalModules > 0 && completedModules >= totalModules;

  if (isComplete) {
    await env.DB
      .prepare(
        `UPDATE college_enrollments
         SET status = CASE WHEN terms_acknowledged = 1 AND final_quiz_passed = 1 THEN 'passed' ELSE 'completed' END,
             completed_at = COALESCE(completed_at, CURRENT_TIMESTAMP),
             passed_at = CASE WHEN terms_acknowledged = 1 AND final_quiz_passed = 1 THEN COALESCE(passed_at, CURRENT_TIMESTAMP) ELSE passed_at END
         WHERE user_employee_id = ? AND course_id = ?`
      )
      .bind(employeeId, courseId)
      .run();
  }

  await evaluateAndApplyCollegePass(env, employee, employeeId, 'module_complete');
  const refreshed = await env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(employeeId).first();
  const overview = await getCollegeOverview(env, refreshed || employee);

  return json({
    ok: true,
    moduleId,
    action: canOverrideProgress ? 'completed_by_override' : 'completed',
    overview
  });
}
