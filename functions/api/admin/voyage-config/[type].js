import { json } from '../../auth/_lib/auth.js';
import { requirePermission } from '../_lib/admin-auth.js';

const TABLE_BY_TYPE = {
  ports: 'config_voyage_ports',
  fish_types: 'config_fish_types',
  sell_locations: 'config_sell_locations',
  cargo_types: 'config_fish_types'
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
    table === 'config_fish_types'
      ? await env.DB
          .prepare(
            `SELECT id, name AS value, unit_price, created_at, updated_at
             FROM config_fish_types
             WHERE active = 1
             ORDER BY name ASC, id ASC`
          )
          .all()
      : table === 'config_sell_locations'
      ? await env.DB
          .prepare(
            `SELECT id, name AS value, multiplier, created_at, updated_at
             FROM config_sell_locations
             WHERE active = 1
             ORDER BY name ASC, id ASC`
          )
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
  const numericValue = Number(payload?.numericValue);

  try {
    if (table === 'config_fish_types') {
      if (!Number.isFinite(numericValue) || numericValue < 0) {
        return json({ error: 'Fish buy price must be a number >= 0.' }, 400);
      }
      await env.DB
        .prepare(`INSERT INTO config_fish_types (name, unit_price, active, updated_at) VALUES (?, ?, 1, CURRENT_TIMESTAMP)`)
        .bind(value, numericValue)
        .run();
    } else if (table === 'config_sell_locations') {
      await env.DB
        .prepare(
          `INSERT INTO config_sell_locations (name, multiplier, active, updated_at)
           VALUES (?, ?, 1, CURRENT_TIMESTAMP)`
        )
        .bind(value, 1)
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
  const numericValue = Number(payload?.numericValue);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'id is required.' }, 400);
  if (!value) return json({ error: 'Value is required.' }, 400);

  try {
    if (table === 'config_fish_types') {
      if (!Number.isFinite(numericValue) || numericValue < 0) {
        return json({ error: 'Fish buy price must be a number >= 0.' }, 400);
      }
      await env.DB
        .prepare(
          `UPDATE config_fish_types
           SET name = ?, unit_price = ?, active = 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .bind(value, numericValue, id)
        .run();
    } else if (table === 'config_sell_locations') {
      await env.DB
        .prepare(
          `UPDATE config_sell_locations
           SET name = ?, active = 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
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

  if (table === 'config_fish_types' || table === 'config_sell_locations') {
    await env.DB
      .prepare(`UPDATE ${table} SET active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(id)
      .run();
  } else {
    await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  }
  return json({ ok: true });
}
