import { json } from '../auth/_lib/auth.js';
import { getFormDetail, requireAuthenticated } from '../_lib/forms.js';

async function canAccessForm(env, session, employee, formId) {
  if (session.isAdmin) return true;
  if (!employee) return false;

  const roles = Array.isArray(session.roles) ? session.roles.map((r) => String(r)) : [];
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

export async function onRequestGet(context) {
  const { env, params } = context;
  const { errorResponse, session, employee } = await requireAuthenticated(context);
  if (errorResponse) return errorResponse;

  const formId = Number(params.id);
  if (!Number.isInteger(formId) || formId <= 0) return json({ error: 'Invalid form id.' }, 400);

  const detail = await getFormDetail(env, formId);
  if (!detail) return json({ error: 'Form not found.' }, 404);

  if (!session.isAdmin) {
    const allowed = await canAccessForm(env, session, employee, formId);
    if (!allowed) return json({ error: 'You do not have access to this form.' }, 403);
  }

  return json({
    form: detail.form,
    questions: detail.questions
  });
}
