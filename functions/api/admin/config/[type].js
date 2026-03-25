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

function isDisciplinaryTypes(type) {
  return String(type || '').trim() === 'disciplinary_types';
}

function isStatusesType(type) {
  return String(type || '').trim() === 'statuses';
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

  let query = `SELECT id, value, created_at FROM ${table} ORDER BY value ASC`;
  if (isRanksType(params.type)) {
    query = `SELECT id, value, level, description, updated_at, created_at FROM ${table} ${rankOrderSql()}`;
  } else if (isStatusesType(params.type)) {
    query = `SELECT id, value, restrict_intranet, exclude_from_stats, created_at FROM ${table} ORDER BY value ASC, id ASC`;
  } else if (isDisciplinaryTypes(params.type)) {
    query = `SELECT id, key, label, value, severity, is_active, default_status, requires_end_date, default_duration_days,
                    apply_suspension_rank, set_employee_status, restrict_intranet, restrict_voyages, restrict_finance, updated_at, created_at
             FROM ${table}
             ORDER BY severity DESC, label ASC, id ASC`;
  }
  const result = await env.DB.prepare(query).all();
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
  if (!value && !isDisciplinaryTypes(params.type)) return json({ error: 'value is required.' }, 400);
  if (isRanksType(params.type)) {
    const level = Number(payload?.level);
    const description = String(payload?.description || '').trim();
    await env.DB
      .prepare(`INSERT OR IGNORE INTO ${table} (value, level, description, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`)
      .bind(value, Number.isFinite(level) ? Math.floor(level) : 0, description)
      .run();
  } else if (isStatusesType(params.type)) {
    const restrictIntranet = Number(payload?.restrict_intranet ?? payload?.restrictIntranet ?? 0) ? 1 : 0;
    const excludeFromStats = Number(payload?.exclude_from_stats ?? payload?.excludeFromStats ?? 0) ? 1 : 0;
    await env.DB.prepare(`INSERT OR IGNORE INTO ${table} (value, restrict_intranet, exclude_from_stats) VALUES (?, ?, ?)`).bind(value, restrictIntranet, excludeFromStats).run();
  } else if (isDisciplinaryTypes(params.type)) {
    const key = String(payload?.key || value).trim();
    const label = String(payload?.label || value).trim();
    const severity = Number(payload?.severity);
    const isActive = Number(payload?.is_active ?? payload?.isActive ?? 1) ? 1 : 0;
    const defaultStatus = String(payload?.default_status || payload?.defaultStatus || 'ACTIVE').trim().toUpperCase() || 'ACTIVE';
    const requiresEndDate = Number(payload?.requires_end_date ?? payload?.requiresEndDate ?? 0) ? 1 : 0;
    const defaultDurationDaysRaw = Number(payload?.default_duration_days ?? payload?.defaultDurationDays);
    const defaultDurationDays = Number.isFinite(defaultDurationDaysRaw) && defaultDurationDaysRaw > 0 ? Math.floor(defaultDurationDaysRaw) : null;
    const applySuspensionRank = Number(payload?.apply_suspension_rank ?? payload?.applySuspensionRank ?? 0) ? 1 : 0;
    const setEmployeeStatus = String(payload?.set_employee_status || payload?.setEmployeeStatus || '').trim() || null;
    const restrictIntranet = Number(payload?.restrict_intranet ?? payload?.restrictIntranet ?? 0) ? 1 : 0;
    const restrictVoyages = Number(payload?.restrict_voyages ?? payload?.restrictVoyages ?? 0) ? 1 : 0;
    const restrictFinance = Number(payload?.restrict_finance ?? payload?.restrictFinance ?? 0) ? 1 : 0;
    if (!key || !label) return json({ error: 'key and label are required.' }, 400);
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO ${table}
          (key, label, value, severity, is_active, default_status, requires_end_date, default_duration_days, apply_suspension_rank,
           set_employee_status, restrict_intranet, restrict_voyages, restrict_finance, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(
        key.toUpperCase(),
        label,
        value || label,
        Number.isFinite(severity) ? Math.floor(severity) : 1,
        isActive,
        defaultStatus,
        requiresEndDate,
        defaultDurationDays,
        applySuspensionRank,
        setEmployeeStatus,
        restrictIntranet,
        restrictVoyages,
        restrictFinance
      )
      .run();
  } else {
    await env.DB.prepare(`INSERT OR IGNORE INTO ${table} (value) VALUES (?)`).bind(value).run();
  }
  let query = `SELECT id, value, created_at FROM ${table} ORDER BY value ASC`;
  if (isRanksType(params.type)) {
    query = `SELECT id, value, level, description, updated_at, created_at FROM ${table} ${rankOrderSql()}`;
  } else if (isStatusesType(params.type)) {
    query = `SELECT id, value, restrict_intranet, exclude_from_stats, created_at FROM ${table} ORDER BY value ASC, id ASC`;
  } else if (isDisciplinaryTypes(params.type)) {
    query = `SELECT id, key, label, value, severity, is_active, default_status, requires_end_date, default_duration_days,
                    apply_suspension_rank, set_employee_status, restrict_intranet, restrict_voyages, restrict_finance, updated_at, created_at
             FROM ${table}
             ORDER BY severity DESC, label ASC, id ASC`;
  }
  const result = await env.DB.prepare(query).all();
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
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'id is required.' }, 400);
  if (!value && !isDisciplinaryTypes(params.type)) return json({ error: 'value is required.' }, 400);
  if (isRanksType(params.type)) {
    const level = Number(payload?.level);
    const description = String(payload?.description || '').trim();
    await env.DB
      .prepare(`UPDATE ${table} SET value = ?, level = ?, description = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .bind(value, Number.isFinite(level) ? Math.floor(level) : 0, description, id)
      .run();
  } else if (isStatusesType(params.type)) {
    const restrictIntranet = Number(payload?.restrict_intranet ?? payload?.restrictIntranet ?? 0) ? 1 : 0;
    const excludeFromStats = Number(payload?.exclude_from_stats ?? payload?.excludeFromStats ?? 0) ? 1 : 0;
    await env.DB.prepare(`UPDATE ${table} SET value = ?, restrict_intranet = ?, exclude_from_stats = ? WHERE id = ?`).bind(value, restrictIntranet, excludeFromStats, id).run();
  } else if (isDisciplinaryTypes(params.type)) {
    const key = String(payload?.key || value).trim();
    const label = String(payload?.label || value).trim();
    const severity = Number(payload?.severity);
    const isActive = Number(payload?.is_active ?? payload?.isActive ?? 1) ? 1 : 0;
    const defaultStatus = String(payload?.default_status || payload?.defaultStatus || 'ACTIVE').trim().toUpperCase() || 'ACTIVE';
    const requiresEndDate = Number(payload?.requires_end_date ?? payload?.requiresEndDate ?? 0) ? 1 : 0;
    const defaultDurationDaysRaw = Number(payload?.default_duration_days ?? payload?.defaultDurationDays);
    const defaultDurationDays = Number.isFinite(defaultDurationDaysRaw) && defaultDurationDaysRaw > 0 ? Math.floor(defaultDurationDaysRaw) : null;
    const applySuspensionRank = Number(payload?.apply_suspension_rank ?? payload?.applySuspensionRank ?? 0) ? 1 : 0;
    const setEmployeeStatus = String(payload?.set_employee_status || payload?.setEmployeeStatus || '').trim() || null;
    const restrictIntranet = Number(payload?.restrict_intranet ?? payload?.restrictIntranet ?? 0) ? 1 : 0;
    const restrictVoyages = Number(payload?.restrict_voyages ?? payload?.restrictVoyages ?? 0) ? 1 : 0;
    const restrictFinance = Number(payload?.restrict_finance ?? payload?.restrictFinance ?? 0) ? 1 : 0;
    if (!key || !label) return json({ error: 'key and label are required.' }, 400);
    await env.DB
      .prepare(
        `UPDATE ${table}
         SET key = ?, label = ?, value = ?, severity = ?, is_active = ?, default_status = ?,
             requires_end_date = ?, default_duration_days = ?, apply_suspension_rank = ?, set_employee_status = ?,
             restrict_intranet = ?, restrict_voyages = ?, restrict_finance = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(
        key.toUpperCase(),
        label,
        value || label,
        Number.isFinite(severity) ? Math.floor(severity) : 1,
        isActive,
        defaultStatus,
        requiresEndDate,
        defaultDurationDays,
        applySuspensionRank,
        setEmployeeStatus,
        restrictIntranet,
        restrictVoyages,
        restrictFinance,
        id
      )
      .run();
  } else {
    await env.DB.prepare(`UPDATE ${table} SET value = ? WHERE id = ?`).bind(value, id).run();
  }
  let query = `SELECT id, value, created_at FROM ${table} ORDER BY value ASC`;
  if (isRanksType(params.type)) {
    query = `SELECT id, value, level, description, updated_at, created_at FROM ${table} ${rankOrderSql()}`;
  } else if (isStatusesType(params.type)) {
    query = `SELECT id, value, restrict_intranet, exclude_from_stats, created_at FROM ${table} ORDER BY value ASC, id ASC`;
  } else if (isDisciplinaryTypes(params.type)) {
    query = `SELECT id, key, label, value, severity, is_active, default_status, requires_end_date, default_duration_days,
                    apply_suspension_rank, set_employee_status, restrict_intranet, restrict_voyages, restrict_finance, updated_at, created_at
             FROM ${table}
             ORDER BY severity DESC, label ASC, id ASC`;
  }
  const result = await env.DB.prepare(query).all();
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
  let query = `SELECT id, value, created_at FROM ${table} ORDER BY value ASC`;
  if (isRanksType(params.type)) {
    query = `SELECT id, value, level, description, updated_at, created_at FROM ${table} ${rankOrderSql()}`;
  } else if (isStatusesType(params.type)) {
    query = `SELECT id, value, restrict_intranet, exclude_from_stats, created_at FROM ${table} ORDER BY value ASC, id ASC`;
  } else if (isDisciplinaryTypes(params.type)) {
    query = `SELECT id, key, label, value, severity, is_active, default_status, requires_end_date, default_duration_days,
                    apply_suspension_rank, set_employee_status, restrict_intranet, restrict_voyages, restrict_finance, updated_at, created_at
             FROM ${table}
             ORDER BY severity DESC, label ASC, id ASC`;
  }
  const result = await env.DB.prepare(query).all();
  return json({ items: result?.results || [] });
}
