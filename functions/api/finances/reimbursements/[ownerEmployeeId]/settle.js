import { json } from '../../../auth/_lib/auth.js';
import { getCashflowPeriodSnapshot, getCurrentCashBalance } from '../../../_lib/cashflow.js';
import { getFinanceRangeWindow, normalizeFinanceRange, normalizeTzOffsetMinutes, parseSettlementLines, requireFinancePermission, toMoney } from '../../../_lib/finances.js';

function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function normalizeScope(value) {
  return String(value || '').trim().toLowerCase() === 'range' ? 'range' : 'all';
}

function parseOwnerTotals(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((row) => ({
        ownerEmployeeId: Number(row?.ownerEmployeeId || row?.owner_employee_id || 0),
        ownerName: String(row?.ownerName || row?.owner_name || '').trim(),
        reimbursementTotal: Math.max(0, toMoney(row?.reimbursementTotal || 0))
      }))
      .filter((row) => row.ownerEmployeeId > 0 && row.reimbursementTotal > 0);
  } catch {
    return [];
  }
}

function upsertReimbursementLine(map, voyageId, ownerEmployeeId, ownerName, amount) {
  const safeVoyageId = Number(voyageId || 0);
  const safeOwnerId = Number(ownerEmployeeId || 0);
  const safeAmount = Math.max(0, toMoney(amount || 0));
  if (!safeVoyageId || !safeOwnerId || safeAmount <= 0) return;
  const key = `${safeVoyageId}:${safeOwnerId}`;
  const existing = map.get(key) || {
    key,
    voyageId: safeVoyageId,
    ownerEmployeeId: safeOwnerId,
    ownerName: String(ownerName || '').trim() || `Employee #${safeOwnerId}`,
    totalReimbursement: 0
  };
  existing.totalReimbursement = toMoney(existing.totalReimbursement + safeAmount);
  map.set(key, existing);
}

