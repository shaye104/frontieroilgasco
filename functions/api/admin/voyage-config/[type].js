import { json } from '../../auth/_lib/auth.js';
import { requirePermission } from '../_lib/admin-auth.js';

const TABLE_BY_TYPE = {
  ports: 'config_voyage_ports',
  vessel_names: 'config_vessel_names',
  vessel_classes: 'config_vessel_classes',
  vessel_callsigns: 'config_vessel_callsigns',
  cargo_types: 'cargo_types'
};

function tableFor(type) {
  return TABLE_BY_TYPE[String(type || '').trim().toLowerCase()] || '';
}

function text(value) {
  return String(value || '').trim();
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const { errorResponse } = await requirePermission(context, ['voyages.config.manage']);
  if (errorResponse) return errorResponse;

  const table = tableFor(params.type);
  if (!table) return json({ error: 'Unsupported voyage config type.' }, 404);

  const rows =
    table === 'cargo_types'
      ? await env.DB
          .prepare(`SELECT id, name AS value, created_at, updated_at FROM cargo_types WHERE active = 1 ORDER BY name ASC, id ASC`)
          .all()
      : await env.DB
          .prepare(`SELECT id, value, created_at, updated_at FROM ${table} ORDER BY value ASC, id ASC`)
          .all();
  return json({ items: rows?.results || [] });
}

export async function onRequestPost(context) {
  const { env, params } = context;
  const { errorResponse } = await requirePermission(context, ['voyages.config.manage']);
  if (errorResponse) return errorResponse;

  const table = tableFor(params.type);
  if (!table) return json({ error: 'Unsupported voyage config type.' }, 404);

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const value = text(payload?.value);
  if (!value) return json({ error: 'Value is required.' }, 400);

  try {
    if (table === 'cargo_types') {
      await env.DB
        .prepare(`INSERT INTO cargo_types (name, default_price, active, updated_at) VALUES (?, 0, 1, CURRENT_TIMESTAMP)`)
        .bind(value)
        .run();
    } else {
      await env.DB
        .prepare(`INSERT INTO ${table} (value, updated_at) VALUES (?, CURRENT_TIMESTAMP)`)
        .bind(value)
        .run();
    }
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('unique')) {
      return json({ error: 'Value already exists.' }, 400);
    }
    throw error;
  }

  return json({ ok: true }, 201);
}

export async function onRequestPut(context) {
  const { env, params } = context;
  const { errorResponse } = await requirePermission(context, ['voyages.config.manage']);
  if (errorResponse) return errorResponse;

  const table = tableFor(params.type);
  if (!table) return json({ error: 'Unsupported voyage config type.' }, 404);

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const id = Number(payload?.id);
  const value = text(payload?.value);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'id is required.' }, 400);
  if (!value) return json({ error: 'Value is required.' }, 400);

  try {
    if (table === 'cargo_types') {
      await env.DB
        .prepare(`UPDATE cargo_types SET name = ?, active = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(value, id)
        .run();
    } else {
      await env.DB
        .prepare(`UPDATE ${table} SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
        .bind(value, id)
        .run();
    }
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('unique')) {
      return json({ error: 'Value already exists.' }, 400);
    }
    throw error;
  }

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { env, params, request } = context;
  const { errorResponse } = await requirePermission(context, ['voyages.config.manage']);
  if (errorResponse) return errorResponse;

  const table = tableFor(params.type);
  if (!table) return json({ error: 'Unsupported voyage config type.' }, 404);

  const id = Number(new URL(request.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'id is required.' }, 400);

  if (table === 'cargo_types') {
    await env.DB
      .prepare(`UPDATE cargo_types SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(id)
      .run();
  } else {
    await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  }
  return json({ ok: true });
}
