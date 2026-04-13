import { cachedJson, json } from '../../auth/_lib/auth.js';
import { getCashflowPeriodSnapshot, getCurrentCashBalance, normalizeCashflowCategory, normalizeCashflowReason, normalizeCashflowType, toOptionalInteger, toPositiveInteger } from '../../_lib/cashflow.js';
import { getFinanceRangeWindow, normalizeTzOffsetMinutes, requireFinancePermission, toMoney, toUtcBoundaryFromLocalDateInput } from '../../_lib/finances.js';
import { hasPermission } from '../../_lib/permissions.js';

const MANAGER_ACCOUNT_PERMISSION_KEYS = ['finances.debts.settle', 'admin.override', 'super.admin'];

function buildVoyageLabel(row) {
  const vessel = String(row?.vessel_name || '').trim();
  const callsign = String(row?.vessel_callsign || '').trim();
  const route = `${String(row?.departure_port || '').trim() || 'Unknown'} \u2192 ${String(row?.destination_port || '').trim() || 'Unknown'}`;
  const status = String(row?.status || '').trim().toUpperCase();
  return [vessel || 'Unknown vessel', callsign || 'N/A', route, status].join(' | ');
}

async function hasLegacyFinanceEntriesTable(env) {
  const row = await env.DB
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_finance_entries'")
    .first();
  return Boolean(row?.name);
}

async function ensureManagerBalanceEntriesTable(env) {
  await env.DB
    .prepare(
      `CREATE TABLE IF NOT EXISTS finance_manager_balance_entries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        employee_id INTEGER NOT NULL,
        amount REAL NOT NULL DEFAULT 0,
        entry_type TEXT NOT NULL,
        reason TEXT,
        voyage_id INTEGER,
        cashflow_entry_id INTEGER,
        related_employee_id INTEGER,
        created_by_employee_id INTEGER,
        details_json TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(employee_id) REFERENCES employees(id),
        FOREIGN KEY(voyage_id) REFERENCES voyages(id),
        FOREIGN KEY(cashflow_entry_id) REFERENCES finance_cash_ledger_entries(id),
        FOREIGN KEY(related_employee_id) REFERENCES employees(id),
        FOREIGN KEY(created_by_employee_id) REFERENCES employees(id)
      )`
    )
    .run();
}

