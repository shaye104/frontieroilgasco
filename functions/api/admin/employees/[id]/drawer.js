import { json } from '../../../auth/_lib/auth.js';
import { requirePermission } from '../../_lib/admin-auth.js';
import { hasPermission } from '../../../_lib/permissions.js';
import { canManageRoleRowByHierarchy, canViewEmployeeByHierarchy, getActorAccessScope, hasHierarchyBypass } from '../../_lib/access-scope.js';
import { canEditEmployeeByRank } from '../../../_lib/db.js';
import { expireDisciplinaryRecordsForEmployee, listDisciplinaryRecordsForEmployee, reconcileEmployeeSuspensionState } from '../../../_lib/disciplinary.js';

async function ensureSellLocationLinkedPortColumn(env) {
  const columns = await env.DB.prepare(`PRAGMA table_info(config_sell_locations)`).all();
  const names = new Set((columns?.results || []).map((row) => String(row.name || '').toLowerCase()));
  if (!names.has('linked_port')) {
    await env.DB.prepare(`ALTER TABLE config_sell_locations ADD COLUMN linked_port TEXT`).run();
  }
}

export async function onRequestGet(context) {
  const { env, params, request } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.read']);
  if (errorResponse) return errorResponse;
  await ensureSellLocationLinkedPortColumn(env);
  const startedAt = Date.now();

  const employeeId = Number(params.id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return json({ error: 'Invalid employee id.' }, 400);

  const url = new URL(request.url);
  const activityPageSize = Math.min(50, Math.max(5, Number(url.searchParams.get('activityPageSize')) || 15));

  const dbStartedAt = Date.now();
    const [employee, recentVoyagesRows, activityRows, notesRows, disciplinaryTypesRows, activeAssignmentRow, assignmentHistoryRows, shipsRows] = await Promise.all([
    env.DB
      .prepare(
        `SELECT id, discord_user_id, discord_display_name, roblox_username, roblox_user_id, rank, grade, serial_number, employee_status, activation_status, activated_at, hire_date, updated_at,
                suspension_rank_before, suspension_active_record_id, suspension_started_at, suspension_ends_at
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
           v.vessel_class,
           v.vessel_callsign,
           v.departure_port,
           COALESCE(NULLIF(TRIM(csl.linked_port), ''), NULLIF(TRIM(v.destination_port), ''), NULLIF(TRIM(v.sell_location_name), ''), NULLIF(TRIM(v.departure_port), '')) AS destination_port,
           v.status,
           v.started_at,
           v.ended_at,
           ROUND(COALESCE(v.profit, 0)) AS net_profit
         FROM voyage_participants vp
         INNER JOIN voyages v ON v.id = vp.voyage_id
         LEFT JOIN config_sell_locations csl ON csl.id = v.sell_location_id
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
        `SELECT id, key, label, value, severity, is_active, default_status, requires_end_date, default_duration_days,
                apply_suspension_rank, set_employee_status, restrict_intranet, restrict_voyages, restrict_finance
         FROM config_disciplinary_types
         WHERE COALESCE(is_active, 1) = 1
         ORDER BY severity DESC, label ASC, id ASC`
      )
      .all(),
    env.DB
      .prepare(
        `SELECT id, employee_id, ship_id, vessel_name, vessel_class, vessel_callsign, assigned_at, ended_at, assigned_by_employee_id, note
         FROM employee_vessel_assignments
         WHERE employee_id = ? AND ended_at IS NULL
         ORDER BY datetime(assigned_at) DESC, id DESC
         LIMIT 1`
      )
      .bind(employeeId)
      .first(),
    env.DB
      .prepare(
        `SELECT eva.id, eva.employee_id, eva.ship_id, eva.vessel_name, eva.vessel_class, eva.vessel_callsign, eva.assigned_at, eva.ended_at, eva.assigned_by_employee_id, eva.note,
                actor.roblox_username AS assigned_by_name
         FROM employee_vessel_assignments eva
         LEFT JOIN employees actor ON actor.id = eva.assigned_by_employee_id
         WHERE eva.employee_id = ?
         ORDER BY datetime(eva.assigned_at) DESC, eva.id DESC
         LIMIT 8`
      )
      .bind(employeeId)
      .all(),
    env.DB
      .prepare(
        `SELECT id, ship_name, vessel_class, is_active
         FROM shipyard_ships
         WHERE is_active = 1
         ORDER BY LOWER(ship_name) ASC, id ASC`
      )
      .all()
  ]);
  if (!employee) return json({ error: 'Employee not found.' }, 404);
  await expireDisciplinaryRecordsForEmployee(env, employeeId);
  const suspensionState = await reconcileEmployeeSuspensionState(env, employeeId);
  const employeeRow = suspensionState?.employee || employee;
  const disciplinariesRows = await listDisciplinaryRecordsForEmployee(env, employeeId);

  const scope = await getActorAccessScope(env, session);
  const canViewByHierarchy = await canViewEmployeeByHierarchy(env, scope, employeeRow, { allowSelf: true, allowEqual: false });
  if (!canViewByHierarchy) return json({ error: 'You can only view profiles beneath your hierarchy.' }, 403);
  const canEditByHierarchy = hasHierarchyBypass(env, session)
    ? true
    : scope.actorEmployee
    ? await canEditEmployeeByRank(env, scope.actorEmployee, employeeRow, { allowSelf: false, allowEqual: false })
    : false;
  const [assignedRolesRows, availableRolesRows] = await Promise.all([
    env.DB
      .prepare(
        `SELECT ar.id, ar.name, ar.description, ar.sort_order
         FROM employee_role_assignments era
         INNER JOIN app_roles ar ON ar.id = era.role_id
         WHERE era.employee_id = ?
           AND COALESCE(ar.role_key, '') NOT IN ('owner', 'employee')
         ORDER BY ar.sort_order ASC, ar.id ASC`
      )
      .bind(employeeId)
      .all(),
    env.DB
      .prepare(
        `SELECT id, name, description, sort_order, is_system
         FROM app_roles
         WHERE COALESCE(role_key, '') NOT IN ('owner', 'employee')
         ORDER BY sort_order ASC, id ASC`
      )
      .all()
  ]);
  const availableRoleRows = hasHierarchyBypass(env, session)
    ? availableRolesRows?.results || []
    : (availableRolesRows?.results || []).filter((row) => canManageRoleRowByHierarchy(scope, row));

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
    employee: employeeRow,
    recentVoyages: recentVoyagesRows?.results || [],
    activity,
    notes: notesRows?.results || [],
    disciplinaries: disciplinariesRows || [],
    disciplinaryTypes: disciplinaryTypesRows?.results || [],
    suspensionState: {
      isSuspended: Boolean(suspensionState?.suspended),
      suspendedUntil: suspensionState?.suspendedUntil || null
    },
    assignedRoles: assignedRolesRows?.results || [],
    availableRoles: availableRoleRows,
    currentVesselAssignment: activeAssignmentRow || null,
    vesselAssignmentHistory: assignmentHistoryRows?.results || [],
    vesselConfig: {
      ships: shipsRows?.results || []
    },
    capabilities: {
      canAddNotes: hasPermission(session, 'employees.notes') && canEditByHierarchy,
      canAddDisciplinary: hasPermission(session, 'employees.discipline') && canEditByHierarchy,
      canActivate: hasPermission(session, 'employees.edit') && canEditByHierarchy,
      canDelete: hasPermission(session, 'employees.delete') && canEditByHierarchy,
      canAssignUserGroups: hasPermission(session, 'user_groups.assign') && hasPermission(session, 'employees.edit') && canEditByHierarchy,
      canManageVesselAssignment: hasPermission(session, 'employees.edit') && canEditByHierarchy
    },
    timing: { dbMs, totalMs: Date.now() - startedAt }
  });
}
