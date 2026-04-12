import { json } from '../auth/_lib/auth.js';
import { requirePermission } from './_lib/admin-auth.js';
import { normalizeTzOffsetMinutes, toUtcBoundaryFromLocalDateInput } from '../_lib/finances.js';

function text(value) {
  return String(value || '').trim();
}

function normalizeBooleanParam(value, fallback = false) {
  if (value === null || value === undefined || String(value).trim() === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  return ['1', 'true', 'yes', 'on'].includes(normalized);
}

function toCsv(rows) {
  const header = ['employeeId', 'robloxUsername', 'serialNumber', 'rank', 'grade', 'totalVoyages', 'oowVoyages', 'crewVoyages', 'lastVoyageAt'];
  const lines = [header.join(',')];
  for (const row of rows) {
    const values = [
      row.employeeId,
      row.robloxUsername || '',
      row.serialNumber || '',
      row.rank || '',
      row.grade || '',
      row.totalVoyages || 0,
      row.oowVoyages || 0,
      row.crewVoyages || 0,
      row.lastVoyageAt || ''
    ].map((value) => `"${String(value).replaceAll('"', '""')}"`);
    lines.push(values.join(','));
  }
  return lines.join('\n');
}

async function hasLegacyHistoryTable(env) {
  const row = await env.DB
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_voyage_history'")
    .first();
  return Boolean(row?.name);
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requirePermission(context, ['activity_tracker.view']);
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('pageSize')) || 25));
  const offset = (page - 1) * pageSize;
  const search = text(url.searchParams.get('search')).toLowerCase();
  const dateFrom = text(url.searchParams.get('dateFrom'));
  const dateTo = text(url.searchParams.get('dateTo'));
  const tzOffsetMinutes = normalizeTzOffsetMinutes(url.searchParams.get('tzOffsetMinutes'));
  const dateFromUtc = toUtcBoundaryFromLocalDateInput(dateFrom, false, tzOffsetMinutes);
  const dateToUtc = toUtcBoundaryFromLocalDateInput(dateTo, true, tzOffsetMinutes);
  const minVoyages = Math.max(0, Number(url.searchParams.get('minVoyages')) || 0);
  const quotaTarget = Math.max(1, Number(url.searchParams.get('quotaTarget')) || Math.max(1, minVoyages || 4));
  const quotaFilter = text(url.searchParams.get('quotaFilter')).toLowerCase();
  const activeOnly = normalizeBooleanParam(url.searchParams.get('activeOnly'), true);
  const format = text(url.searchParams.get('format')).toLowerCase();
  const hasLegacyHistory = await hasLegacyHistoryTable(env);
  const totalVoyagesExpr = hasLegacyHistory
    ? '(COALESCE(stats.total_voyages, 0) + COALESCE(legacy_stats.total_voyages, 0))'
    : 'COALESCE(stats.total_voyages, 0)';

  const statsWhere = [`v.status = 'ENDED'`, `v.deleted_at IS NULL`];
  const statsBinds = [];
  if (dateFromUtc) {
    statsWhere.push('v.ended_at >= ?');
    statsBinds.push(dateFromUtc);
  }
  if (dateToUtc) {
    statsWhere.push('v.ended_at <= ?');
    statsBinds.push(dateToUtc);
  }

  const where = [];
  const binds = [];
  if (search) {
    where.push(`(
      LOWER(COALESCE(e.roblox_username, '')) LIKE ?
      OR LOWER(COALESCE(e.roblox_user_id, '')) LIKE ?
      OR LOWER(COALESCE(e.serial_number, '')) LIKE ?
    )`);
    binds.push(`%${search}%`, `%${search}%`, `%${search}%`);
  }
  if (minVoyages > 0) {
    where.push(`${totalVoyagesExpr} >= ?`);
    binds.push(minVoyages);
  }
  if (activeOnly) {
    where.push(`UPPER(COALESCE(e.employee_status, 'ACTIVE')) NOT IN ('SUSPENDED', 'DEACTIVATED', 'REMOVED', 'LEFT', 'TERMINATED')`);
    where.push(`UPPER(COALESCE(e.activation_status, 'ACTIVE')) NOT IN ('DISABLED', 'REJECTED')`);
  }
  if (quotaFilter === 'met') {
    where.push(`${totalVoyagesExpr} >= ?`);
    binds.push(quotaTarget);
  } else if (quotaFilter === 'not_met') {
    where.push(`${totalVoyagesExpr} < ?`);
    binds.push(quotaTarget);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const statsWhereSql = statsWhere.join(' AND ');

  const legacyCteSql = hasLegacyHistory
    ? `,
    legacy_base AS (
      SELECT voyage_id, skipper_username, crew_usernames, record_date
      FROM legacy_voyage_history
      WHERE status = 'COMPLETED'
      ${dateFrom ? 'AND date(record_date) >= date(?)' : ''}
      ${dateTo ? 'AND date(record_date) <= date(?)' : ''}
    ),
    legacy_split AS (
      WITH RECURSIVE split(voyage_id, rest, username_part) AS (
        SELECT
          voyage_id,
          CASE
            WHEN TRIM(COALESCE(crew_usernames, '')) = '' THEN ''
            ELSE REPLACE(TRIM(COALESCE(crew_usernames, '')), '|', ' | ') || ' | '
          END AS rest,
          '' AS username_part
        FROM legacy_base
        UNION ALL
        SELECT
          voyage_id,
          substr(rest, instr(rest, ' | ') + 3),
          trim(substr(rest, 1, instr(rest, ' | ') - 1))
        FROM split
        WHERE rest <> '' AND instr(rest, ' | ') > 0
      )
      SELECT voyage_id, LOWER(TRIM(username_part)) AS username_key
      FROM split
      WHERE TRIM(COALESCE(username_part, '')) <> ''
    ),
    legacy_participants AS (
      SELECT
        voyage_id,
        LOWER(TRIM(skipper_username)) AS username_key,
        'OOW' AS role,
        record_date AS legacy_voyage_at
      FROM legacy_base
      WHERE status = 'COMPLETED' AND TRIM(COALESCE(skipper_username, '')) <> ''
      UNION ALL
      SELECT
        l.voyage_id,
        ls.username_key,
        'CREW' AS role,
        l.record_date AS legacy_voyage_at
      FROM legacy_base l
      INNER JOIN legacy_split ls ON ls.voyage_id = l.voyage_id
      WHERE TRIM(COALESCE(ls.username_key, '')) <> ''
    ),
    legacy_unique AS (
      SELECT
        username_key,
        voyage_id,
        MAX(CASE WHEN role = 'OOW' THEN 1 ELSE 0 END) AS has_oow,
        MAX(CASE WHEN role = 'CREW' THEN 1 ELSE 0 END) AS has_crew,
        MAX(legacy_voyage_at) AS last_voyage_at
      FROM legacy_participants
      WHERE username_key <> ''
      GROUP BY username_key, voyage_id
    ),
    legacy_stats AS (
      SELECT
        username_key,
        COUNT(*) AS total_voyages,
        SUM(has_oow) AS oow_voyages,
        SUM(CASE WHEN has_oow = 1 THEN 0 ELSE has_crew END) AS crew_voyages,
        MAX(last_voyage_at) AS last_voyage_at
      FROM legacy_unique
      GROUP BY username_key
    )`
    : '';

  const legacyDateBinds = hasLegacyHistory
    ? [
        ...(dateFrom ? [dateFrom] : []),
        ...(dateTo ? [dateTo] : [])
      ]
    : [];

  const baseBinds = [...statsBinds, ...legacyDateBinds];
  const bindsWithFilters = [...baseBinds, ...binds];

  const baseSql = `
    WITH stats AS (
      SELECT
        vp.employee_id,
        COUNT(DISTINCT vp.voyage_id) AS total_voyages,
        SUM(CASE WHEN vp.role_in_voyage = 'OOW' THEN 1 ELSE 0 END) AS oow_voyages,
        SUM(CASE WHEN vp.role_in_voyage = 'CREW' THEN 1 ELSE 0 END) AS crew_voyages,
        MAX(v.ended_at) AS last_voyage_at
      FROM voyage_participants vp
      INNER JOIN voyages v ON v.id = vp.voyage_id
      WHERE ${statsWhereSql}
      GROUP BY vp.employee_id
    )
    ${legacyCteSql}
    SELECT
      e.id AS employee_id,
      e.roblox_username,
      e.serial_number,
      e.rank,
      e.grade,
      e.employee_status,
      e.activation_status,
      ${hasLegacyHistory ? '(COALESCE(stats.total_voyages, 0) + COALESCE(legacy_stats.total_voyages, 0))' : 'COALESCE(stats.total_voyages, 0)'} AS total_voyages,
      ${hasLegacyHistory ? '(COALESCE(stats.oow_voyages, 0) + COALESCE(legacy_stats.oow_voyages, 0))' : 'COALESCE(stats.oow_voyages, 0)'} AS oow_voyages,
      ${hasLegacyHistory ? '(COALESCE(stats.crew_voyages, 0) + COALESCE(legacy_stats.crew_voyages, 0))' : 'COALESCE(stats.crew_voyages, 0)'} AS crew_voyages,
      ${hasLegacyHistory
        ? `CASE
             WHEN COALESCE(stats.last_voyage_at, '') = '' THEN legacy_stats.last_voyage_at
             WHEN COALESCE(legacy_stats.last_voyage_at, '') = '' THEN stats.last_voyage_at
             WHEN datetime(stats.last_voyage_at) >= datetime(legacy_stats.last_voyage_at) THEN stats.last_voyage_at
             ELSE legacy_stats.last_voyage_at
           END`
        : 'stats.last_voyage_at'} AS last_voyage_at
    FROM employees e
    LEFT JOIN stats ON stats.employee_id = e.id
    ${hasLegacyHistory ? "LEFT JOIN legacy_stats ON legacy_stats.username_key = LOWER(TRIM(COALESCE(e.roblox_username, '')))" : ''}
    ${whereSql}`;
  const rankedBaseSql = `SELECT * FROM (${baseSql}) tracker`;

  if (format === 'csv') {
    const exportRows = await env.DB
      .prepare(`${rankedBaseSql} ORDER BY tracker.total_voyages ASC, tracker.last_voyage_at ASC, tracker.roblox_username ASC, tracker.employee_id ASC LIMIT 2000`)
      .bind(...bindsWithFilters)
      .all();
    const rows = (exportRows?.results || []).map((row) => ({
      employeeId: Number(row.employee_id || 0),
      robloxUsername: row.roblox_username || null,
      serialNumber: row.serial_number || null,
      rank: row.rank || null,
      grade: row.grade || null,
      employeeStatus: row.employee_status || null,
      activationStatus: row.activation_status || null,
      totalVoyages: Number(row.total_voyages || 0),
      oowVoyages: Number(row.oow_voyages || 0),
      crewVoyages: Number(row.crew_voyages || 0),
      lastVoyageAt: row.last_voyage_at || null
    }));
    return new Response(toCsv(rows), {
      status: 200,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'cache-control': 'no-store',
        'content-disposition': `attachment; filename=\"activity-tracker-${new Date().toISOString().slice(0, 10)}.csv\"`
      }
    });
  }

  const [rowsResult, totalResult, summaryResult] = await Promise.all([
    env.DB
      .prepare(`${rankedBaseSql} ORDER BY CASE WHEN tracker.total_voyages < ? THEN 0 ELSE 1 END ASC, (? - tracker.total_voyages) DESC, CASE WHEN tracker.last_voyage_at IS NULL THEN 1 ELSE 0 END DESC, tracker.last_voyage_at ASC, tracker.roblox_username ASC, tracker.employee_id ASC LIMIT ? OFFSET ?`)
      .bind(...bindsWithFilters, quotaTarget, quotaTarget, pageSize, offset)
      .all(),
    env.DB
      .prepare(`SELECT COUNT(*) AS total FROM (${baseSql})`)
      .bind(...bindsWithFilters)
      .first(),
    env.DB
      .prepare(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN total_voyages >= ? THEN 1 ELSE 0 END) AS on_track,
           SUM(CASE WHEN total_voyages < ? THEN 1 ELSE 0 END) AS at_risk,
           SUM(CASE WHEN total_voyages = 0 THEN 1 ELSE 0 END) AS no_voyages,
           SUM(CASE WHEN last_voyage_at IS NOT NULL AND julianday('now') - julianday(last_voyage_at) >= 14 THEN 1 ELSE 0 END) AS inactive_14_plus
         FROM (${baseSql})`
      )
      .bind(quotaTarget, quotaTarget, ...bindsWithFilters)
      .first()
  ]);

  const total = Number(totalResult?.total || 0);
  const allRows = (rowsResult?.results || []).map((row) => {
    const totalVoyagesValue = Number(row.total_voyages || 0);
    const meetsQuota = totalVoyagesValue >= quotaTarget;
    const shortfall = Math.max(0, quotaTarget - totalVoyagesValue);
    const lastVoyageAt = row.last_voyage_at || null;
    const daysSinceLastVoyage = lastVoyageAt
      ? Math.max(0, Math.floor((Date.now() - Date.parse(lastVoyageAt)) / 86400000))
      : null;
    return {
      employeeId: Number(row.employee_id || 0),
      robloxUsername: row.roblox_username || null,
      serialNumber: row.serial_number || null,
      rank: row.rank || null,
      grade: row.grade || null,
      employeeStatus: row.employee_status || null,
      activationStatus: row.activation_status || null,
      totalVoyages: totalVoyagesValue,
      oowVoyages: Number(row.oow_voyages || 0),
      crewVoyages: Number(row.crew_voyages || 0),
      lastVoyageAt,
      daysSinceLastVoyage,
      quotaTarget,
      shortfall,
      meetsQuota
    };
  });
  const rows = allRows;

  return json({
    rows,
    summary: {
      total: Number(summaryResult?.total || 0),
      atRisk: Number(summaryResult?.at_risk || 0),
      belowQuota: Math.max(0, Number(summaryResult?.at_risk || 0) - Number(summaryResult?.no_voyages || 0)),
      onTrack: Number(summaryResult?.on_track || 0),
      noVoyages: Number(summaryResult?.no_voyages || 0),
      inactive14Plus: Number(summaryResult?.inactive_14_plus || 0),
      quotaTarget,
      activeOnly,
      dateFrom: dateFrom || null,
      dateTo: dateTo || null
    },
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize))
    }
  });
}
