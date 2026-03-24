import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { ensureCoreSchema } from './db.js';
import { enrichSessionWithPermissions, hasPermission } from './permissions.js';
import { canUseVoyageAndFinance, deriveLifecycleStatusFromEmployee } from './lifecycle.js';

const RANGE_KEYS = new Set(['week', 'month', '3m', '6m', 'year', 'all']);

export function normalizeTzOffsetMinutes(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  const rounded = Math.trunc(num);
  if (rounded < -840) return -840;
  if (rounded > 840) return 840;
  return rounded;
}

function localNowByOffset(now, tzOffsetMinutes) {
  return new Date(now.getTime() - normalizeTzOffsetMinutes(tzOffsetMinutes) * 60000);
}

function utcFromLocalParts(year, month, day, hour, minute, second, millisecond, tzOffsetMinutes) {
  const offsetMs = normalizeTzOffsetMinutes(tzOffsetMinutes) * 60000;
  return new Date(Date.UTC(year, month, day, hour, minute, second, millisecond) + offsetMs);
}

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

function endOfUtcMonth(input) {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth() + 1, 0, 23, 59, 59, 999));
}

function startOfUtcWeekMonday(input) {
  const dayStart = startOfUtcDay(input);
  const day = dayStart.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  return addUtcDays(dayStart, delta);
}

export function normalizeFinanceRange(rawRange) {
  const range = String(rawRange || '').trim().toLowerCase();
  return RANGE_KEYS.has(range) ? range : 'month';
}

export function getFinanceRangeWindow(range, now = new Date(), tzOffsetMinutes = 0) {
  const normalized = normalizeFinanceRange(range);
  const localNow = localNowByOffset(now, tzOffsetMinutes);
  const localEndOfToday = new Date(
    Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate(), 23, 59, 59, 999)
  );
  let start;
  let localStart;
  let localEnd;

  if (normalized === 'week') {
    localStart = startOfUtcWeekMonday(localEndOfToday);
    localEnd = addUtcDays(localStart, 4);
  } else if (normalized === 'month') {
    localStart = startOfUtcMonth(localEndOfToday);
    localEnd = endOfUtcMonth(localEndOfToday);
  } else if (normalized === '3m') {
    localStart = addUtcMonths(startOfUtcMonth(localEndOfToday), -2);
    localEnd = endOfUtcMonth(localEndOfToday);
  } else if (normalized === '6m') {
    localStart = addUtcMonths(startOfUtcMonth(localEndOfToday), -5);
    localEnd = endOfUtcMonth(localEndOfToday);
  } else if (normalized === 'year') {
    localStart = new Date(Date.UTC(localEndOfToday.getUTCFullYear(), 0, 1, 0, 0, 0, 0));
    localEnd = new Date(Date.UTC(localEndOfToday.getUTCFullYear(), 11, 31, 23, 59, 59, 999));
  } else {
    localStart = new Date(Date.UTC(1970, 0, 1, 0, 0, 0, 0));
    localEnd = localEndOfToday;
  }

  if (!localEnd) {
    localEnd = localEndOfToday;
  }

  if (localEnd < localStart) {
    localEnd = localStart;
    localEnd.setUTCHours(23, 59, 59, 999);
  }

  if (normalized === 'all') {
    start = localStart;
  } else {
    start = utcFromLocalParts(
      localStart.getUTCFullYear(),
      localStart.getUTCMonth(),
      localStart.getUTCDate(),
      0,
      0,
      0,
      0,
      tzOffsetMinutes
    );
  }

  const end =
    normalized === 'all'
      ? localEnd
      : utcFromLocalParts(
          localEnd.getUTCFullYear(),
          localEnd.getUTCMonth(),
          localEnd.getUTCDate(),
          23,
          59,
          59,
          999,
          tzOffsetMinutes
        );

  return { range: normalized, start, end };
}

export function toUtcBoundaryFromLocalDateInput(input, isEnd = false, tzOffsetMinutes = 0) {
  const value = String(input || '').trim();
  if (!value) return null;

  if (value.includes('T')) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }

  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);

  return utcFromLocalParts(
    year,
    month,
    day,
    isEnd ? 23 : 0,
    isEnd ? 59 : 0,
    isEnd ? 59 : 0,
    isEnd ? 999 : 0,
    tzOffsetMinutes
  ).toISOString();
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
        toteId: Number(line?.toteId || 0),
        ownerEmployeeId: Number(line?.ownerEmployeeId || line?.owner_employee_id || 0),
        ownerName: String(line?.ownerName || line?.owner_name || '').trim(),
        cargoTypeId: Number(line?.cargoTypeId || line?.fishTypeId || 0),
        cargoName: String(line?.cargoName || line?.fishName || '').trim(),
        quantity: Math.max(0, Math.floor(Number(line?.quantity || 0))),
        lostQuantity: Math.max(0, Math.floor(Number(line?.lostQuantity || 0))),
        lostValue: toMoney(line?.lostValue || 0),
        lostReimbursement: Math.max(
          0,
          toMoney(line?.lostReimbursement ?? ((line?.isLost || Number(line?.lostQuantity || 0) > 0) ? 50 : 0))
        ),
        isLost: Boolean(line?.isLost),
        netQuantity: Math.max(0, Math.floor(Number(line?.netQuantity ?? line?.quantity ?? 0))),
        trueSellUnitPrice: toMoney(line?.trueSellUnitPrice ?? line?.baseSellPrice ?? line?.unitPrice ?? 0),
        lineCost: toMoney(line?.lineCost ?? line?.rowBaseTotal ?? 0),
        lineRevenue: toMoney(line?.lineRevenue ?? line?.rowNetFinalTotal ?? line?.rowFinalTotal ?? 0),
        lineProfit: toMoney(
          line?.lineProfit ??
            (Number(line?.lineRevenue ?? line?.rowNetFinalTotal ?? line?.rowFinalTotal ?? 0) - Number(line?.rowBaseTotal ?? line?.lineCost ?? 0))
        )
      }))
      .filter((line) => Number.isFinite(Number(line.quantity || 0)) && Number(line.quantity || 0) > 0);
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
  if (!session.isAdmin) {
    const lifecycleStatus = deriveLifecycleStatusFromEmployee(session?.employee, session?.userStatus || 'ACTIVE');
    if (!session.employee || !canUseVoyageAndFinance(lifecycleStatus)) {
      return { errorResponse: json({ error: 'Your account status does not allow finance access.' }, 403), session: null };
    }
  }

  return { errorResponse: null, session };
}
