import { json } from '../../../auth/_lib/auth.js';
import { getCurrentCashBalance, toOptionalInteger } from '../../../_lib/cashflow.js';
import { parseSettlementLines, requireFinancePermission, toMoney } from '../../../_lib/finances.js';
import { BOOKKEEPER_PERMISSION } from '../../../_lib/permissions.js';

const COMPANY_SHARE_RATE = 0.1;

function deriveSettlementAmount(row) {
  const settlementLines = parseSettlementLines(row?.settlement_lines_json);
  const settlementCutAmount = toMoney(settlementLines.reduce((sum, line) => sum + Number(line.lineRevenue || 0), 0));
  if (settlementCutAmount > 0) return Math.max(0, toMoney(settlementCutAmount * COMPANY_SHARE_RATE));

  const effectiveSell = Number(row?.effective_sell);
  if (Number.isFinite(effectiveSell) && effectiveSell > 0) return Math.max(0, toMoney(effectiveSell * COMPANY_SHARE_RATE));

  const totalPayable = Number(row?.total_payable_amount);
  if (Number.isFinite(totalPayable) && totalPayable > 0) return Math.max(0, toMoney(totalPayable));

  const storedAmount = Number(row?.company_share_amount);
  if (Number.isFinite(storedAmount) && storedAmount > 0) return Math.max(0, toMoney(storedAmount));

  return Math.max(0, toMoney(toMoney(row?.profit || 0) * COMPANY_SHARE_RATE));
}

function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function hasExplicitPermission(session, permissionKey) {
  const permissions = Array.isArray(session?.permissions) ? session.permissions.map((value) => String(value || '').trim()) : [];
  return permissions.includes(String(permissionKey || '').trim());
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
         v.profit,
         v.effective_sell,
         v.total_payable_amount,
         v.company_share,
         v.company_share_amount,
         v.settlement_lines_json,
         COALESCE(v.company_share_status, 'UNSETTLED') AS company_share_status,
         v.officer_of_watch_employee_id
       FROM voyages v
       WHERE v.id = ? AND v.deleted_at IS NULL`
    )
    .bind(voyageId)
    .first();
  if (!row) return json({ error: 'Voyage not found.' }, 404);
  if (String(row.status) !== 'ENDED') return json({ error: 'Only ended voyages can be settled.' }, 400);

  const currentStatus = String(row.company_share_status || 'UNSETTLED').toUpperCase();
  if (currentStatus === 'SETTLED') {
    return json({ error: 'Company share is already settled for this voyage.' }, 400);
  }

  await env.DB
    .prepare(
      `CREATE TABLE IF NOT EXISTS finance_collector_remittances (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        voyage_id INTEGER NOT NULL UNIQUE,
        collector_employee_id INTEGER NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'PENDING',
        settled_at TEXT,
        settled_by_employee_id INTEGER,
        settled_by_discord_user_id TEXT,
        cashflow_entry_id INTEGER,
        details_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(voyage_id) REFERENCES voyages(id),
        FOREIGN KEY(collector_employee_id) REFERENCES employees(id),
        FOREIGN KEY(settled_by_employee_id) REFERENCES employees(id),
        FOREIGN KEY(cashflow_entry_id) REFERENCES finance_cash_ledger_entries(id)
      )`
    )
    .run();

  const amount = deriveSettlementAmount(row);
  const settledWithBookkeeper = hasExplicitPermission(session, BOOKKEEPER_PERMISSION);
  const createdByName =
    String(session?.employee?.robloxUsername || '').trim() ||
    String(session?.displayName || '').trim() ||
    String(session?.userId || '').trim() ||
    'Unknown';
  const statements = [];

  statements.push(
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
        toOptionalInteger(row.officer_of_watch_employee_id),
        JSON.stringify({
          previousStatus: currentStatus,
          nextStatus: 'SETTLED',
          settlementMode: settledWithBookkeeper ? 'DIRECT_CASHFLOW' : 'COLLECTOR_PENDING_REMITTANCE'
        })
      )
  );

  if (amount > 0 && settledWithBookkeeper) {
    const currentBalance = await getCurrentCashBalance(env);
    const balanceAfter = toMoney(currentBalance.currentBalance + amount);
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO finance_cash_ledger_entries
           (created_by_employee_id, created_by_name, created_by_discord_user_id, type, amount, reason, category, voyage_id, balance_after)
           VALUES (?, ?, ?, 'IN', ?, ?, 'Operational Revenue', ?, ?)`
        )
        .bind(
          Number(session.employee.id),
          createdByName,
          String(session.userId || ''),
          amount,
          `Company share settlement - Voyage ${voyageId}`,
          voyageId,
          balanceAfter
        ),
      env.DB
        .prepare(
          `INSERT INTO finance_cashflow_audit
           (entry_id, action, amount, performed_by_employee_id, performed_by_discord_user_id, details_json)
           VALUES (last_insert_rowid(), 'CASHFLOW_CREATE', ?, ?, ?, ?)`
        )
        .bind(
          amount,
          Number(session.employee.id),
          String(session.userId || ''),
          JSON.stringify({
            type: 'IN',
            amount,
            category: 'Operational Revenue',
            reason: `Company share settlement - Voyage ${voyageId}`,
            voyageId,
            balanceAfter,
            source: 'company_share_settlement'
          })
        )
    );
  } else if (amount > 0) {
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO finance_collector_remittances
           (voyage_id, collector_employee_id, amount, status, details_json, updated_at)
           VALUES (?, ?, ?, 'PENDING', ?, CURRENT_TIMESTAMP)
           ON CONFLICT(voyage_id)
           DO UPDATE SET
             collector_employee_id = excluded.collector_employee_id,
             amount = excluded.amount,
             status = 'PENDING',
             settled_at = NULL,
             settled_by_employee_id = NULL,
             settled_by_discord_user_id = NULL,
             cashflow_entry_id = NULL,
             details_json = excluded.details_json,
             updated_at = CURRENT_TIMESTAMP`
        )
        .bind(
          voyageId,
          Number(session.employee.id),
          amount,
          JSON.stringify({
            voyageId,
            collectorEmployeeId: Number(session.employee.id),
            collectorName: createdByName,
            source: 'company_share_settlement_pending_remittance'
          })
        )
    );
  }

  await env.DB.batch(statements);

  return json({
    ok: true,
    voyageId,
    amount,
    companyShareStatus: 'SETTLED',
    remittancePending: amount > 0 && !settledWithBookkeeper
  });
}
