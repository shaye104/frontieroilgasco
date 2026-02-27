import { json } from '../../auth/_lib/auth.js';
import { requirePermission } from '../_lib/admin-auth.js';
import { hasPermission } from '../../_lib/permissions.js';
import { canEditEmployeeByRank, writeAdminActivityEvent } from '../../_lib/db.js';
import { sendRankSyncWebhook } from '../../_lib/rank-sync.js';
import {
  canManageRoleRowByHierarchy,
  canViewEmployeeByHierarchy,
  getActorAccessScope,
  hasHierarchyBypass,
  validateRoleSetManageable
} from '../_lib/access-scope.js';

function valueText(value) {
  const text = String(value ?? '').trim();
  return text || 'Unset';
}

function buildChangeEntries(previous, next) {
  const tracked = [
    { key: 'rank', label: 'Rank changed' },
    { key: 'grade', label: 'Grade changed' },
    { key: 'employee_status', label: 'Status changed' },
    { key: 'activation_status', label: 'Activation changed' },
    { key: 'serial_number', label: 'Serial Number changed' },
    { key: 'hire_date', label: 'Hire Date changed' }
  ];

  return tracked
    .filter(({ key }) => String(previous?.[key] || '').trim() !== String(next?.[key] || '').trim())
    .map(({ key, label }) => ({
      actionType: label,
      details: `${valueText(previous?.[key])} -> ${valueText(next?.[key])}`
    }));
}

function normalizeText(value) {
  return String(value || '').trim();
}

function hasOwn(payload, key) {
  return Object.prototype.hasOwnProperty.call(payload || {}, key);
}

async function getBlockingReferenceSummary(env, employeeId) {
  const [
    voyageOwner,
    voyageOfficer,
    voyageCrew,
    voyageParticipants,
    voyageLogs,
    ledgerCreated,
    ledgerDeleted,
    settlementBy,
    settlementOow,
    cashflowAudit
  ] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS count FROM voyages WHERE owner_employee_id = ?').bind(employeeId).first(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM voyages WHERE officer_of_watch_employee_id = ?').bind(employeeId).first(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM voyage_crew_members WHERE employee_id = ?').bind(employeeId).first(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM voyage_participants WHERE employee_id = ?').bind(employeeId).first(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM voyage_logs WHERE author_employee_id = ?').bind(employeeId).first(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM finance_cash_ledger_entries WHERE created_by_employee_id = ?').bind(employeeId).first(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM finance_cash_ledger_entries WHERE deleted_by_employee_id = ?').bind(employeeId).first(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM finance_settlement_audit WHERE settled_by_employee_id = ?').bind(employeeId).first(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM finance_settlement_audit WHERE oow_employee_id = ?').bind(employeeId).first(),
    env.DB.prepare('SELECT COUNT(*) AS count FROM finance_cashflow_audit WHERE performed_by_employee_id = ?').bind(employeeId).first()
  ]);

  const references = {
    voyages_owner: Number(voyageOwner?.count || 0),
    voyages_officer_of_watch: Number(voyageOfficer?.count || 0),
    voyage_crew_rows: Number(voyageCrew?.count || 0),
    voyage_participant_rows: Number(voyageParticipants?.count || 0),
    voyage_logs: Number(voyageLogs?.count || 0),
    finance_ledger_created_rows: Number(ledgerCreated?.count || 0),
    finance_ledger_deleted_rows: Number(ledgerDeleted?.count || 0),
    finance_settlement_settled_rows: Number(settlementBy?.count || 0),
    finance_settlement_oow_rows: Number(settlementOow?.count || 0),
    finance_cashflow_audit_rows: Number(cashflowAudit?.count || 0)
  };
  const total = Object.values(references).reduce((sum, value) => sum + Number(value || 0), 0);
  return { total, references };
}