function isoDayFromUtcParts(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function localByOffset(date, tzOffsetMinutes) {
  return new Date(date.getTime() - normalizeTzOffsetMinutes(tzOffsetMinutes) * 60000);
}

async function getLegacySolvedCashflowTotals(env, fromIso, toIso, tzOffsetMinutes = 0) {
  if (!(await hasLegacyFinanceEntriesTable(env))) {
    return { cashIn: 0, cashOut: 0, netCashflow: 0 };
  }
  const fromUtc = fromIso ? new Date(fromIso) : null;
  const toUtc = toIso ? new Date(toIso) : null;
  if (fromUtc && Number.isNaN(fromUtc.getTime())) return { cashIn: 0, cashOut: 0, netCashflow: 0 };
  if (toUtc && Number.isNaN(toUtc.getTime())) return { cashIn: 0, cashOut: 0, netCashflow: 0 };

  const fromDate = fromUtc ? isoDayFromUtcParts(localByOffset(fromUtc, tzOffsetMinutes)) : null;
  const toDate = toUtc ? isoDayFromUtcParts(localByOffset(toUtc, tzOffsetMinutes)) : null;
  const where = [
    `status = 'SOLVED'`,
    `amount_florins > 0`
  ];
  const bindings = [];
  if (fromDate) {
    where.push('record_date >= ?');
    bindings.push(fromDate);
  }
  if (toDate) {
    where.push('record_date <= ?');
    bindings.push(toDate);
  }

  const row = await env.DB
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN LOWER(COALESCE(to_username, '')) = 'codswallop' THEN amount_florins ELSE 0 END), 0) AS cash_in,
         COALESCE(SUM(CASE WHEN LOWER(COALESCE(from_username, '')) = 'codswallop' THEN amount_florins ELSE 0 END), 0) AS cash_out
       FROM legacy_finance_entries
       WHERE ${where.join(' AND ')}`
    )
    .bind(...bindings)
    .first();

  const cashIn = Math.max(0, toMoney(row?.cash_in || 0));
  const cashOut = Math.max(0, toMoney(row?.cash_out || 0));
  return { cashIn, cashOut, netCashflow: toMoney(cashIn - cashOut) };
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse, session } = await requireFinancePermission(context, 'finances.view');
  if (errorResponse) return errorResponse;

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
  await ensureManagerBalanceEntriesTable(env);

  const url = new URL(request.url);
  const tzOffsetMinutes = normalizeTzOffsetMinutes(url.searchParams.get('tzOffsetMinutes'));
  const rangeWindow = getFinanceRangeWindow(url.searchParams.get('range'), new Date(), tzOffsetMinutes);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(5, Number(url.searchParams.get('pageSize')) || 15));
  const offset = (page - 1) * pageSize;
  const startIso = rangeWindow.start.toISOString();
  const endIso = rangeWindow.end.toISOString();
  const search = String(url.searchParams.get('search') || '').trim().toLowerCase();
  const categoryFilter = normalizeCashflowCategory(url.searchParams.get('category') || '');
  const createdByFilter = String(url.searchParams.get('createdBy') || '').trim().toLowerCase();
  const dateFrom = toUtcBoundaryFromLocalDateInput(url.searchParams.get('dateFrom'), false, tzOffsetMinutes);
  const dateTo = toUtcBoundaryFromLocalDateInput(url.searchParams.get('dateTo'), true, tzOffsetMinutes);

  const whereClauses = ['e.deleted_at IS NULL'];
  const bindings = [];
  if (search) {
    const term = `%${search}%`;
    whereClauses.push(`(
      LOWER(COALESCE(e.reason, '')) LIKE ?
      OR LOWER(COALESCE(e.category, '')) LIKE ?
      OR LOWER(COALESCE(e.created_by_name, '')) LIKE ?
      OR LOWER(COALESCE(e.created_by_discord_user_id, '')) LIKE ?
      OR LOWER(COALESCE(emp.roblox_username, '')) LIKE ?
      OR LOWER(COALESCE(v.vessel_name, '')) LIKE ?
      OR LOWER(COALESCE(v.vessel_callsign, '')) LIKE ?
      OR LOWER(COALESCE(v.departure_port, '')) LIKE ?
      OR LOWER(COALESCE(v.destination_port, '')) LIKE ?
    )`);
    bindings.push(term, term, term, term, term, term, term, term, term);
  }
  if (categoryFilter) {
    whereClauses.push('LOWER(COALESCE(e.category, \'\')) = ?');
    bindings.push(String(categoryFilter).toLowerCase());
  }
  if (createdByFilter) {
    const term = `%${createdByFilter}%`;
    whereClauses.push(`(
      LOWER(COALESCE(e.created_by_name, '')) LIKE ?
      OR LOWER(COALESCE(e.created_by_discord_user_id, '')) LIKE ?
      OR LOWER(COALESCE(emp.roblox_username, '')) LIKE ?
    )`);
    bindings.push(term, term, term);
  }
  if (dateFrom) {
    whereClauses.push('e.created_at >= ?');
    bindings.push(dateFrom);
  }
  if (dateTo) {
    whereClauses.push('e.created_at <= ?');
    bindings.push(dateTo);
  }
  const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

  const kpiFromIso = null;
  const kpiToIso = null;

  const [balanceSnapshot, periodSnapshotBase, overallSnapshotBase, legacyPeriodSnapshot, legacyOverallSnapshot, totalRow, rowsResult, voyageOptionsResult, collectorRemittancesResult, managerOptionsResult, managerBalanceAdjustmentsResult] = await Promise.all([
    getCurrentCashBalance(env),
    getCashflowPeriodSnapshot(env, kpiFromIso, kpiToIso),
    getCashflowPeriodSnapshot(env),
    getLegacySolvedCashflowTotals(env, kpiFromIso, kpiToIso, tzOffsetMinutes),
    getLegacySolvedCashflowTotals(env, null, null, tzOffsetMinutes),
    env.DB
      .prepare(
        `SELECT COUNT(*) AS total
         FROM finance_cash_ledger_entries e
         LEFT JOIN employees emp ON emp.id = e.created_by_employee_id
         LEFT JOIN voyages v ON v.id = e.voyage_id
         ${whereSql}`
      )
      .bind(...bindings)
      .first(),
    env.DB
      .prepare(
        `SELECT
           e.id,
           e.created_at,
           e.type,
           e.amount,
           e.reason,
           e.category,
           e.voyage_id,
           e.balance_after,
           e.created_by_name,
           e.created_by_discord_user_id,
           emp.roblox_username AS created_by_employee_name,
           v.vessel_name,
           v.vessel_callsign,
           v.departure_port,
           v.destination_port
         FROM finance_cash_ledger_entries e
         LEFT JOIN employees emp ON emp.id = e.created_by_employee_id
         LEFT JOIN voyages v ON v.id = e.voyage_id
         ${whereSql}
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT ? OFFSET ?`
      )
      .bind(...bindings, pageSize, offset)
      .all(),
    env.DB
      .prepare(
        `SELECT
           v.id,
           v.status,
           v.vessel_name,
           v.vessel_callsign,
           v.departure_port,
           v.destination_port
         FROM voyages v
         WHERE v.deleted_at IS NULL AND v.status IN ('ONGOING', 'ENDED')
         ORDER BY CASE WHEN v.status = 'ONGOING' THEN 0 ELSE 1 END, v.ended_at DESC, v.id DESC
         LIMIT 120`
      )
      .all()
    ,
    env.DB
      .prepare(
        `SELECT
           r.collector_employee_id,
           e.roblox_username AS collector_name,
           COUNT(*) AS voyage_count,
           SUM(r.amount) AS total_amount,
           MIN(r.created_at) AS first_collected_at
         FROM finance_collector_remittances r
         INNER JOIN voyages v ON v.id = r.voyage_id
         LEFT JOIN employees e ON e.id = r.collector_employee_id
         WHERE COALESCE(r.status, 'PENDING') = 'PENDING'
           AND v.deleted_at IS NULL
         GROUP BY r.collector_employee_id, e.roblox_username
         ORDER BY total_amount DESC, voyage_count DESC`
      )
      .all()
    ,
    env.DB
      .prepare(
        `SELECT DISTINCT
           e.id,
           e.roblox_username
         FROM employees e
         LEFT JOIN employee_role_assignments era ON era.employee_id = e.id
         LEFT JOIN app_role_permissions arp ON arp.role_id = era.role_id
         LEFT JOIN rank_permission_mappings rpm ON LOWER(rpm.rank_value) = LOWER(COALESCE(e.rank, ''))
         WHERE COALESCE(NULLIF(TRIM(e.roblox_username), ''), '') <> ''
           AND (
             UPPER(COALESCE(e.rank, '')) = 'GENERAL MANAGER'
             OR arp.permission_key IN (${MANAGER_ACCOUNT_PERMISSION_KEYS.map(() => '?').join(', ')})
             OR rpm.permission_key IN (${MANAGER_ACCOUNT_PERMISSION_KEYS.map(() => '?').join(', ')})
           )
         ORDER BY LOWER(COALESCE(e.roblox_username, '')) ASC, e.id ASC`
      )
      .bind(...MANAGER_ACCOUNT_PERMISSION_KEYS, ...MANAGER_ACCOUNT_PERMISSION_KEYS)
      .all()
    ,
    env.DB
      .prepare(
        `SELECT
           employee_id,
           COALESCE(SUM(amount), 0) AS total_amount
         FROM finance_manager_balance_entries
         GROUP BY employee_id`
      )
      .all()
  ]);
  const periodSnapshot = {
    cashIn: toMoney(Number(periodSnapshotBase.cashIn || 0) + Number(legacyPeriodSnapshot.cashIn || 0)),
    cashOut: toMoney(Number(periodSnapshotBase.cashOut || 0) + Number(legacyPeriodSnapshot.cashOut || 0)),
    netCashflow: toMoney(
      Number(periodSnapshotBase.netCashflow || 0) + Number(legacyPeriodSnapshot.netCashflow || 0)
    )
  };
  const overallSnapshot = {
    cashIn: toMoney(Number(overallSnapshotBase.cashIn || 0) + Number(legacyOverallSnapshot.cashIn || 0)),
    cashOut: toMoney(Number(overallSnapshotBase.cashOut || 0) + Number(legacyOverallSnapshot.cashOut || 0)),
    netCashflow: toMoney(Number(overallSnapshotBase.netCashflow || 0) + Number(legacyOverallSnapshot.netCashflow || 0))
  };
  const effectiveBalanceSnapshot = {
    ...(balanceSnapshot || {}),
    currentBalance: toMoney(overallSnapshot.netCashflow),
    cashInTotal: toMoney(overallSnapshot.cashIn),
    cashOutTotal: toMoney(overallSnapshot.cashOut)
  };

  const rows = (rowsResult?.results || []).map((row) => ({
    id: Number(row.id || 0),
    createdAt: row.created_at,
    type: String(row.type || 'OUT').toUpperCase(),
    amount: Math.max(0, toMoney(row.amount || 0)),
    reason: String(row.reason || '').trim(),
    category: String(row.category || '').trim(),
    voyageId: Number(row.voyage_id || 0) || null,
    relatedVoyage: row.voyage_id
      ? {
          id: Number(row.voyage_id || 0),
          vesselName: String(row.vessel_name || '').trim(),
          vesselCallsign: String(row.vessel_callsign || '').trim(),
          departurePort: String(row.departure_port || '').trim(),
          destinationPort: String(row.destination_port || '').trim()
        }
      : null,
    createdBy:
      String(row.created_by_employee_name || '').trim() ||
      String(row.created_by_name || '').trim() ||
      String(row.created_by_discord_user_id || '').trim() ||
      'Unknown',
    balanceAfter: toMoney(row.balance_after || 0)
  }));

  const voyageOptions = (voyageOptionsResult?.results || []).map((row) => ({
    id: Number(row.id || 0),
    label: buildVoyageLabel(row)
  }));
  const adjustmentsByEmployee = new Map(
    (managerBalanceAdjustmentsResult?.results || [])
      .map((row) => [Number(row.employee_id || 0), toMoney(row.total_amount || 0)])
      .filter(([employeeId]) => Number.isInteger(employeeId) && employeeId > 0)
  );
  const pendingByEmployee = new Map(
    (collectorRemittancesResult?.results || [])
      .map((row) => ({
        collectorEmployeeId: Number(row.collector_employee_id || 0),
        collectorName: String(row.collector_name || '').trim() || `Employee #${Number(row.collector_employee_id || 0)}`,
        voyageCount: Number(row.voyage_count || 0),
        pendingAmount: Math.max(0, toMoney(Number(row.total_amount || 0))),
        firstCollectedAt: row.first_collected_at || null
      }))
      .filter((row) => row.collectorEmployeeId > 0)
      .map((row) => [row.collectorEmployeeId, row])
  );
  const managerOptionsById = new Map(
    (managerOptionsResult?.results || [])
      .map((row) => ({
        employeeId: Number(row.id || 0),
        name: String(row.roblox_username || '').trim() || `Employee #${Number(row.id || 0)}`
      }))
      .filter((row) => row.employeeId > 0)
      .map((row) => [row.employeeId, row])
  );
  pendingByEmployee.forEach((row, employeeId) => {
    if (!managerOptionsById.has(employeeId)) {
      managerOptionsById.set(employeeId, {
        employeeId,
        name: String(row.collectorName || '').trim() || `Employee #${employeeId}`
      });
    }
  });
  adjustmentsByEmployee.forEach((_, employeeId) => {
    if (!managerOptionsById.has(employeeId)) {
      managerOptionsById.set(employeeId, {
        employeeId,
        name: `Employee #${employeeId}`
      });
    }
  });
  const managerOptions = [...managerOptionsById.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const collectorRemittances = managerOptions.map((option) => {
    const employeeId = Number(option.employeeId || 0);
    const pending = pendingByEmployee.get(employeeId);
    const adjustments = Number(adjustmentsByEmployee.get(employeeId) || 0);
    return {
      collectorEmployeeId: employeeId,
      collectorName: String(option.name || '').trim() || `Employee #${employeeId}`,
      voyageCount: Number(pending?.voyageCount || 0),
      pendingAmount: Math.max(0, toMoney(pending?.pendingAmount || 0)),
      adjustmentAmount: toMoney(adjustments),
      totalAmount: toMoney(Number(pending?.pendingAmount || 0) + adjustments),
      firstCollectedAt: pending?.firstCollectedAt || null
    };
  });

  const total = Number(totalRow?.total || 0);

  return cachedJson(
    request,
    {
      range: rangeWindow.range,
      kpis: {
        currentCashBalance: toMoney(effectiveBalanceSnapshot.currentBalance),
        cashIn: toMoney(periodSnapshot.cashIn),
        cashOut: toMoney(periodSnapshot.cashOut),
        netCashflow: toMoney(periodSnapshot.netCashflow)
      },
      balance: effectiveBalanceSnapshot,
      period: periodSnapshot,
      rows,
      voyageOptions,
      collectorRemittances,
      managerOptions,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      },
      permissions: {
        canManage: hasPermission(session, 'finances.debts.settle'),
        canSettleCollectorRemittances: hasPermission(session, 'finances.debts.settle')
      },
      filters: {
        search,
        dateFrom: dateFrom ? dateFrom.slice(0, 10) : '',
        dateTo: dateTo ? dateTo.slice(0, 10) : '',
        category: categoryFilter || '',
        createdBy: createdByFilter
      },
      periodWindow: {
        fromIso: kpiFromIso,
        toIso: kpiToIso
      }
    },
    { cacheControl: 'private, no-store' }
  );
}

