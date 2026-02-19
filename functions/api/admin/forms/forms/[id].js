import { json } from '../../../auth/_lib/auth.js';
import { requirePermission } from '../../_lib/admin-auth.js';
import { getFormDetail, saveFormRelations } from '../../../_lib/forms.js';

export async function onRequestGet(context) {
  const { env, params } = context;
  const { errorResponse } = await requirePermission(context, ['forms.manage']);
  if (errorResponse) return errorResponse;

  const formId = Number(params.id);
  if (!Number.isInteger(formId) || formId <= 0) return json({ error: 'Invalid form id.' }, 400);

  const detail = await getFormDetail(env, formId);
  if (!detail) return json({ error: 'Form not found.' }, 404);

  return json(detail);
}

export async function onRequestPut(context) {
  const { env, params } = context;
  const { errorResponse } = await requirePermission(context, ['forms.manage']);
  if (errorResponse) return errorResponse;

  const formId = Number(params.id);
  if (!Number.isInteger(formId) || formId <= 0) return json({ error: 'Invalid form id.' }, 400);

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const existing = await env.DB.prepare('SELECT id FROM forms WHERE id = ?').bind(formId).first();
  if (!existing) return json({ error: 'Form not found.' }, 404);

  const title = String(payload?.title || '').trim();
  const description = String(payload?.description || '').trim();
  const instructions = String(payload?.instructions || '').trim();
  const categoryId = Number(payload?.categoryId);
  const status = String(payload?.status || 'draft').trim().toLowerCase();

  if (!title) return json({ error: 'title is required.' }, 400);
  if (!['draft', 'published', 'archived'].includes(status)) return json({ error: 'status must be draft, published, or archived.' }, 400);

  await env.DB
    .prepare(
      `UPDATE forms
       SET title = ?, description = ?, instructions = ?, category_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(title, description, instructions, Number.isInteger(categoryId) && categoryId > 0 ? categoryId : null, status, formId)
    .run();

  try {
    await saveFormRelations(env, formId, payload);
  } catch (error) {
    return json({ error: error.message || 'Unable to save form questions/access.' }, 400);
  }

  const detail = await getFormDetail(env, formId);
  return json(detail);
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  const { errorResponse } = await requirePermission(context, ['forms.manage']);
  if (errorResponse) return errorResponse;

  const formId = Number(params.id);
  if (!Number.isInteger(formId) || formId <= 0) return json({ error: 'Invalid form id.' }, 400);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM form_response_answers WHERE response_id IN (SELECT id FROM form_responses WHERE form_id = ?)').bind(formId),
    env.DB.prepare('DELETE FROM form_responses WHERE form_id = ?').bind(formId),
    env.DB.prepare('DELETE FROM form_access_roles WHERE form_id = ?').bind(formId),
    env.DB.prepare('DELETE FROM form_access_employees WHERE form_id = ?').bind(formId),
    env.DB.prepare('DELETE FROM form_questions WHERE form_id = ?').bind(formId),
    env.DB.prepare('DELETE FROM forms WHERE id = ?').bind(formId)
  ]);

  return json({ ok: true });
}
