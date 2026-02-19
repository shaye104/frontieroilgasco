import { json } from '../../auth/_lib/auth.js';
import { requireFormsAdmin } from '../../_lib/forms.js';
import { getFormDetail, saveFormRelations } from '../../_lib/forms.js';

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse } = await requireFormsAdmin(context);
  if (errorResponse) return errorResponse;

  const forms = await env.DB
    .prepare(
      `SELECT f.id, f.title, f.description, f.instructions, f.category_id, c.name AS category_name, f.status, f.created_by, f.created_at, f.updated_at
       FROM forms f
       LEFT JOIN form_categories c ON c.id = f.category_id
       ORDER BY f.updated_at DESC, f.id DESC`
    )
    .all();

  return json({ forms: forms?.results || [] });
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse, session } = await requireFormsAdmin(context);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const title = String(payload?.title || '').trim();
  const description = String(payload?.description || '').trim();
  const instructions = String(payload?.instructions || '').trim();
  const categoryId = Number(payload?.categoryId);
  const status = String(payload?.status || 'draft').trim().toLowerCase();

  if (!title) return json({ error: 'title is required.' }, 400);
  if (!['draft', 'published', 'archived'].includes(status)) return json({ error: 'status must be draft, published, or archived.' }, 400);

  const insert = await env.DB
    .prepare(
      `INSERT INTO forms (title, description, instructions, category_id, status, created_by, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(title, description, instructions, Number.isInteger(categoryId) && categoryId > 0 ? categoryId : null, status, session.displayName || session.userId)
    .run();

  const formId = Number(insert.meta.last_row_id);

  try {
    await saveFormRelations(env, formId, payload);
  } catch (error) {
    await env.DB.prepare('DELETE FROM forms WHERE id = ?').bind(formId).run();
    return json({ error: error.message || 'Unable to save form questions/access.' }, 400);
  }

  const detail = await getFormDetail(env, formId);
  return json(detail, 201);
}