export async function onRequestPost(context) {
  const { env, request } = context;
  const { errorResponse, session } = await requireFinancePermission(context, 'finances.debts.settle');
  if (errorResponse) return errorResponse;
  if (!session?.employee?.id) return json({ error: 'Employee profile required.' }, 403);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const type = normalizeCashflowType(payload?.type);
  const amount = toPositiveInteger(payload?.amount);
  const reason = normalizeCashflowReason(payload?.reason);
  const category = normalizeCashflowCategory(payload?.category);
  const voyageId = toOptionalInteger(payload?.voyageId);
  const createdByName =
    String(session?.employee?.robloxUsername || '').trim() ||
    String(session?.displayName || '').trim() ||
    String(session?.userId || '').trim() ||
    'Unknown';

  if (!type) return json({ error: 'Type must be IN or OUT.' }, 400);
  if (!amount) return json({ error: 'Amount must be a positive whole number.' }, 400);
  if (!reason) return json({ error: 'Reason must be at least 5 characters.' }, 400);
  if (!category) return json({ error: 'Category is required.' }, 400);
  await ensureManagerBalanceEntriesTable(env);

  if (voyageId) {
    const voyage = await env.DB.prepare(`SELECT id FROM voyages WHERE id = ? AND deleted_at IS NULL`).bind(voyageId).first();
    if (!voyage) return json({ error: 'Related voyage not found.' }, 400);
  }

  const current = await getCurrentCashBalance(env);
  const sign = type === 'IN' ? 1 : -1;
  const balanceAfter = toMoney(current.currentBalance + sign * amount);

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT INTO finance_cash_ledger_entries
         (created_by_employee_id, created_by_name, created_by_discord_user_id, type, amount, reason, category, voyage_id, balance_after)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        Number(session.employee.id),
        createdByName,
        String(session.userId || ''),
        type,
        amount,
        reason,
        category,
        voyageId,
        balanceAfter
      ),
    env.DB
      .prepare(
        `INSERT INTO finance_manager_balance_entries
         (employee_id, amount, entry_type, reason, voyage_id, created_by_employee_id, details_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        Number(session.employee.id),
        type === 'IN' ? amount : -amount,
        type === 'IN' ? 'CASHFLOW_IN' : 'CASHFLOW_OUT',
        reason,
        voyageId,
        Number(session.employee.id),
        JSON.stringify({
          source: 'manual_cashflow_entry',
          type,
          amount,
          category: category || null,
          voyageId: voyageId || null
        })
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
          type,
          amount,
          reason,
          category: category || null,
          voyageId: voyageId || null,
          balanceAfter
        })
      )
  ]);

  return json({
    ok: true,
    entry: {
      type,
      amount,
      reason,
      category: category || null,
      voyageId: voyageId || null,
      balanceAfter
    }
  });
}





