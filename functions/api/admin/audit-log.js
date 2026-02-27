import { json } from '../auth/_lib/auth.js';
import { requirePermission } from './_lib/admin-auth.js';

function normalize(value) {
  return String(value || '').trim();
}

function toCsv(rows) {
  const header = [
    'id',
    'createdAt',
    'actorRobloxUsername',
    'actorName',
    'actorDiscordId',
    'actorEmployeeId',
    'actionType',
    'targetEmployeeId',
    'summary'
  ];
  const lines = [header.join(',')];
  for (const row of rows) {
    const values = [
      row.id,
      row.createdAt,
      row.actorRobloxUsername || '',
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
    whereParts.push(`(
      LOWER(COALESCE(ev.summary, '')) LIKE ?
      OR LOWER(COALESCE(ev.actor_name, '')) LIKE ?
      OR LOWER(COALESCE(actor_by_id.roblox_username, actor_by_discord.roblox_username, '')) LIKE ?
      OR CAST(COALESCE(ev.target_employee_id, 0) AS TEXT) LIKE ?
    )`);
    whereBindings.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (actionType) {
    whereParts.push('ev.action_type = ?');
    whereBindings.push(actionType);
  }
  if (actor) {
    whereParts.push(`(
      LOWER(COALESCE(ev.actor_name, '')) LIKE ?
      OR LOWER(COALESCE(ev.actor_discord_user_id, '')) LIKE ?
      OR LOWER(COALESCE(actor_by_id.roblox_username, actor_by_discord.roblox_username, '')) LIKE ?
    )`);
    whereBindings.push(`%${actor}%`, `%${actor}%`, `%${actor}%`);
  }
  if (Number.isInteger(targetEmployeeId) && targetEmployeeId > 0) {
    whereParts.push('ev.target_employee_id = ?');
    whereBindings.push(targetEmployeeId);
  }
  if (dateFrom) {
    whereParts.push("DATE(ev.created_at) >= DATE(?)");
    whereBindings.push(dateFrom);
  }
  if (dateTo) {
    whereParts.push("DATE(ev.created_at) <= DATE(?)");
    whereBindings.push(dateTo);
  }
  const whereSql = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
  const fromSql = `
    FROM admin_activity_events ev
    LEFT JOIN employees actor_by_id ON actor_by_id.id = ev.actor_employee_id
    LEFT JOIN employees actor_by_discord ON actor_by_discord.discord_user_id = ev.actor_discord_user_id
  `;
  const dbStartedAt = Date.now();

  const baseSelectSql = `
    SELECT
      ev.id,
      ev.created_at,
      ev.actor_name,
      ev.actor_discord_user_id,
      ev.actor_employee_id,
      ev.action_type,
      ev.target_employee_id,
      ev.summary,
      ev.metadata_json,
      COALESCE(actor_by_id.roblox_username, actor_by_discord.roblox_username) AS actor_roblox_username
    ${fromSql}
    ${whereSql}
    ORDER BY ev.created_at DESC, ev.id DESC`;

  if (format === 'csv') {
    const exportRows = await env.DB.prepare(`${baseSelectSql} LIMIT 1000`).bind(...whereBindings).all();
    const normalizedRows = (exportRows?.results || []).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      actorRobloxUsername: row.actor_roblox_username || null,
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
        'content-disposition': `attachment; filename=\"audit-log-${new Date().toISOString().slice(0, 10)}.csv\"`
      }
    });
  }

  const [rows, totalRow] = await Promise.all([
    env.DB.prepare(`${baseSelectSql} LIMIT ? OFFSET ?`).bind(...whereBindings, pageSize, offset).all(),
    env.DB.prepare(`SELECT COUNT(*) AS total ${fromSql} ${whereSql}`).bind(...whereBindings).first()
  ]);

  const total = Number(totalRow?.total || 0);
  const dbMs = Date.now() - dbStartedAt;
  const totalMs = Date.now() - startedAt;
  console.log(JSON.stringify({ type: 'perf.admin.audit', page, pageSize, total, dbMs, totalMs }));

  return json({
    events: (rows?.results || []).map((row) => ({
      id: row.id,
      createdAt: row.created_at,
      actorRobloxUsername: row.actor_roblox_username || null,
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
