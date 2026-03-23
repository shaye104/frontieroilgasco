import { json } from '../../../auth/_lib/auth.js';
import { getCurrentCashBalance } from '../../../_lib/cashflow.js';
import { requireFinancePermission, toMoney } from '../../../_lib/finances.js';
import { BOOKKEEPER_PERMISSION } from '../../../_lib/permissions.js';

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
  if (!session?.employee?.id) return json({ error: 'Employee profile required to settle remittances.' }, 403);
  if (!hasExplicitPermission(session, BOOKKEEPER_PERMISSION)) {
    return json({ error: 'Only Bookkeepers can settle pending transfers to CEO.' }, 403);
  }

  const collectorEmployeeId = toInt(params.collectorEmployeeId);
  if (!collectorEmployeeId) return json({ error: 'Invalid collector employee id.' }, 400);

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

  const pendingResult = await env.DB
    .prepare(
      `SELECT r.id, r.voyage_id, r.amount, r.collector_employee_id, e.roblox_username AS collector_name
       FROM finance_collector_remittances r
       LEFT JOIN employees e ON e.id = r.collector_employee_id
       WHERE r.collector_employee_id = ? AND COALESCE(r.status, 'PENDING') = 'PENDING'
       ORDER BY r.id ASC`
    )
    .bind(collectorEmployeeId)
    .all();

  const pendingRows = pendingResult?.results || [];
  if (!pendingRows.length) return json({ error: 'No pending collector remittances found.' }, 400);

  const remittanceCount = pendingRows.length;
  const totalAmount = toMoney(pendingRows.reduce((sum, row) => sum + Math.max(0, toMoney(row.amount || 0)), 0));
  if (totalAmount <= 0) return json({ error: 'No positive remittance amount found for this collector.' }, 400);

  const collectorName = String(pendingRows[0]?.collector_name || '').trim() || `Employee #${collectorEmployeeId}`;
  const actorName =
    String(session?.employee?.robloxUsername || '').trim() ||
    String(session?.displayName || '').trim() ||
    String(session?.userId || '').trim() ||
    'Unknown';
  const balance = await getCurrentCashBalance(env);
  const balanceAfter = toMoney(balance.currentBalance + totalAmount);

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO finance_cash_ledger_entries
         (created_by_employee_id, created_by_name, created_by_discord_user_id, type, amount, reason, category, voyage_id, balance_after)
         VALUES (?, ?, ?, 'IN', ?, ?, 'Operational Revenue', NULL, ?)`
      )
      .bind(
        Number(session.employee.id),
        actorName,
        String(session.userId || ''),
        totalAmount,
        `Collector remittance transfer - ${collectorName}`,
        balanceAfter
      ),
    env.DB
      .prepare(
        `UPDATE finance_collector_remittances
         SET status = 'SETTLED',
             settled_at = CURRENT_TIMESTAMP,
             settled_by_employee_id = ?,
             settled_by_discord_user_id = ?,
             cashflow_entry_id = last_insert_rowid(),
             updated_at = CURRENT_TIMESTAMP
         WHERE collector_employee_id = ? AND COALESCE(status, 'PENDING') = 'PENDING'`
      )
      .bind(Number(session.employee.id), String(session.userId || ''), collectorEmployeeId),
    env.DB
      .prepare(
        `INSERT INTO finance_cashflow_audit
         (entry_id, action, amount, performed_by_employee_id, performed_by_discord_user_id, details_json)
         VALUES (last_insert_rowid(), 'COLLECTOR_REMITTANCE_SETTLED', ?, ?, ?, ?)`
      )
      .bind(
        totalAmount,
        Number(session.employee.id),
        String(session.userId || ''),
        JSON.stringify({
          source: 'collector_remittance_settlement',
          collectorEmployeeId,
          collectorName,
          remittanceCount,
          voyageIds: pendingRows.map((row) => Number(row.voyage_id || 0)).filter(Boolean),
          balanceAfter
        })
      )
  ]);

  return json({
    ok: true,
    collectorEmployeeId,
    collectorName,
    remittanceCount,
    settledAmount: totalAmount
  });
}
