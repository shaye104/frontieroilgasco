import { json } from '../../../auth/_lib/auth.js';
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
  const { env, params, request } = context;
  const { errorResponse, session } = await requireFinancePermission(context, 'finances.debts.settle');
  if (errorResponse) return errorResponse;
  if (!session?.employee?.id) return json({ error: 'Employee profile required to transfer remittances.' }, 403);
  if (!hasExplicitPermission(session, BOOKKEEPER_PERMISSION)) {
    return json({ error: 'Only Bookkeepers can move manager transfer balances.' }, 403);
  }

  const sourceCollectorEmployeeId = toInt(params.collectorEmployeeId);
  if (!sourceCollectorEmployeeId) return json({ error: 'Invalid source manager id.' }, 400);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const targetCollectorEmployeeId = toInt(payload?.toCollectorEmployeeId);
  if (!targetCollectorEmployeeId) return json({ error: 'Target manager is required.' }, 400);
  if (targetCollectorEmployeeId === sourceCollectorEmployeeId) return json({ error: 'Source and target manager must differ.' }, 400);

  const [sourceEmployee, targetEmployee] = await Promise.all([
    env.DB.prepare(`SELECT id, roblox_username FROM employees WHERE id = ? AND deleted_at IS NULL`).bind(sourceCollectorEmployeeId).first(),
    env.DB.prepare(`SELECT id, roblox_username FROM employees WHERE id = ? AND deleted_at IS NULL`).bind(targetCollectorEmployeeId).first()
  ]);
  if (!sourceEmployee) return json({ error: 'Source manager not found.' }, 404);
  if (!targetEmployee) return json({ error: 'Target manager not found.' }, 404);

  await env.DB.prepare(
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
  ).run();

  const pendingResult = await env.DB.prepare(
    `SELECT id, voyage_id, amount
     FROM finance_collector_remittances
     WHERE collector_employee_id = ?
       AND COALESCE(status, 'PENDING') = 'PENDING'
     ORDER BY id ASC`
  ).bind(sourceCollectorEmployeeId).all();
  const pendingRows = pendingResult?.results || [];
  if (!pendingRows.length) return json({ error: 'No pending transfer balance to move for this manager.' }, 400);

  const transferCount = pendingRows.length;
  const transferAmount = toMoney(pendingRows.reduce((sum, row) => sum + Math.max(0, toMoney(row.amount || 0)), 0));

  await env.DB.batch([
    env.DB.prepare(
      `UPDATE finance_collector_remittances
       SET collector_employee_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE collector_employee_id = ?
         AND COALESCE(status, 'PENDING') = 'PENDING'`
    ).bind(targetCollectorEmployeeId, sourceCollectorEmployeeId),
    env.DB.prepare(
      `INSERT INTO finance_cashflow_audit
       (entry_id, action, amount, performed_by_employee_id, performed_by_discord_user_id, details_json)
       VALUES (NULL, 'COLLECTOR_REMITTANCE_TRANSFERRED', ?, ?, ?, ?)`
    ).bind(
      transferAmount,
      Number(session.employee.id),
      String(session.userId || ''),
      JSON.stringify({
        sourceCollectorEmployeeId,
        sourceCollectorName: String(sourceEmployee.roblox_username || '').trim() || `Employee #${sourceCollectorEmployeeId}`,
        targetCollectorEmployeeId,
        targetCollectorName: String(targetEmployee.roblox_username || '').trim() || `Employee #${targetCollectorEmployeeId}`,
        transferCount,
        voyageIds: pendingRows.map((row) => Number(row.voyage_id || 0)).filter(Boolean)
      })
    )
  ]);

  return json({ ok: true, sourceCollectorEmployeeId, targetCollectorEmployeeId, transferCount, transferAmount });
}
