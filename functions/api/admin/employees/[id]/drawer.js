import { json } from '../../../auth/_lib/auth.js';
import { requirePermission } from '../../_lib/admin-auth.js';
import { hasPermission } from '../../../_lib/permissions.js';

export async function onRequestGet(context) {
  const { env, params, request } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.read']);
  if (errorResponse) return errorResponse;
  const startedAt = Date.now();

  const employeeId = Number(params.id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return json({ error: 'Invalid employee id.' }, 400);

  const url = new URL(request.url);
  const activityPageSize = Math.min(50, Math.max(5, Number(url.searchParams.get('activityPageSize')) || 15));

  const dbStartedAt = Date.now();
  const [employee, recentVoyagesRows, activityRows, notesRows, disciplinariesRows] = await Promise.all([
    env.DB
      .prepare(
        `SELECT id, discord_user_id, discord_display_name, roblox_username, roblox_user_id, rank, grade, serial_number, employee_status, activation_status, activated_at, hire_date, updated_at
         FROM employees
         WHERE id = ?`
      )
      .bind(employeeId)
      .first(),
    env.DB
      .prepare(
        `SELECT
           v.id,
           v.vessel_name,
           v.vessel_callsign,
           v.departure_port,
           v.destination_port,
           v.status,
           v.started_at,
           v.ended_at,
           ROUND(COALESCE(v.profit, 0)) AS net_profit
         FROM voyage_participants vp
         INNER JOIN voyages v ON v.id = vp.voyage_id
         WHERE vp.employee_id = ? AND v.deleted_at IS NULL
         ORDER BY COALESCE(v.ended_at, v.started_at) DESC, v.id DESC
         LIMIT 8`
      )
      .bind(employeeId)
      .all(),
    env.DB
      .prepare(
        `SELECT
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
         FROM admin_activity_events ev
         LEFT JOIN employees actor_by_id ON actor_by_id.id = ev.actor_employee_id
         LEFT JOIN employees actor_by_discord ON actor_by_discord.discord_user_id = ev.actor_discord_user_id
         WHERE ev.target_employee_id = ?
         ORDER BY ev.created_at DESC, ev.id DESC
         LIMIT ?`
      )
      .bind(employeeId, activityPageSize)
      .all(),
    env.DB
      .prepare(
        `SELECT id, note, authored_by, created_at
         FROM employee_notes
         WHERE employee_id = ?
         ORDER BY created_at DESC
         LIMIT 80`
      )
      .bind(employeeId)
      .all(),
    env.DB
      .prepare(
        `SELECT id, record_type, record_date, record_status, notes, issued_by, created_at
         FROM disciplinary_records
         WHERE employee_id = ?
         ORDER BY COALESCE(record_date, created_at) DESC, id DESC
         LIMIT 80`
      )
      .bind(employeeId)
      .all()
  ]);
  if (!employee) return json({ error: 'Employee not found.' }, 404);

  const dbMs = Date.now() - dbStartedAt;
  let activity = (activityRows?.results || []).map((row) => ({
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
  }));
  if (!activity.length) {
    const legacyRows = await env.DB
      .prepare(
        `SELECT id, created_at, authored_by, note
         FROM employee_notes
         WHERE employee_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`
      )
      .bind(employeeId, activityPageSize)
      .all();
    activity = (legacyRows?.results || []).map((row) => ({
      id: `legacy-${row.id}`,
      createdAt: row.created_at,
      actorName: row.authored_by || null,
      actorDiscordId: null,
      actorEmployeeId: null,
      actionType: 'LEGACY_NOTE',
      targetEmployeeId: employeeId,
      summary: row.note || '',
      metadata: null
    }));
  }

  console.log(
    JSON.stringify({
      type: 'perf.admin.employee_drawer',
      employeeId,
      dbMs,
      totalMs: Date.now() - startedAt
    })
  );

  return json({
    employee,
    recentVoyages: recentVoyagesRows?.results || [],
    activity,
    notes: notesRows?.results || [],
    disciplinaries: disciplinariesRows?.results || [],
    capabilities: {
      canAddNotes: hasPermission(session, 'employees.notes'),
      canAddDisciplinary: hasPermission(session, 'employees.discipline'),
      canActivate: hasPermission(session, 'employees.edit')
    },
    timing: { dbMs, totalMs: Date.now() - startedAt }
  });
}
