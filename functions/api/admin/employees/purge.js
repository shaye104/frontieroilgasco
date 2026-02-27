import { json } from '../../auth/_lib/auth.js';
import { requirePermission } from '../_lib/admin-auth.js';
import { getActorAccessScope, hasHierarchyBypass } from '../_lib/access-scope.js';
import { canEditEmployeeByRank, normalizeDiscordUserId, writeAdminActivityEvent } from '../../_lib/db.js';

function text(value) {
  return String(value || '').trim();
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.delete']);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const discordUserId = normalizeDiscordUserId(payload?.discordUserId);
  const reason = text(payload?.reason).slice(0, 500);
  if (!/^\d{6,30}$/.test(discordUserId)) return json({ error: 'Valid Discord User ID is required.' }, 400);
  if (!reason) return json({ error: 'Delete reason is required.' }, 400);

  const actorScope = await getActorAccessScope(env, session);
  const actorEmployee = actorScope.actorEmployee;
  const employee = await env.DB.prepare('SELECT * FROM employees WHERE discord_user_id = ? LIMIT 1').bind(discordUserId).first();

  if (employee) {
    if (actorEmployee?.id && Number(actorEmployee.id) === Number(employee.id)) {
      return json({ error: 'You cannot delete your own account.' }, 403);
    }
    const canDeleteByHierarchy = hasHierarchyBypass(env, session)
      ? true
      : actorEmployee
      ? await canEditEmployeeByRank(env, actorEmployee, employee, { allowSelf: false, allowEqual: false })
      : false;
    if (!canDeleteByHierarchy) {
      return json({ error: 'You can only delete profiles beneath your hierarchy.' }, 403);
    }

    // Mirror safety policy from employee delete endpoint: do not delete accounts tied to ops history.
    const [voyageRefs, financeRefs] = await Promise.all([
      env.DB
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM voyages WHERE owner_employee_id = ?) +
             (SELECT COUNT(*) FROM voyages WHERE officer_of_watch_employee_id = ?) +
             (SELECT COUNT(*) FROM voyage_crew_members WHERE employee_id = ?) +
             (SELECT COUNT(*) FROM voyage_participants WHERE employee_id = ?) +
             (SELECT COUNT(*) FROM voyage_logs WHERE author_employee_id = ?) AS total`
        )
        .bind(employee.id, employee.id, employee.id, employee.id, employee.id)
        .first(),
      env.DB
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM finance_cash_ledger_entries WHERE created_by_employee_id = ?) +
             (SELECT COUNT(*) FROM finance_cash_ledger_entries WHERE deleted_by_employee_id = ?) +
             (SELECT COUNT(*) FROM finance_settlement_audit WHERE settled_by_employee_id = ?) +
             (SELECT COUNT(*) FROM finance_settlement_audit WHERE oow_employee_id = ?) +
             (SELECT COUNT(*) FROM finance_cashflow_audit WHERE performed_by_employee_id = ?) AS total`
        )
        .bind(employee.id, employee.id, employee.id, employee.id, employee.id)
        .first()
    ]);
    const blockingTotal = Number(voyageRefs?.total || 0) + Number(financeRefs?.total || 0);
    if (blockingTotal > 0) {
      return json({ error: 'Cannot purge this user because they have voyage/finance history.' }, 409);
    }

    await env.DB.batch([
      env.DB.prepare('DELETE FROM employee_role_assignments WHERE employee_id = ?').bind(employee.id),
      env.DB.prepare('DELETE FROM employee_notes WHERE employee_id = ?').bind(employee.id),
      env.DB.prepare('DELETE FROM disciplinary_records WHERE employee_id = ?').bind(employee.id),
      env.DB.prepare('DELETE FROM admin_activity_events WHERE target_employee_id = ? OR actor_employee_id = ?').bind(employee.id, employee.id),
      env.DB.prepare('DELETE FROM employees WHERE id = ?').bind(employee.id)
    ]);
  }

  const accessDeleteResult = await env.DB.prepare('DELETE FROM access_requests WHERE discord_user_id = ?').bind(discordUserId).run();
  const deletedAccessRows = Number(accessDeleteResult?.meta?.changes || 0);

  await writeAdminActivityEvent(env, {
    actorEmployeeId: actorEmployee?.id || null,
    actorName: session.displayName || session.userId,
    actorDiscordUserId: session.userId,
    actionType: 'USER_PURGED',
    targetEmployeeId: null,
    summary: `Purged user ${discordUserId}.`,
    metadata: {
      discordUserId,
      removedEmployee: Boolean(employee),
      removedAccessRequests: deletedAccessRows,
      reason
    }
  });

  return json({
    ok: true,
    removedEmployee: Boolean(employee),
    removedAccessRequests: deletedAccessRows
  });
}
