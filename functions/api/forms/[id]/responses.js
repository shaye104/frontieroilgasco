import { json } from '../../auth/_lib/auth.js';
import { getFormDetail, questionAnswerIsEmpty, requireAuthenticated } from '../../_lib/forms.js';
import { hasPermission } from '../../_lib/permissions.js';

async function canAccessForm(env, session, employee, formId) {
  if (hasPermission(session, 'forms.manage')) return true;
  if (!employee) return false;

  const roles = Array.isArray(session.appRoleIds) ? session.appRoleIds.map((r) => String(r)) : [];
  let sql = `SELECT 1
             FROM forms f
             LEFT JOIN form_access_employees fae ON fae.form_id = f.id
             LEFT JOIN form_access_roles far ON far.form_id = f.id
             WHERE f.id = ? AND f.status = 'published' AND (fae.employee_id = ?`;
  const bindings = [formId, employee.id];

  if (roles.length) {
    sql += ` OR far.role_id IN (${roles.map(() => '?').join(',')})`;
    bindings.push(...roles);
  }

  sql += ') LIMIT 1';

  const row = await env.DB.prepare(sql).bind(...bindings).first();
  return Boolean(row);
}

export async function onRequestPost(context) {
  const { env, params } = context;
  const { errorResponse, session, employee } = await requireAuthenticated(context);
  if (errorResponse) return errorResponse;
  if (!hasPermission(session, 'forms.submit')) return json({ error: 'Forbidden. Missing required permission.' }, 403);

  const formId = Number(params.id);
  if (!Number.isInteger(formId) || formId <= 0) return json({ error: 'Invalid form id.' }, 400);

  const detail = await getFormDetail(env, formId);
  if (!detail) return json({ error: 'Form not found.' }, 404);

  const allowed = await canAccessForm(env, session, employee, formId);
  if (!allowed) return json({ error: 'You do not have access to this form.' }, 403);

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const answerMap = payload?.answers && typeof payload.answers === 'object' ? payload.answers : {};

  for (const question of detail.questions) {
    const answer = answerMap[String(question.id)];
    if (question.isRequired && questionAnswerIsEmpty(question.questionType, answer)) {
      return json({ error: `Required question missing: ${question.label}` }, 400);
    }
  }

  const insertResponse = await env.DB
    .prepare('INSERT INTO form_responses (form_id, employee_id, respondent_discord_user_id) VALUES (?, ?, ?)')
    .bind(formId, employee?.id || null, session.userId)
    .run();

  const responseId = Number(insertResponse.meta.last_row_id);

  const answerStatements = detail.questions.map((question) => {
    const value = Object.prototype.hasOwnProperty.call(answerMap, String(question.id)) ? answerMap[String(question.id)] : null;
    return env.DB
      .prepare('INSERT INTO form_response_answers (response_id, question_id, answer_json) VALUES (?, ?, ?)')
      .bind(responseId, question.id, value === undefined ? null : JSON.stringify(value));
  });

  if (answerStatements.length) await env.DB.batch(answerStatements);

  return json({ ok: true, responseId, submittedAt: new Date().toISOString() }, 201);
}
