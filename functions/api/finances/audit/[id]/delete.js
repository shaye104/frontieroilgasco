import { json } from '../../../auth/_lib/auth.js';
import { requireFinancePermission } from '../../../_lib/finances.js';

function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export async function onRequestPost(context) {
  const { env, params } = context;
  const { errorResponse } = await requireFinancePermission(context, 'finances.audit.delete');
  if (errorResponse) return errorResponse;

  const auditId = toInt(params.id);
  if (!auditId) return json({ error: 'Invalid audit id.' }, 400);

  const auditRow = await env.DB
    .prepare(
      `SELECT
         id,
         voyage_id,
         action
       FROM finance_settlement_audit
       WHERE id = ?
       LIMIT 1`
    )
    .bind(auditId)
    .first();
  if (!auditRow) return json({ error: 'Finance audit row not found.' }, 404);

  const voyageId = toInt(auditRow.voyage_id);
  const action = String(auditRow.action || '').trim().toUpperCase();
  const ledgerIds = new Set();

  if (voyageId) {
    const settlementLedgerRows =
      action === 'SETTLED'
        ? await env.DB
            .prepare(
              `SELECT id
               FROM finance_cash_ledger_entries
               WHERE voyage_id = ?
                 AND type = 'IN'
                 AND category = 'Operational Revenue'
                 AND reason = ?`
            )
            .bind(voyageId, `Company share settlement - Voyage ${voyageId}`)
            .all()
        : { results: [] };

    const reversalLedgerRows =
      action === 'VOYAGE_DELETED'
        ? await env.DB
            .prepare(
              `SELECT id
               FROM finance_cash_ledger_entries
               WHERE voyage_id = ?
                 AND type = 'OUT'
                 AND category = 'Operational Reversal'
                 AND reason = ?`
            )
            .bind(voyageId, `Voyage deletion reversal - Voyage ${voyageId}`)
            .all()
        : { results: [] };

    for (const row of [...(settlementLedgerRows?.results || []), ...(reversalLedgerRows?.results || [])]) {
      const id = toInt(row?.id);
      if (id) ledgerIds.add(id);
    }
  }

  const statements = [];
  const ledgerIdList = [...ledgerIds];
  if (ledgerIdList.length) {
    const placeholders = ledgerIdList.map(() => '?').join(', ');
    statements.push(
      env.DB.prepare(`DELETE FROM finance_cashflow_audit WHERE entry_id IN (${placeholders})`).bind(...ledgerIdList),
      env.DB.prepare(`DELETE FROM finance_cash_ledger_entries WHERE id IN (${placeholders})`).bind(...ledgerIdList)
    );
  }

  if (voyageId && action === 'SETTLED') {
    const remainingSettled = await env.DB
      .prepare(
        `SELECT COUNT(*) AS count
         FROM finance_settlement_audit
         WHERE voyage_id = ?
           AND action = 'SETTLED'
           AND id <> ?`
      )
      .bind(voyageId, auditId)
      .first();
    if (Number(remainingSettled?.count || 0) <= 0) {
      statements.push(
        env.DB
          .prepare(
            `UPDATE voyages
             SET company_share_status = 'UNSETTLED',
                 company_share_settled_at = NULL,
                 company_share_settled_by_employee_id = NULL,
                 company_share_settled_by_discord_id = NULL,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          )
          .bind(voyageId)
      );
    }
  }

  statements.push(env.DB.prepare(`DELETE FROM finance_settlement_audit WHERE id = ?`).bind(auditId));
  await env.DB.batch(statements);

  return json({
    ok: true,
    auditId,
    voyageId: voyageId || null,
    action,
    removedLedgerEntries: ledgerIdList.length
  });
}