export async function onRequestPost(context) {
  const { env, params, request } = context;
  const { errorResponse, session } = await requireFinancePermission(context, 'finances.debts.settle');
  if (errorResponse) return errorResponse;
  if (!session?.employee?.id) return json({ error: 'Employee profile required to settle reimbursements.' }, 403);

  const ownerEmployeeId = toInt(params.ownerEmployeeId);
  if (!ownerEmployeeId) return json({ error: 'Invalid owner employee id.' }, 400);

  // Defensive schema guard for in-flight deploys/edge cold starts.
  await env.DB
    .prepare(
      `CREATE TABLE IF NOT EXISTS finance_reimbursement_settlements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        voyage_id INTEGER NOT NULL,
        owner_employee_id INTEGER NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        settled_by_employee_id INTEGER,
        settled_by_discord_user_id TEXT,
        details_json TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(voyage_id, owner_employee_id),
        FOREIGN KEY(voyage_id) REFERENCES voyages(id),
        FOREIGN KEY(owner_employee_id) REFERENCES employees(id),
        FOREIGN KEY(settled_by_employee_id) REFERENCES employees(id)
      )`
    )
    .run();

  let payload = {};
  try {
    payload = (await request.json()) || {};
  } catch {
    payload = {};
  }

  const scope = normalizeScope(payload?.scope);
  const range = normalizeFinanceRange(payload?.range);
  const tzOffsetMinutes = normalizeTzOffsetMinutes(payload?.tzOffsetMinutes);

  const reimbursementWhereClauses = [
    `v.deleted_at IS NULL`,
    `v.status IN ('ENDED', 'CANCELLED')`,
    `(v.settlement_lines_json IS NOT NULL OR v.settlement_owner_totals_json IS NOT NULL)`
  ];
  const reimbursementBindings = [];
  if (scope === 'range') {
    const windowRange = getFinanceRangeWindow(range, new Date(), tzOffsetMinutes);
    reimbursementWhereClauses.push('v.ended_at IS NOT NULL AND v.ended_at >= ? AND v.ended_at <= ?');
    reimbursementBindings.push(windowRange.start.toISOString(), windowRange.end.toISOString());
  }
  const reimbursementWhereSql = reimbursementWhereClauses.length ? `WHERE ${reimbursementWhereClauses.join(' AND ')}` : '';

  const reimbursementVoyagesResult = await env.DB
    .prepare(
      `SELECT v.id, v.settlement_lines_json, v.settlement_owner_totals_json
       FROM voyages v
       ${reimbursementWhereSql}
       ORDER BY v.ended_at DESC, v.id DESC`
    )
    .bind(...reimbursementBindings)
    .all();

  const reimbursementByVoyageOwner = new Map();
  const reimbursementVoyages = reimbursementVoyagesResult?.results || [];
  reimbursementVoyages.forEach((voyage) => {
    const voyageId = Number(voyage.id || 0);
    if (!voyageId) return;
    const settlementLines = parseSettlementLines(voyage.settlement_lines_json);
    if (settlementLines.length) {
      settlementLines.forEach((line) => {
        const ownerId = Number(line.ownerEmployeeId || 0);
        const lineLost = Boolean(line.isLost) || Number(line.lostQuantity || 0) > 0;
        const amount = lineLost ? Math.max(50, Math.max(0, toMoney(line.lostReimbursement || 0))) : Math.max(0, toMoney(line.lostReimbursement || 0));
        upsertReimbursementLine(reimbursementByVoyageOwner, voyageId, ownerId, line.ownerName, amount);
      });
      return;
    }

    const ownerTotals = parseOwnerTotals(voyage.settlement_owner_totals_json);
    ownerTotals.forEach((row) => {
      upsertReimbursementLine(
        reimbursementByVoyageOwner,
        voyageId,
        Number(row.ownerEmployeeId || 0),
        row.ownerName,
        Math.max(0, toMoney(row.reimbursementTotal || 0))
      );
    });
  });

  const reimbursementVoyageIds = [...new Set([...reimbursementByVoyageOwner.values()].map((row) => Number(row.voyageId || 0)).filter(Boolean))];
  if (!reimbursementVoyageIds.length) {
    return json({ error: 'No reimbursements available to settle.' }, 400);
  }

  const placeholders = reimbursementVoyageIds.map(() => '?').join(', ');
  const settledResult = await env.DB
    .prepare(
      `SELECT voyage_id, owner_employee_id, SUM(amount) AS settled_amount
       FROM finance_reimbursement_settlements
       WHERE voyage_id IN (${placeholders}) AND owner_employee_id = ?
       GROUP BY voyage_id, owner_employee_id`
    )
    .bind(...reimbursementVoyageIds, ownerEmployeeId)
    .all();

  const settledByVoyageOwner = new Map();
  (settledResult?.results || []).forEach((row) => {
    const key = `${Number(row.voyage_id || 0)}:${Number(row.owner_employee_id || 0)}`;
    settledByVoyageOwner.set(key, Math.max(0, toMoney(row.settled_amount || 0)));
  });

  const outstandingRows = [...reimbursementByVoyageOwner.values()]
    .filter((row) => Number(row.ownerEmployeeId || 0) === ownerEmployeeId)
    .map((row) => {
      const key = `${Number(row.voyageId || 0)}:${Number(row.ownerEmployeeId || 0)}`;
      const settled = Math.max(0, toMoney(settledByVoyageOwner.get(key) || 0));
      const outstanding = Math.max(0, toMoney(Number(row.totalReimbursement || 0) - settled));
      return {
        ...row,
        outstanding
      };
    })
    .filter((row) => Number(row.outstanding || 0) > 0);

  if (!outstandingRows.length) {
    return json({ error: 'No outstanding reimbursements for this owner.' }, 400);
  }

  const totalOutstanding = toMoney(outstandingRows.reduce((sum, row) => sum + Number(row.outstanding || 0), 0));
  if (totalOutstanding <= 0) {
    return json({ error: 'No outstanding reimbursements for this owner.' }, 400);
  }

  const ownerName = String(outstandingRows[0]?.ownerName || '').trim() || `Employee #${ownerEmployeeId}`;
  const createdByName =
    String(session?.employee?.robloxUsername || '').trim() ||
    String(session?.displayName || '').trim() ||
    String(session?.userId || '').trim() ||
    'Unknown';
  const currentBalance = await getCurrentCashBalance(env);
  const balanceAfter = toMoney(currentBalance.currentBalance - totalOutstanding);
  const periodSnapshot = await getCashflowPeriodSnapshot(env);
  const totalCashOut = toMoney(periodSnapshot.cashOut + totalOutstanding);

  const statements = [
    env.DB
      .prepare(
        `INSERT INTO finance_cash_ledger_entries
         (created_by_employee_id, created_by_name, created_by_discord_user_id, type, amount, reason, category, voyage_id, balance_after)
         VALUES (?, ?, ?, 'OUT', ?, ?, 'Operational Expense', NULL, ?)`
      )
      .bind(
        Number(session.employee.id),
        createdByName,
        String(session.userId || ''),
        totalOutstanding,
        `Lost cargo reimbursement settlement - ${ownerName}`,
        balanceAfter
      ),
    env.DB
      .prepare(
        `INSERT INTO finance_cashflow_audit
         (entry_id, action, amount, performed_by_employee_id, performed_by_discord_user_id, details_json)
         VALUES (last_insert_rowid(), 'CASHFLOW_CREATE', ?, ?, ?, ?)`
      )
      .bind(
        totalOutstanding,
        Number(session.employee.id),
        String(session.userId || ''),
        JSON.stringify({
          type: 'OUT',
          amount: totalOutstanding,
          reason: `Lost cargo reimbursement settlement - ${ownerName}`,
          category: 'Operational Expense',
          ownerEmployeeId,
          ownerName,
          settlementCount: outstandingRows.length,
          source: 'lost_tote_reimbursement_settlement'
        })
      )
  ];

  outstandingRows.forEach((row) => {
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO finance_reimbursement_settlements
           (voyage_id, owner_employee_id, amount, settled_by_employee_id, settled_by_discord_user_id, details_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(voyage_id, owner_employee_id)
           DO UPDATE SET
             amount = amount + excluded.amount,
             settled_by_employee_id = excluded.settled_by_employee_id,
             settled_by_discord_user_id = excluded.settled_by_discord_user_id,
             details_json = excluded.details_json,
             updated_at = CURRENT_TIMESTAMP`
        )
        .bind(
          Number(row.voyageId),
          ownerEmployeeId,
          Number(row.outstanding || 0),
          Number(session.employee.id),
          String(session.userId || ''),
          JSON.stringify({
            ownerName,
            scope,
            range,
            settledAmount: Number(row.outstanding || 0),
            source: 'manual_reimbursement_settlement'
          })
        )
    );
  });

  await env.DB.batch(statements);

  return json({
    ok: true,
    ownerEmployeeId,
    ownerName,
    settledAmount: totalOutstanding,
    settledVoyageCount: outstandingRows.length,
    totals: {
      currentCashBalance: balanceAfter,
      cashOutTotal: totalCashOut
    }
  });
}

