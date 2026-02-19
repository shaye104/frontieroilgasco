import { json } from '../auth/_lib/auth.js';
import { requirePermission } from './_lib/admin-auth.js';

function text(value) {
  return String(value || '').trim();
}

function asDefaultPrice(value) {
  if (value === '' || value === null || value === undefined) return null;
  const num = Number(value);
  return Number.isFinite(num) && num >= 0 ? Math.round(num * 100) / 100 : NaN;
}

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse } = await requirePermission(context, ['cargo.manage']);
  if (errorResponse) return errorResponse;

  const result = await env.DB
    .prepare('SELECT id, name, active, default_price, created_at, updated_at FROM cargo_types ORDER BY name ASC, id ASC')
    .all();
  return json({ cargoTypes: result?.results || [] });
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse } = await requirePermission(context, ['cargo.manage']);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const name = text(payload?.name);
  const active = payload?.active === undefined ? 1 : payload.active ? 1 : 0;
  const defaultPrice = asDefaultPrice(payload?.defaultPrice);
  if (!name) return json({ error: 'Cargo name is required.' }, 400);
  if (Number.isNaN(defaultPrice)) return json({ error: 'Default price must be >= 0.' }, 400);

  await env.DB
    .prepare('INSERT INTO cargo_types (name, active, default_price, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
    .bind(name, active, defaultPrice)
    .run();

  const created = await env.DB.prepare('SELECT id FROM cargo_types WHERE name = ?').bind(name).first();
  return json({ id: created?.id }, 201);
}

export async function onRequestPut(context) {
  const { env } = context;
  const { errorResponse } = await requirePermission(context, ['cargo.manage']);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const id = Number(payload?.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'Cargo id is required.' }, 400);

  const name = text(payload?.name);
  const active = payload?.active === undefined ? 1 : payload.active ? 1 : 0;
  const defaultPrice = asDefaultPrice(payload?.defaultPrice);
  if (!name) return json({ error: 'Cargo name is required.' }, 400);
  if (Number.isNaN(defaultPrice)) return json({ error: 'Default price must be >= 0.' }, 400);

  await env.DB
    .prepare('UPDATE cargo_types SET name = ?, active = ?, default_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(name, active, defaultPrice, id)
    .run();

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { env, request } = context;
  const { errorResponse } = await requirePermission(context, ['cargo.manage']);
  if (errorResponse) return errorResponse;

  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'Cargo id is required.' }, 400);
  await env.DB.prepare('DELETE FROM cargo_types WHERE id = ?').bind(id).run();
  return json({ ok: true });
}
