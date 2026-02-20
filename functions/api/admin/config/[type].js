import { json } from '../../auth/_lib/auth.js';
import { requirePermission } from '../_lib/admin-auth.js';

const tableMap = {
  statuses: 'config_employee_statuses',
  disciplinary_types: 'config_disciplinary_types',
  ranks: 'config_ranks',
  grades: 'config_grades'
};

function getTable(type) {
  return tableMap[String(type || '').trim()] || null;
}

function isRanksType(type) {
  return String(type || '').trim() === 'ranks';
}

function rankOrderSql() {
  return 'ORDER BY level DESC, value ASC, id ASC';
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const { errorResponse } = await requirePermission(context, ['config.manage']);
  if (errorResponse) return errorResponse;

  const table = getTable(params.type);
  if (!table) return json({ error: 'Invalid config type.' }, 400);

  const result = await env.DB
    .prepare(`SELECT id, value, ${isRanksType(params.type) ? 'level, description, updated_at,' : ''} created_at FROM ${table} ${
      isRanksType(params.type) ? rankOrderSql() : 'ORDER BY value ASC'
    }`)
    .all();
  return json({ items: result?.results || [] });
}

export async function onRequestPost(context) {
  const { env, params } = context;
  const { errorResponse } = await requirePermission(context, ['config.manage']);
  if (errorResponse) return errorResponse;

  const table = getTable(params.type);
  if (!table) return json({ error: 'Invalid config type.' }, 400);

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const value = String(payload?.value || '').trim();
  if (!value) return json({ error: 'value is required.' }, 400);
  if (isRanksType(params.type)) {
    const level = Number(payload?.level);
    const description = String(payload?.description || '').trim();
    await env.DB
      .prepare(`INSERT OR IGNORE INTO ${table} (value, level, description, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`)
      .bind(value, Number.isFinite(level) ? Math.floor(level) : 0, description)
      .run();
  } else {
    await env.DB.prepare(`INSERT OR IGNORE INTO ${table} (value) VALUES (?)`).bind(value).run();
  }
  const result = await env.DB
    .prepare(`SELECT id, value, ${isRanksType(params.type) ? 'level, description, updated_at,' : ''} created_at FROM ${table} ${
      isRanksType(params.type) ? rankOrderSql() : 'ORDER BY value ASC'
    }`)
    .all();
  return json({ items: result?.results || [] }, 201);
}

export async function onRequestPut(context) {
  const { env, params } = context;
  const { errorResponse } = await requirePermission(context, ['config.manage']);
  if (errorResponse) return errorResponse;

  const table = getTable(params.type);
  if (!table) return json({ error: 'Invalid config type.' }, 400);

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const id = Number(payload?.id);
  const value = String(payload?.value || '').trim();
  if (!Number.isInteger(id) || id <= 0 || !value) return json({ error: 'id and value are required.' }, 400);
  if (isRanksType(params.type)) {
    const level = Number(payload?.level);
    const description = String(payload?.description || '').trim();
    await env.DB
      .prepare(`UPDATE ${table} SET value = ?, level = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(value, Number.isFinite(level) ? Math.floor(level) : 0, description, id)
      .run();
  } else {
    await env.DB.prepare(`UPDATE ${table} SET value = ? WHERE id = ?`).bind(value, id).run();
  }
  const result = await env.DB
    .prepare(`SELECT id, value, ${isRanksType(params.type) ? 'level, description, updated_at,' : ''} created_at FROM ${table} ${
      isRanksType(params.type) ? rankOrderSql() : 'ORDER BY value ASC'
    }`)
    .all();
  return json({ items: result?.results || [] });
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  const { errorResponse } = await requirePermission(context, ['config.manage']);
  if (errorResponse) return errorResponse;

  const table = getTable(params.type);
  if (!table) return json({ error: 'Invalid config type.' }, 400);

  const url = new URL(context.request.url);
  const id = Number(url.searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'id is required.' }, 400);

  await env.DB.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id).run();
  const result = await env.DB
    .prepare(`SELECT id, value, ${isRanksType(params.type) ? 'level, description, updated_at,' : ''} created_at FROM ${table} ${
      isRanksType(params.type) ? rankOrderSql() : 'ORDER BY value ASC'
    }`)
    .all();
  return json({ items: result?.results || [] });
}
