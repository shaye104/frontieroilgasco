import { json } from '../../../auth/_lib/auth.js';
import { getCurrentCashBalance, normalizeCashflowReason, toOptionalInteger } from '../../../_lib/cashflow.js';
import { requireFinancePermission, toMoney } from '../../../_lib/finances.js';

export async function onRequestPost(context) {
  const { env, params, request } = context;
  const { errorResponse, session } = await requireFinancePermission(context, 'finances.debts.settle');
  if (errorResponse) return errorResponse;
  if (!session?.employee?.id) return json({ error: 'Employee profile required.' }, 403);

  const entryId = toOptionalInteger(params.id);
  if (!entryId) return json({ error: 'Invalid cashflow entry id.' }, 400);

  let payload;
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const deletedReason = normalizeCashflowReason(payload?.deletedReason || payload?.reason || '');
  if (!deletedReason) return json({ error: 'Delete reason must be at least 5 characters.' }, 400);

  const row = await env.DB
    .prepare(
      `SELECT
         e.id,
         e.type,
         e.amount,
         e.reason,
         e.category,
         e.voyage_id,
         e.deleted_at
       FROM finance_cash_ledger_entries e
       WHERE e.id = ?`
    )
    .bind(entryId)
    .first();
  if (!row) return json({ error: 'Cashflow entry not found.' }, 404);
  if (row.deleted_at) return json({ error: 'Cashflow entry already deleted.' }, 400);

  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE finance_cash_ledger_entries
         SET deleted_at = CURRENT_TIMESTAMP,
             deleted_by_employee_id = ?,
             deleted_reason = ?
         WHERE id = ?`
      )
      .bind(Number(session.employee.id), deletedReason, entryId),
    env.DB
      .prepare(
        `INSERT INTO finance_cashflow_audit
         (entry_id, action, amount, performed_by_employee_id, performed_by_discord_user_id, details_json)
         VALUES (?, 'CASHFLOW_DELETE', ?, ?, ?, ?)`
      )
      .bind(
        entryId,
        Math.max(0, toMoney(row.amount || 0)),
        Number(session.employee.id),
        String(session.userId || ''),
        JSON.stringify({
          type: String(row.type || '').trim().toUpperCase(),
          amount: Math.max(0, toMoney(row.amount || 0)),
          reason: String(row.reason || '').trim(),
          category: String(row.category || '').trim() || null,
          voyageId: toOptionalInteger(row.voyage_id),
          deletedReason
        })
      )
  ]);

  const balanceSnapshot = await getCurrentCashBalance(env);

  return json({
    ok: true,
    entryId,
    currentCashBalance: toMoney(balanceSnapshot.currentBalance)
  });
}
