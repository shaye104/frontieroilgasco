import { toMoney } from './finances.js';

export const CASHFLOW_TYPES = new Set(['IN', 'OUT']);
export const CASHFLOW_CATEGORIES = ['Repairs', 'Fuel', 'Admin', 'Investment', 'Operational Revenue', 'Other'];

export function normalizeCashflowType(value) {
  const type = String(value || '').trim().toUpperCase();
  return CASHFLOW_TYPES.has(type) ? type : null;
}

export function normalizeCashflowCategory(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const matched = CASHFLOW_CATEGORIES.find((category) => category.toLowerCase() === raw.toLowerCase());
  return matched || raw.slice(0, 80);
}

export function normalizeCashflowReason(value) {
  const reason = String(value || '').trim();
  if (reason.length < 5) return null;
  return reason.slice(0, 400);
}

export function toPositiveInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const rounded = Math.round(n);
  if (!Number.isInteger(rounded) || rounded <= 0) return null;
  return rounded;
}

export function toOptionalInteger(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}

export async function getCashStartingBalance(env) {
  const row = await env.DB.prepare(`SELECT starting_balance FROM finance_cash_settings WHERE id = 1`).first();
  return toMoney(row?.starting_balance || 0);
}

export async function getSettledCompanyShareTotal(env, options = {}) {
  const where = [
    `v.status = 'ENDED'`,
    `COALESCE(v.company_share_status, 'UNSETTLED') = 'SETTLED'`,
    `ROUND(COALESCE(v.company_share_amount, v.company_share, 0)) > 0`
  ];
  const bindings = [];

  if (options.fromIso) {
    where.push('v.company_share_settled_at IS NOT NULL', 'v.company_share_settled_at >= ?');
    bindings.push(options.fromIso);
  }
  if (options.toIso) {
    where.push('v.company_share_settled_at IS NOT NULL', 'v.company_share_settled_at <= ?');
    bindings.push(options.toIso);
  }

  const row = await env.DB
    .prepare(
      `SELECT
         COALESCE(SUM(ROUND(COALESCE(v.company_share_amount, v.company_share, 0))), 0) AS total
       FROM voyages v
       WHERE ${where.join(' AND ')}`
    )
    .bind(...bindings)
    .first();

  return Math.max(0, toMoney(row?.total || 0));
}

export async function getCashLedgerTotals(env, options = {}) {
  const where = ['e.deleted_at IS NULL'];
  const bindings = [];

  if (options.fromIso) {
    where.push('e.created_at >= ?');
    bindings.push(options.fromIso);
  }
  if (options.toIso) {
    where.push('e.created_at <= ?');
    bindings.push(options.toIso);
  }

  const row = await env.DB
    .prepare(
      `SELECT
         COALESCE(SUM(CASE WHEN e.type = 'IN' THEN e.amount ELSE 0 END), 0) AS cash_in,
         COALESCE(SUM(CASE WHEN e.type = 'OUT' THEN e.amount ELSE 0 END), 0) AS cash_out
       FROM finance_cash_ledger_entries e
       WHERE ${where.join(' AND ')}`
    )
    .bind(...bindings)
    .first();

  return {
    cashIn: Math.max(0, toMoney(row?.cash_in || 0)),
    cashOut: Math.max(0, toMoney(row?.cash_out || 0))
  };
}

export async function getCurrentCashBalance(env) {
  const [startingBalance, ledgerTotals] = await Promise.all([
    getCashStartingBalance(env),
    getCashLedgerTotals(env)
  ]);

  const currentBalance = toMoney(startingBalance + ledgerTotals.cashIn - ledgerTotals.cashOut);

  return {
    startingBalance,
    cashInTotal: ledgerTotals.cashIn,
    cashOutTotal: ledgerTotals.cashOut,
    currentBalance
  };
}

export async function getCashflowPeriodSnapshot(env, fromIso, toIso) {
  const ledgerTotals = await getCashLedgerTotals(env, { fromIso, toIso });
  const cashIn = toMoney(ledgerTotals.cashIn);
  const cashOut = toMoney(ledgerTotals.cashOut);
  const netCashflow = toMoney(cashIn - cashOut);

  return {
    cashIn,
    cashOut,
    netCashflow
  };
}
