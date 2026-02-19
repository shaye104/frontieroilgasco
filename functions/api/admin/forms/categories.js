import { json } from '../../auth/_lib/auth.js';
import { requireAdmin } from '../_lib/admin-auth.js';

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse } = await requireAdmin(context);
  if (errorResponse) return errorResponse;

  const result = await env.DB
    .prepare('SELECT id, name, description, sort_order, created_at, updated_at FROM form_categories ORDER BY sort_order ASC, name ASC')
    .all();

  return json({ categories: result?.results || [] });
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse } = await requireAdmin(context);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const name = String(payload?.name || '').trim();
  const description = String(payload?.description || '').trim();
  const sortOrder = Number.isFinite(Number(payload?.sortOrder)) ? Number(payload.sortOrder) : 0;

  if (!name) return json({ error: 'name is required.' }, 400);

  await env.DB
    .prepare('INSERT INTO form_categories (name, description, sort_order, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
    .bind(name, description, sortOrder)
    .run();

  const created = await env.DB.prepare('SELECT id, name, description, sort_order FROM form_categories WHERE name = ?').bind(name).first();
  return json({ category: created }, 201);
}

export async function onRequestPut(context) {
  const { env } = context;
  const { errorResponse } = await requireAdmin(context);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const categoryId = Number(payload?.id);
  if (!Number.isInteger(categoryId) || categoryId <= 0) return json({ error: 'id is required.' }, 400);

  const name = String(payload?.name || '').trim();
  const description = String(payload?.description || '').trim();
  const sortOrder = Number.isFinite(Number(payload?.sortOrder)) ? Number(payload.sortOrder) : 0;

  if (!name) return json({ error: 'name is required.' }, 400);

  await env.DB
    .prepare('UPDATE form_categories SET name = ?, description = ?, sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(name, description, sortOrder, categoryId)
    .run();

  const updated = await env.DB
    .prepare('SELECT id, name, description, sort_order, created_at, updated_at FROM form_categories WHERE id = ?')
    .bind(categoryId)
    .first();

  if (!updated) return json({ error: 'Category not found.' }, 404);
  return json({ category: updated });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const { errorResponse } = await requireAdmin(context);
  if (errorResponse) return errorResponse;

  const categoryId = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(categoryId) || categoryId <= 0) return json({ error: 'id is required.' }, 400);

  await env.DB.prepare('UPDATE forms SET category_id = NULL WHERE category_id = ?').bind(categoryId).run();
  await env.DB.prepare('DELETE FROM form_categories WHERE id = ?').bind(categoryId).run();

  return json({ ok: true });
}
