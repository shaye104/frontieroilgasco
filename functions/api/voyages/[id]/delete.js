import { json } from '../../auth/_lib/auth.js';
import { getCurrentCashBalance } from '../../_lib/cashflow.js';
import { toMoney } from '../../_lib/finances.js';
import { canManageVoyage, getVoyageBase, requireVoyagePermission } from '../../_lib/voyages.js';

function text(value) {
  return String(value || '').trim();
}

export async function onRequestPost(context) {
  const { env, params } = context;
  const { errorResponse, employee, session } = await requireVoyagePermission(context, 'voyages.delete');
  if (errorResponse) return errorResponse;

  const voyageId = Number(params.id);
  if (!Number.isInteger(voyageId) || voyageId <= 0) return json({ error: 'Invalid voyage id.' }, 400);

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const reason = text(payload?.reason);
  if (!reason || reason.length < 4) return json({ error: 'Deletion reason is required.' }, 400);

  const voyage = await getVoyageBase(env, voyageId);
  if (!voyage) return json({ error: 'Voyage not found.' }, 404);
  if (!['ENDED', 'CANCELLED'].includes(text(voyage.status).toUpperCase())) {
    return json({ error: 'Only past voyages can be deleted.' }, 400);
  }

  const deletedAt = text(voyage.deleted_at);
  if (deletedAt) return json({ error: 'Voyage is already deleted.' }, 400);
  if (!canManageVoyage(session, employee, voyage, 'voyages.delete')) {
    return json({ error: 'Only the voyage Officer of the Watch (OOTW) (or voyage override) can delete this voyage.' }, 403);
  }

  const companyShareAmount = Math.max(0, toMoney(voyage.company_share_amount ?? voyage.company_share ?? 0));
  const wasSettled = text(voyage.company_share_status).toUpperCase() === 'SETTLED';
  let shouldReverseCashflow = false;
  if (wasSettled && companyShareAmount > 0) {
    const remittanceRow = await env.DB
      .prepare(
        `SELECT status, cashflow_entry_id
         FROM finance_collector_remittances
         WHERE voyage_id = ?
         LIMIT 1`
      )
      .bind(voyageId)
      .first()
      .catch(() => null);

    if (remittanceRow) {
      const remittanceStatus = text(remittanceRow.status).toUpperCase();
      shouldReverseCashflow = remittanceStatus === 'SETTLED' && Number(remittanceRow.cashflow_entry_id || 0) > 0;
    } else {
      // Legacy and admin-override settlements create direct cashflow IN tied to the voyage.
      shouldReverseCashflow = true;
    }
  }

  const statements = [
    env.DB
      .prepare(
        `DELETE FROM finance_settlement_audit
         WHERE voyage_id = ?
           AND action <> 'VOYAGE_DELETED'`
      )
      .bind(voyageId),
    env.DB
      .prepare(
        `UPDATE voyages
         SET deleted_at = CURRENT_TIMESTAMP,
             deleted_by_employee_id = ?,
             deleted_reason = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(Number(employee.id), reason, voyageId),
    env.DB
      .prepare(
        `INSERT INTO finance_settlement_audit
         (voyage_id, action, amount, settled_by_employee_id, settled_by_discord_user_id, oow_employee_id, details_json)
         VALUES (?, 'VOYAGE_DELETED', ?, ?, ?, ?, ?)`
      )
      .bind(
        voyageId,
        wasSettled ? toMoney(companyShareAmount * -1) : 0,
        Number(employee.id),
        String(session.userId || ''),
        Number(voyage.officer_of_watch_employee_id || 0) || null,
        JSON.stringify({
          reason,
          wasSettled,
          companyShareAmount
        })
      ),
    env.DB
      .prepare(
        `INSERT INTO admin_activity_events
         (actor_employee_id, actor_name, actor_discord_user_id, action_type, target_employee_id, summary, metadata_json, created_at)
         VALUES (?, ?, ?, 'VOYAGE_DELETED', ?, ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(
        Number(employee.id),
        String(session.displayName || session.userId || 'Unknown'),
        String(session.userId || ''),
        Number(voyage.officer_of_watch_employee_id || 0) || null,
        `Deleted voyage #${voyageId}.`,
        JSON.stringify({
          voyageId,
          vesselName: text(voyage.vessel_name),
          vesselCallsign: text(voyage.vessel_callsign),
          departurePort: text(voyage.departure_port),
          destinationPort: text(voyage.destination_port),
          reason,
          wasSettled,
          companyShareAmount
        })
      )
  ,
    env.DB
      .prepare(`DELETE FROM finance_collector_remittances WHERE voyage_id = ?`)
      .bind(voyageId)
  ];

  if (shouldReverseCashflow && wasSettled && companyShareAmount > 0) {
    const balanceSnapshot = await getCurrentCashBalance(env);
    const balanceAfter = toMoney(balanceSnapshot.currentBalance - companyShareAmount);
    const actorName =
      text(session?.employee?.robloxUsername) ||
      text(session?.displayName) ||
      text(session?.userId) ||
      'Unknown';
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO finance_cash_ledger_entries
           (created_by_employee_id, created_by_name, created_by_discord_user_id, type, amount, reason, category, voyage_id, balance_after)
           VALUES (?, ?, ?, 'OUT', ?, ?, 'Operational Reversal', ?, ?)`
        )
        .bind(
          Number(employee.id),
          actorName,
          String(session.userId || ''),
          companyShareAmount,
          `Voyage deletion reversal - Voyage ${voyageId}`,
          voyageId,
          balanceAfter
        ),
      env.DB
        .prepare(
          `INSERT INTO finance_cashflow_audit
           (entry_id, action, amount, performed_by_employee_id, performed_by_discord_user_id, details_json)
           VALUES (last_insert_rowid(), 'VOYAGE_DELETE_REVERSAL', ?, ?, ?, ?)`
        )
        .bind(
          companyShareAmount,
          Number(employee.id),
          String(session.userId || ''),
          JSON.stringify({
            voyageId,
            reason,
            category: 'Operational Reversal',
            type: 'OUT'
          })
        )
    );
  }

  await env.DB.batch(statements);

  return json({
    ok: true,
    voyageId,
    wasSettled,
    reversedAmount: shouldReverseCashflow ? companyShareAmount : 0
  });
}
