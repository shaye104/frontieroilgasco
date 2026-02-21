import { cachedJson, json } from '../auth/_lib/auth.js';
import { getCashflowPeriodSnapshot, getCurrentCashBalance, normalizeCashflowCategory, normalizeCashflowReason, normalizeCashflowType, toOptionalInteger, toPositiveInteger } from '../_lib/cashflow.js';
import { getFinanceRangeWindow, requireFinancePermission, toMoney } from '../_lib/finances.js';
import { hasPermission } from '../_lib/permissions.js';

function buildVoyageLabel(row) {
  const vessel = String(row?.vessel_name || '').trim();
  const callsign = String(row?.vessel_callsign || '').trim();
  const route = `${String(row?.departure_port || '').trim() || 'Unknown'} \u2192 ${String(row?.destination_port || '').trim() || 'Unknown'}`;
  const status = String(row?.status || '').trim().toUpperCase();
  return [vessel || 'Unknown vessel', callsign || 'N/A', route, status].join(' | ');
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse, session } = await requireFinancePermission(context, 'finances.view');
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const rangeWindow = getFinanceRangeWindow(url.searchParams.get('range'));
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(50, Math.max(5, Number(url.searchParams.get('pageSize')) || 15));
  const offset = (page - 1) * pageSize;
  const startIso = rangeWindow.start.toISOString();
  const endIso = rangeWindow.end.toISOString();

  const [balanceSnapshot, periodSnapshot, totalRow, rowsResult, voyageOptionsResult] = await Promise.all([
    getCurrentCashBalance(env),
    getCashflowPeriodSnapshot(env, startIso, endIso),
    env.DB
      .prepare(`SELECT COUNT(*) AS total FROM finance_cash_ledger_entries WHERE deleted_at IS NULL`)
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
         WHERE e.deleted_at IS NULL
         ORDER BY e.created_at DESC, e.id DESC
         LIMIT ? OFFSET ?`
      )
      .bind(pageSize, offset)
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
         WHERE v.status IN ('ONGOING', 'ENDED')
         ORDER BY CASE WHEN v.status = 'ONGOING' THEN 0 ELSE 1 END, v.ended_at DESC, v.id DESC
         LIMIT 120`
      )
      .all()
  ]);

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

  const total = Number(totalRow?.total || 0);

  return cachedJson(
    request,
    {
      range: rangeWindow.range,
      kpis: {
        currentCashBalance: toMoney(balanceSnapshot.currentBalance),
        cashIn: toMoney(periodSnapshot.cashIn),
        cashOut: toMoney(periodSnapshot.cashOut),
        netCashflow: toMoney(periodSnapshot.netCashflow)
      },
      balance: balanceSnapshot,
      period: periodSnapshot,
      rows,
      voyageOptions,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / pageSize))
      },
      permissions: {
        canManage: hasPermission(session, 'finances.debts.settle')
      }
    },
    { cacheControl: 'private, max-age=15, stale-while-revalidate=30' }
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

  if (voyageId) {
    const voyage = await env.DB.prepare(`SELECT id FROM voyages WHERE id = ?`).bind(voyageId).first();
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
