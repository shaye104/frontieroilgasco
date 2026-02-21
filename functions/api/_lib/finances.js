import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { ensureCoreSchema } from './db.js';
import { enrichSessionWithPermissions, hasPermission } from './permissions.js';

const RANGE_KEYS = new Set(['week', 'month', '3m', '6m', 'year']);

function startOfUtcDay(input) {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate(), 0, 0, 0, 0));
}

function addUtcDays(input, days) {
  const next = new Date(input.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function startOfUtcMonth(input) {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), 1, 0, 0, 0, 0));
}

function addUtcMonths(input, months) {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth() + months, 1, 0, 0, 0, 0));
}

export function normalizeFinanceRange(rawRange) {
  const range = String(rawRange || '').trim().toLowerCase();
  return RANGE_KEYS.has(range) ? range : 'month';
}

export function getFinanceRangeWindow(range, now = new Date()) {
  const normalized = normalizeFinanceRange(range);
  const end = new Date(now.getTime());
  let start;

  if (normalized === 'week') {
    start = startOfUtcDay(addUtcDays(end, -6));
  } else if (normalized === 'month') {
    start = startOfUtcMonth(end);
  } else if (normalized === '3m') {
    start = addUtcMonths(startOfUtcMonth(end), -2);
  } else if (normalized === '6m') {
    start = addUtcMonths(startOfUtcMonth(end), -5);
  } else {
    start = new Date(Date.UTC(end.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
  }

  return { range: normalized, start, end };
}

export function toMoney(value) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

export function parseSettlementLines(settlementLinesJson) {
  if (!settlementLinesJson) return [];
  try {
    const raw = JSON.parse(settlementLinesJson);
    if (!Array.isArray(raw)) return [];
    return raw
      .map((line) => ({
        cargoTypeId: Number(line?.cargoTypeId),
        cargoName: String(line?.cargoName || '').trim(),
        quantity: Math.max(0, Math.floor(Number(line?.quantity || 0))),
        lostQuantity: Math.max(0, Math.floor(Number(line?.lostQuantity || 0))),
        netQuantity: Math.max(0, Math.floor(Number(line?.netQuantity || 0))),
        trueSellUnitPrice: toMoney(line?.trueSellUnitPrice || 0),
        lineCost: toMoney(line?.lineCost || 0),
        lineRevenue: toMoney(line?.lineRevenue || 0),
        lineProfit: toMoney(line?.lineProfit || 0)
      }))
      .filter((line) => Number.isInteger(line.cargoTypeId) && line.cargoTypeId > 0);
  } catch {
    return [];
  }
}

export async function requireFinancePermission(context, permissionKey) {
  const { env, request } = context;
  const rawSession = await readSessionFromRequest(env, request);
  const session = rawSession ? await enrichSessionWithPermissions(env, rawSession) : null;
  if (!session) return { errorResponse: json({ error: 'Authentication required.' }, 401), session: null };

  try {
    await ensureCoreSchema(env);
  } catch (error) {
    return { errorResponse: json({ error: error.message || 'Database unavailable.' }, 500), session: null };
  }

  if (!hasPermission(session, permissionKey)) {
    return { errorResponse: json({ error: 'Forbidden. Missing required permission.' }, 403), session: null };
  }

  return { errorResponse: null, session };
}
