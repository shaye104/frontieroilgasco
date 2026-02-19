import { json } from '../../auth/_lib/auth.js';
import { hasFormsAdminAccess, requireAuthenticated } from '../../_lib/forms.js';

export async function onRequestGet(context) {
  const { env, params } = context;
  const { errorResponse, session, employee } = await requireAuthenticated(context);
  if (errorResponse) return errorResponse;

  const responseId = Number(params.id);
  if (!Number.isInteger(responseId) || responseId <= 0) return json({ error: 'Invalid response id.' }, 400);

  const response = await env.DB
    .prepare(
      `SELECT r.id, r.form_id, r.employee_id, r.respondent_discord_user_id, r.submitted_at,
              f.title AS form_title, f.description AS form_description, f.instructions, f.category_id,
              c.name AS category_name,
              e.roblox_username AS respondent_name, e.serial_number AS respondent_serial, e.discord_user_id
       FROM form_responses r
       INNER JOIN forms f ON f.id = r.form_id
       LEFT JOIN form_categories c ON c.id = f.category_id
       LEFT JOIN employees e ON e.id = r.employee_id
       WHERE r.id = ?`
    )
    .bind(responseId)
    .first();

  if (!response) return json({ error: 'Response not found.' }, 404);

  const isFormsAdmin = hasFormsAdminAccess(env, session);
  if (!isFormsAdmin) {
    if (!employee) return json({ error: 'Forbidden.' }, 403);
    if (String(response.respondent_discord_user_id || '') !== String(session.userId)) {
      return json({ error: 'Forbidden.' }, 403);
    }
  }

  const answersResult = await env.DB
    .prepare(
      `SELECT a.id, a.question_id, a.answer_json, q.label, q.question_type, q.sort_order
       FROM form_response_answers a
       INNER JOIN form_questions q ON q.id = a.question_id
       WHERE a.response_id = ?
       ORDER BY q.sort_order ASC, q.id ASC`
    )
    .bind(responseId)
    .all();

  const answers = (answersResult?.results || []).map((row) => {
    let answer = null;
    try {
      answer = row.answer_json ? JSON.parse(row.answer_json) : null;
    } catch {
      answer = row.answer_json;
    }

    return {
      id: row.id,
      questionId: row.question_id,
      label: row.label,
      questionType: row.question_type,
      answer
    };
  });

  return json({ response, answers, isFormsAdmin });
}