async function findDuplicateEmployee(env, { robloxUsername, robloxUserId }, excludeEmployeeId) {
  const username = normalizeText(robloxUsername);
  const userId = normalizeText(robloxUserId);
  if (!username && !userId) return null;
  const clauses = [];
  const binds = [];
  if (username) {
    clauses.push('LOWER(COALESCE(roblox_username, \'\')) = LOWER(?)');
    binds.push(username);
  }
  if (userId) {
    clauses.push('TRIM(COALESCE(roblox_user_id, \'\')) = ?');
    binds.push(userId);
  }
  let sql = `SELECT id, roblox_username, roblox_user_id FROM employees WHERE (${clauses.join(' OR ')})`;
  if (Number.isInteger(excludeEmployeeId) && excludeEmployeeId > 0) {
    sql += ' AND id != ?';
    binds.push(excludeEmployeeId);
  }
  sql += ' LIMIT 1';
  return env.DB.prepare(sql).bind(...binds).first();
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.read']);
  if (errorResponse) return errorResponse;

  const employeeId = Number(params.id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return json({ error: 'Invalid employee id.' }, 400);

  const employee = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  if (!employee) return json({ error: 'Employee not found.' }, 404);
  const scope = await getActorAccessScope(env, session);
  const canViewByRank = await canViewEmployeeByHierarchy(env, scope, employee, { allowSelf: true, allowEqual: false });
  if (!canViewByRank) {
    return json({ error: 'You can only view profiles beneath your hierarchy.' }, 403);
  }
  const canEditByRank = hasHierarchyBypass(env, session)
    ? true
    : scope.actorEmployee
    ? await canEditEmployeeByRank(env, scope.actorEmployee, employee, { allowSelf: false, allowEqual: false })
    : false;

  const disciplinaries = await env.DB.prepare(
    `SELECT id, record_type, record_date, record_status, notes, issued_by, created_at
     FROM disciplinary_records
     WHERE employee_id = ?
     ORDER BY COALESCE(record_date, created_at) DESC`
  )
    .bind(employeeId)
    .all();

  const notes = await env.DB.prepare(
    `SELECT id, note, authored_by, created_at
     FROM employee_notes
     WHERE employee_id = ?
     ORDER BY created_at DESC`
  )
    .bind(employeeId)
    .all();

  const roleAssignments = await env.DB
    .prepare(
      `SELECT ar.id, ar.name, ar.description, ar.sort_order
       FROM employee_role_assignments era
       INNER JOIN app_roles ar ON ar.id = era.role_id
       WHERE era.employee_id = ?
       ORDER BY ar.sort_order ASC, ar.id ASC`
    )
    .bind(employeeId)
    .all();

  const availableRoles = await env.DB
    .prepare('SELECT id, name, description, sort_order, is_system FROM app_roles ORDER BY sort_order ASC, id ASC')
    .all();
  const availableRoleRows = hasHierarchyBypass(env, session)
    ? availableRoles?.results || []
    : (availableRoles?.results || []).filter((row) => canManageRoleRowByHierarchy(scope, row));

  return json({
    employee,
    disciplinaries: disciplinaries?.results || [],
    notes: notes?.results || [],
    assignedRoles: roleAssignments?.results || [],
    availableRoles: availableRoleRows,
    capabilities: {
      canEditByRank,
      canAssignUserGroups: hasPermission(session, 'user_groups.assign') && canEditByRank
    }
  });
}

export async function onRequestPut(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.edit']);
  if (errorResponse) return errorResponse;

  const employeeId = Number(params.id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return json({ error: 'Invalid employee id.' }, 400);

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const existing = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  if (!existing) return json({ error: 'Employee not found.' }, 404);
  const scope = await getActorAccessScope(env, session);
  const actorEmployee = scope.actorEmployee;
  const canEditByRank = actorEmployee
    ? await canEditEmployeeByRank(env, actorEmployee, existing, { allowSelf: false, allowEqual: false })
    : false;
  if (!hasHierarchyBypass(env, session) && !canEditByRank) {
    return json({ error: 'You can only edit profiles beneath your hierarchy.' }, 403);
  }
  const duplicate = await findDuplicateEmployee(
    env,
    {
      robloxUsername: payload?.robloxUsername,
      robloxUserId: payload?.robloxUserId
    },
    employeeId
  );
  if (duplicate) {
    if (
      normalizeText(duplicate.roblox_username).toLowerCase() === normalizeText(payload?.robloxUsername).toLowerCase() &&
      normalizeText(payload?.robloxUsername)
    ) {
      return json({ error: 'Roblox Username already exists for another employee.' }, 400);
    }
    if (normalizeText(duplicate.roblox_user_id) === normalizeText(payload?.robloxUserId) && normalizeText(payload?.robloxUserId)) {
      return json({ error: 'Roblox User ID already exists for another employee.' }, 400);
    }
    return json({ error: 'Roblox Username/User ID must be unique.' }, 400);
  }

  const nextRobloxUsername = hasOwn(payload, 'robloxUsername')
    ? String(payload?.robloxUsername || '').trim()
    : String(existing.roblox_username || '').trim();
  const nextRobloxUserId = hasOwn(payload, 'robloxUserId')
    ? String(payload?.robloxUserId || '').trim()
    : String(existing.roblox_user_id || '').trim();
  const nextRank = hasOwn(payload, 'rank') ? String(payload?.rank || '').trim() : String(existing.rank || '').trim();
  const nextGrade = hasOwn(payload, 'grade') ? String(payload?.grade || '').trim() : String(existing.grade || '').trim();
  const nextSerialNumber = hasOwn(payload, 'serialNumber')
    ? String(payload?.serialNumber || '').trim()
    : String(existing.serial_number || '').trim();
  const nextEmployeeStatus = hasOwn(payload, 'employeeStatus')
    ? String(payload?.employeeStatus || '').trim()
    : String(existing.employee_status || '').trim();
  const nextActivationStatus = hasOwn(payload, 'activationStatus')
    ? String(payload?.activationStatus || '').trim().toUpperCase() || 'PENDING'
    : String(existing.activation_status || '').trim().toUpperCase() || 'PENDING';
  const nextHireDate = hasOwn(payload, 'hireDate') ? String(payload?.hireDate || '').trim() : String(existing.hire_date || '').trim();
  if (!hasHierarchyBypass(env, session)) {
    const nextTargetRank = await env.DB
      .prepare('SELECT level FROM config_ranks WHERE LOWER(value) = LOWER(?) LIMIT 1')
      .bind(nextRank)
      .first();
    const nextRankLevel = Number(nextTargetRank?.level || 0);
    if (!(Number(scope.actorRankLevel || 0) > nextRankLevel)) {
      return json({ error: 'You cannot set rank equal to or above your own hierarchy.' }, 403);
    }
  }

  await env.DB.prepare(
    `UPDATE employees
     SET roblox_username = ?,
         roblox_user_id = ?,
         rank = ?,
         grade = ?,
         serial_number = ?,
         employee_status = ?,
         activation_status = ?,
         hire_date = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(
      nextRobloxUsername,
      nextRobloxUserId,
      nextRank,
      nextGrade,
      nextSerialNumber,
      nextEmployeeStatus,
      nextActivationStatus,
      nextHireDate,
      employeeId
    )
    .run();

  const roleIds = Array.isArray(payload?.roleIds)
    ? [...new Set(payload.roleIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))]
    : null;
  if (roleIds) {
    if (!hasPermission(session, 'user_groups.assign')) {
      return json({ error: 'Forbidden. Missing required permission.' }, 403);
    }
    if (!hasHierarchyBypass(env, session)) {
      const roleValidation = await validateRoleSetManageable(env, scope, roleIds);
      if (!roleValidation.ok) {
        return json({ error: roleValidation.error || 'One or more selected roles are outside your hierarchy.' }, 403);
      }
    }
    await env.DB.batch([
      env.DB.prepare('DELETE FROM employee_role_assignments WHERE employee_id = ?').bind(employeeId),
      ...roleIds.map((roleId) =>
        env.DB.prepare('INSERT OR IGNORE INTO employee_role_assignments (employee_id, role_id) VALUES (?, ?)').bind(employeeId, roleId)
      )
    ]);
  }

  const employee = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  if (!employee) return json({ error: 'Employee not found.' }, 404);

  const actor = session.displayName || session.userId;
  const rankChanged = String(existing?.rank || '').trim() !== String(employee?.rank || '').trim();
  const changes = buildChangeEntries(existing, employee);
  if (changes.length) {
    await writeAdminActivityEvent(env, {
      actorEmployeeId: actorEmployee?.id || null,
      actorName: session.displayName || session.userId,
      actorDiscordUserId: session.userId,
      actionType: 'EMPLOYEE_UPDATED',
      targetEmployeeId: employeeId,
      summary: `Updated employee ${employee.roblox_username || `#${employeeId}`}.`,
      metadata: {
        changes
      }
    });
  }

  let rankSyncDebug = null;
  if (rankChanged) {
    const syncPayload = {
      event: 'employee.rank.changed',
      changeId: `rank-${employeeId}-${Date.now()}`,
      occurredAt: new Date().toISOString(),
      actor: {
        employeeId: Number(actorEmployee?.id || 0) || null,
        discordUserId: String(session.userId || '').trim() || null,
        name: String(session.displayName || session.userId || '').trim() || null
      },
      employee: {
        id: Number(employeeId),
        discordUserId: String(employee.discord_user_id || '').trim() || null,
        robloxUserId: String(employee.roblox_user_id || '').trim() || null,
        robloxUsername: String(employee.roblox_username || '').trim() || null
      },
      rank: {
        old: String(existing.rank || '').trim() || null,
        next: String(employee.rank || '').trim() || null,
        grade: String(employee.grade || '').trim() || null
      }
    };
    const syncResult = await sendRankSyncWebhook(env, syncPayload);
    const syncReason = syncResult.ok
      ? 'ok'
      : syncResult.skipped
      ? syncResult.error || 'webhook_not_configured'
      : syncResult.error || syncResult.responseText || `http_${Number(syncResult.status || 0)}`;
    let webhookHost = null;
    try {
      webhookHost = syncResult.webhookUrl ? new URL(String(syncResult.webhookUrl)).host : null;
    } catch {
      webhookHost = null;
    }
    rankSyncDebug = {
      ok: Boolean(syncResult.ok),
      skipped: Boolean(syncResult.skipped),
      status: Number(syncResult.status || 0) || null,
      reason: String(syncReason || 'unknown_error'),
      responseText: String(syncResult.responseText || '').slice(0, 500) || null,
      webhookHost
    };
    await writeAdminActivityEvent(env, {
      actorEmployeeId: actorEmployee?.id || null,
      actorName: session.displayName || session.userId,
      actorDiscordUserId: session.userId,
      actionType: syncResult.ok ? 'RANK_SYNC_SUCCESS' : syncResult.skipped ? 'RANK_SYNC_SKIPPED' : 'RANK_SYNC_FAILED',
      targetEmployeeId: employeeId,
      summary: syncResult.ok
        ? `Rank sync succeeded for ${employee.roblox_username || `#${employeeId}`}.`
        : syncResult.skipped
        ? `Rank sync skipped for ${employee.roblox_username || `#${employeeId}`}: ${syncReason}.`
        : `Rank sync failed for ${employee.roblox_username || `#${employeeId}`}: ${syncReason}.`,
      metadata: {
        syncPayload: {
          event: syncPayload.event,
          changeId: syncPayload.changeId,
          employee: syncPayload.employee,
          rank: syncPayload.rank
        },
        webhookHost,
        syncResult
      }
    });
  }

  return json({ employee, rankSync: rankSyncDebug });
}

export async function onRequestDelete(context) {
  const { env, params, request } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.delete']);
  if (errorResponse) return errorResponse;

  const employeeId = Number(params.id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return json({ error: 'Invalid employee id.' }, 400);

  const actorScope = await getActorAccessScope(env, session);
  const actorEmployee = actorScope.actorEmployee;
  const existing = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  if (!existing) return json({ error: 'Employee not found.' }, 404);

  if (actorEmployee?.id && Number(actorEmployee.id) === employeeId) {
    return json({ error: 'You cannot delete your own account.' }, 403);
  }

  const canDeleteByHierarchy = hasHierarchyBypass(env, session)
    ? true
    : actorEmployee
    ? await canEditEmployeeByRank(env, actorEmployee, existing, { allowSelf: false, allowEqual: false })
    : false;
  if (!canDeleteByHierarchy) {
    return json({ error: 'You can only delete profiles beneath your hierarchy.' }, 403);
  }

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  const reason = normalizeText(payload?.reason).slice(0, 500);
  if (!reason) {
    return json({ error: 'Delete reason is required.' }, 400);
  }

  const refs = await getBlockingReferenceSummary(env, employeeId);
  if (refs.total > 0) {
    return json(
      {
        error: 'Cannot delete employee with voyage/finance history. Remove dependent records first.',
        references: refs.references
      },
      409
    );
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM employee_role_assignments WHERE employee_id = ?').bind(employeeId),
    env.DB.prepare('DELETE FROM employee_notes WHERE employee_id = ?').bind(employeeId),
    env.DB.prepare('DELETE FROM disciplinary_records WHERE employee_id = ?').bind(employeeId),
    env.DB.prepare('DELETE FROM admin_activity_events WHERE target_employee_id = ? OR actor_employee_id = ?').bind(employeeId, employeeId),
    env.DB.prepare('DELETE FROM access_requests WHERE discord_user_id = ?').bind(String(existing.discord_user_id || '').trim()),
    env.DB.prepare('DELETE FROM employees WHERE id = ?').bind(employeeId)
  ]);

  await writeAdminActivityEvent(env, {
    actorEmployeeId: actorEmployee?.id || null,
    actorName: session.displayName || session.userId,
    actorDiscordUserId: session.userId,
    actionType: 'EMPLOYEE_DELETED',
    targetEmployeeId: null,
    summary: `Deleted employee ${existing.roblox_username || `#${employeeId}`}.`,
    metadata: {
      deletedEmployee: {
        id: Number(employeeId),
        discordUserId: String(existing.discord_user_id || '').trim() || null,
        robloxUserId: String(existing.roblox_user_id || '').trim() || null,
        robloxUsername: String(existing.roblox_username || '').trim() || null,
        rank: String(existing.rank || '').trim() || null
      },
      reason
    }
  });

  return json({ ok: true });
}
