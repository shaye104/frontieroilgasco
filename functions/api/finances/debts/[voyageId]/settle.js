import { json } from '../../../../auth/_lib/auth.js';
import { requireFinancePermission, toMoney } from '../../../../_lib/finances.js';

function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function onRequestPost(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requireFinancePermission(context, 'finances.debts.settle');
  if (errorResponse) return errorResponse;

  const voyageId = toInt(params.voyageId);
  if (!voyageId) return json({ error: 'Invalid voyage id.' }, 400);
  if (!session?.employee?.id) return json({ error: 'Employee profile required to settle debts.' }, 403);

  const row = await env.DB
    .prepare(
      `SELECT
         v.id,
         v.status,
         v.company_share,
         v.company_share_amount,
         COALESCE(v.company_share_status, 'UNSETTLED') AS company_share_status,
         v.officer_of_watch_employee_id
       FROM voyages v
       WHERE v.id = ?`
    )
    .bind(voyageId)
    .first();
  if (!row) return json({ error: 'Voyage not found.' }, 404);
  if (String(row.status) !== 'ENDED') return json({ error: 'Only ended voyages can be settled.' }, 400);

  const currentStatus = String(row.company_share_status || 'UNSETTLED').toUpperCase();
  if (currentStatus === 'SETTLED') {
    return json({ error: 'Company share is already settled for this voyage.' }, 400);
  }

  const amount = toMoney(row.company_share_amount ?? row.company_share ?? 0);
  await env.DB.batch([
    env.DB
      .prepare(
        `UPDATE voyages
         SET company_share_status = 'SETTLED',
             company_share_amount = ?,
             company_share_settled_at = CURRENT_TIMESTAMP,
             company_share_settled_by_employee_id = ?,
             company_share_settled_by_discord_id = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(amount, session.employee.id, session.userId, voyageId),
    env.DB
      .prepare(
        `INSERT INTO finance_settlement_audit
         (voyage_id, action, amount, settled_by_employee_id, settled_by_discord_user_id, oow_employee_id, details_json)
         VALUES (?, 'SETTLED', ?, ?, ?, ?, ?)`
      )
      .bind(
        voyageId,
        amount,
        session.employee.id,
        String(session.userId || ''),
        toInt(row.officer_of_watch_employee_id),
        JSON.stringify({
          previousStatus: currentStatus,
          nextStatus: 'SETTLED'
        })
      )
  ]);

  return json({
    ok: true,
    voyageId,
    amount,
    companyShareStatus: 'SETTLED'
  });
}
