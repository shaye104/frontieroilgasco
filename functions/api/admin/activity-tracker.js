import { json } from '../auth/_lib/auth.js';
import { requirePermission } from './_lib/admin-auth.js';

function normalize(value) {
  return String(value || '').trim();
}

function toCsv(rows) {
  const header = ['id', 'createdAt', 'actorName', 'actorDiscordId', 'actorEmployeeId', 'actionType', 'targetEmployeeId', 'summary'];
  const lines = [header.join(',')];
  for (const row of rows) {
    const values = [
      row.id,
      row.createdAt,
      row.actorName || '',
      row.actorDiscordId || '',
      row.actorEmployeeId || '',
      row.actionType || '',
      row.targetEmployeeId || '',
      row.summary || ''
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`);
    lines.push(values.join(','));
  }
  return lines.join('\n');
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requirePermission(context, ['activity_tracker.view']);
  if (errorResponse) return errorResponse;
  const startedAt = Date.now();

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(5, Number(url.searchParams.get('pageSize')) || 25));
  const offset = (page - 1) * pageSize;
  const search = normalize(url.searchParams.get('search')).toLowerCase();
  const actionType = normalize(url.searchParams.get('actionType'));
  const actor = normalize(url.searchParams.get('actor')).toLowerCase();
  const targetEmployeeId = Number(url.searchParams.get('targetEmployeeId'));
  const dateFrom = normalize(url.searchParams.get('dateFrom'));
  const dateTo = normalize(url.searchParams.get('dateTo'));
  const format = normalize(url.searchParams.get('format')).toLowerCase();

  const whereParts = [];
  const whereBindings = [];
  if (search) {
    whereParts.push('(LOWER(COALESCE(summary, \'\')) LIKE ? OR LOWER(COALESCE(actor_name, \'\')) LIKE ? OR CAST(COALESCE(target_employee_id, 0) AS TEXT) LIKE ?)');
    whereBindings.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (actionType) {
    whereParts.push('action_type = ?');
    whereBindings.push(actionType);
  }
  if (actor) {
    whereParts.push('(LOWER(COALESCE(actor_name, \'\')) LIKE ? OR LOWER(COALESCE(actor_discord_user_id, \'\')) LIKE ?)');
    whereBindings.push(`%${actor}%`, `%${actor}%`);
  }
  if (Number.isInteger(targetEmployeeId) && targetEmployeeId > 0) {
    whereParts.push('target_employee_id = ?');
    whereBindings.push(targetEmployeeId);
  }
  if (dateFrom) {
    whereParts.push("DATE(created_at) >= DATE(?)");
    whereBindings.push(dateFrom);
  }
  if (dateTo) {
    whereParts.push("DATE(created_at) <= DATE(?)");
    whereBindings.push(dateTo);
  }
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const dbStartedAt = Date.now();

  const baseSelectSql = `
    SELECT
      id,
      created_at,
      actor_name,
      actor_discord_user_id,
      actor_employee_id,
      action_type,
      target_employee_id,
      summary,
      metadata_json
    FROM admin_activity_events
    ${whereSql}
    ORDER BY created_at DESC, id DESC`;

  if (format === 'csv') {
    const exportRows = await env.DB.prepare(`${baseSelectSql} LIMIT 1000`).bind(...whereBindings).all();
    const normalizedRows = (exportRows?.results || []).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      actorName: row.actor_name || null,
      actorDiscordId: row.actor_discord_user_id || null,
      actorEmployeeId: row.actor_employee_id || null,
      actionType: row.action_type,
      targetEmployeeId: row.target_employee_id || null,
      summary: row.summary || ''
    }));
    return new Response(toCsv(normalizedRows), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'cache-control': 'no-store',
        'content-disposition': `attachment; filename="activity-log-${new Date().toISOString().slice(0, 10)}.csv"`
      }
    });
  }

  const [rows, totalRow] = await Promise.all([
    env.DB.prepare(`${baseSelectSql} LIMIT ? OFFSET ?`).bind(...whereBindings, pageSize, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total FROM admin_activity_events ${whereSql}`).bind(...whereBindings).first()
  ]);

  const total = Number(totalRow?.total || 0);
  const dbMs = Date.now() - dbStartedAt;
  const totalMs = Date.now() - startedAt;
  console.log(JSON.stringify({ type: 'perf.admin.activity', page, pageSize, total, dbMs, totalMs }));

  return json({
    events: (rows?.results || []).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      actorName: row.actor_name || null,
      actorDiscordId: row.actor_discord_user_id || null,
      actorEmployeeId: row.actor_employee_id || null,
      actionType: row.action_type,
      targetEmployeeId: row.target_employee_id || null,
      summary: row.summary || '',
      metadata: (() => {
        try {
          return row.metadata_json ? JSON.parse(row.metadata_json) : null;
        } catch {
          return null;
        }
      })()
    })),
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    },
    timing: { dbMs, totalMs }
  });
}
