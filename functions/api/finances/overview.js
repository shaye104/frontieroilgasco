import { cachedJson } from '../auth/_lib/auth.js';
import { getFinanceRangeWindow, normalizeFinanceRange, normalizeTzOffsetMinutes, parseSettlementLines, requireFinancePermission, toMoney } from '../_lib/finances.js';

const COMPANY_SHARE_RATE = 0.2;
const VOYAGE_EVENT_AT_SQL = `COALESCE(NULLIF(TRIM(v.ended_at), ''), NULLIF(TRIM(v.updated_at), ''), NULLIF(TRIM(v.created_at), ''))`;

function isoDay(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function localByOffset(date, tzOffsetMinutes) {
  return new Date(date.getTime() - normalizeTzOffsetMinutes(tzOffsetMinutes) * 60000);
}

function startOfUtcWeek(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const day = d.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + delta);
  return d;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1, 0, 0, 0, 0));
}

function shiftRangeWindow(range, start, end, offset) {
  const safeOffset = Math.max(0, Number(offset || 0));
  if (!safeOffset) return { start, end };
  if (range === 'all') return { start, end };

  if (range === 'week') {
    return {
      start: addDays(start, safeOffset * -7),
      end: addDays(end, safeOffset * -7)
    };
  }

  if (range === 'month') {
    return {
      start: addMonths(start, safeOffset * -1),
      end: addMonths(end, safeOffset * -1)
    };
  }

  if (range === '3m') {
    return {
      start: addMonths(start, safeOffset * -3),
      end: addMonths(end, safeOffset * -3)
    };
  }

  if (range === '6m') {
    return {
      start: addMonths(start, safeOffset * -6),
      end: addMonths(end, safeOffset * -6)
    };
  }

  return {
    start: addMonths(start, safeOffset * -12),
    end: addMonths(end, safeOffset * -12)
  };
}

function bucketForDate(range, date, rangeStart, tzOffsetMinutes) {
  const localDate = localByOffset(date, tzOffsetMinutes);
  const localRangeStart = localByOffset(rangeStart, tzOffsetMinutes);
  if (range === 'week' || range === 'month') {
    return {
      key: isoDay(localDate),
      label: localDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    };
  }

  if (range === '3m' || range === '6m') {
    const stepDays = range === '3m' ? 7 : 14;
    const base = startOfUtcWeek(localRangeStart);
    const weekStart = startOfUtcWeek(localDate);
    const diffDays = Math.max(0, Math.floor((weekStart.getTime() - base.getTime()) / 86400000));
    const steppedDays = Math.floor(diffDays / stepDays) * stepDays;
    const bucketStart = addDays(base, steppedDays);
    return {
      key: isoDay(bucketStart),
      label: bucketStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    };
  }

  const startOfMonth = new Date(Date.UTC(localDate.getUTCFullYear(), localDate.getUTCMonth(), 1, 0, 0, 0, 0));
  return {
    key: monthKey(startOfMonth),
    label: startOfMonth.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })
  };
}

function buildBuckets(range, start, end, tzOffsetMinutes) {
  const localStart = localByOffset(start, tzOffsetMinutes);
  const localEnd = localByOffset(end, tzOffsetMinutes);
  const buckets = [];

  if (range === 'week' || range === 'month') {
    let cursor = new Date(Date.UTC(localStart.getUTCFullYear(), localStart.getUTCMonth(), localStart.getUTCDate(), 0, 0, 0, 0));
    const endDay = new Date(Date.UTC(localEnd.getUTCFullYear(), localEnd.getUTCMonth(), localEnd.getUTCDate(), 0, 0, 0, 0));
    while (cursor <= endDay) {
      buckets.push({ key: isoDay(cursor), label: cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) });
      cursor = addDays(cursor, 1);
    }
    return buckets;
  }

  if (range === '3m' || range === '6m') {
    const stepDays = range === '3m' ? 7 : 14;
    let cursor = startOfUtcWeek(localStart);
    while (cursor <= localEnd) {
      buckets.push({ key: isoDay(cursor), label: cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) });
      cursor = addDays(cursor, stepDays);
    }
    return buckets;
  }

  let cursor = new Date(Date.UTC(localStart.getUTCFullYear(), localStart.getUTCMonth(), 1, 0, 0, 0, 0));
  while (cursor <= localEnd) {
    buckets.push({
      key: monthKey(cursor),
      label: cursor.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })
    });
    cursor = addMonths(cursor, 1);
  }
  return buckets;
}

function addProfit(map, label, amount) {
  const key = String(label || '').trim() || 'Unknown';
  const current = toMoney(map.get(key) || 0);
  map.set(key, toMoney(current + toMoney(amount || 0)));
}

function pickTop(map) {
  const entries = [...map.entries()]
    .map(([label, netProfit]) => ({ label, netProfit: toMoney(netProfit || 0) }))
    .sort((a, b) => b.netProfit - a.netProfit || a.label.localeCompare(b.label));

  if (!entries.length) {
    return { label: 'No data', netProfit: 0 };
  }

  return entries[0];
}

function toSortedProfitRows(map) {
  return [...map.entries()]
    .map(([label, netProfit]) => ({ label: String(label || '').trim() || 'Unknown', netProfit: toMoney(netProfit || 0) }))
    .sort((a, b) => b.netProfit - a.netProfit || a.label.localeCompare(b.label))
    .map((row, index) => ({ rank: index + 1, label: row.label, netProfit: toMoney(row.netProfit) }));
}

function normalizeSellLocationLabel(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'Unspecified';
  const normalized = raw.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ');
  if (normalized === 'sint' || normalized === 'st' || normalized === 'saint') {
    return 'Sint Eustatius';
  }
  if (
    (normalized.includes('sint') || normalized.includes('saint') || normalized.includes('st ')) &&
    normalized.includes('eust')
  ) {
    return 'Sint Eustatius';
  }
  return raw;
}

function normalizeLegacyAmount(value) {
  const n = toMoney(value || 0);
  if (n <= 0) return n;
  // Legacy exporter occasionally introduced a 10x shift on very large values.
  if (n >= 120000) return toMoney(n / 10);
  return n;
}

function normalizeCargoName(value) {
  return String(value || '').trim().toUpperCase();
}

function isCrudeOilCargo(name) {
  const normalized = normalizeCargoName(name);
  return normalized.includes('CRUDE');
}

function isGasolineCargo(name) {
  const normalized = normalizeCargoName(name);
  return normalized.includes('GASOLINE');
}

function calcSettledDays(endedAt, settledAt) {
  if (!endedAt || !settledAt) return null;
  const ended = parseTimestamp(endedAt);
  const settled = parseTimestamp(settledAt);
  if (Number.isNaN(ended.getTime()) || Number.isNaN(settled.getTime())) return null;
  const diff = settled.getTime() - ended.getTime();
  if (diff < 0) return null;
  return diff / 86400000;
}

function parseTimestamp(value) {
  const raw = String(value || '').trim();
  if (!raw) return new Date(Number.NaN);
  const d1Match = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,3}))?$/);
  if (d1Match) {
    const ms = String(d1Match[3] || '0').padEnd(3, '0');
    return new Date(`${d1Match[1]}T${d1Match[2]}.${ms}Z`);
  }
  return new Date(raw);
}

function companyShareForVoyage(row) {
  const stored = Number(row?.company_share_amount);
  if (Number.isFinite(stored) && stored > 0) return Math.max(0, toMoney(stored));
  const legacy = Number(row?.company_share);
  if (Number.isFinite(legacy) && legacy > 0) return Math.max(0, toMoney(legacy));
  return Math.max(0, toMoney(Number(row?.profit || 0) * COMPANY_SHARE_RATE));
}

function grossRevenueForVoyage(row, settlementLines = []) {
  const lines = Array.isArray(settlementLines) ? settlementLines : [];
  const settlementGrossRevenue = toMoney(lines.reduce((sum, line) => sum + toMoney(line.lineRevenue || 0), 0));
  if (settlementGrossRevenue > 0) return settlementGrossRevenue;

  const storedEffectiveSell = Number(row?.effective_sell);
  if (Number.isFinite(storedEffectiveSell) && storedEffectiveSell > 0) {
    return Math.max(0, toMoney(storedEffectiveSell));
  }

  const legacyRevenue = Number(row?.legacy_revenue_florins);
  if (Number.isFinite(legacyRevenue) && legacyRevenue > 0) {
    return Math.max(0, toMoney(legacyRevenue));
  }

  return Math.max(0, toMoney(row?.profit || 0));
}

async function hasLegacyHistoryTable(env) {
  const row = await env.DB
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_voyage_history'")
    .first();
  return Boolean(row?.name);
}

async function hasLegacyFinanceEntriesTable(env) {
  const row = await env.DB
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_finance_entries'")
    .first();
  return Boolean(row?.name);
}

async function hasLegacySalariesTable(env) {
  const row = await env.DB
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'legacy_voyage_salaries'")
    .first();
  return Boolean(row?.name);
}

async function hasShipyardShipsTable(env) {
  const row = await env.DB
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'shipyard_ships'")
    .first();
  return Boolean(row?.name);
}

async function resolveAllTimeStart(env) {
  const [liveMinRow, hasLegacyHistory] = await Promise.all([
    env.DB
      .prepare(
        `SELECT MIN(v.ended_at) AS min_ended_at
         FROM voyages v
         WHERE COALESCE(NULLIF(TRIM(v.deleted_at), ''), NULL) IS NULL
           AND UPPER(COALESCE(v.status, '')) IN ('ENDED', 'CANCELLED')
           AND v.ended_at IS NOT NULL`
      )
      .first(),
    hasLegacyHistoryTable(env)
  ]);

  const candidates = [];
  if (liveMinRow?.min_ended_at) {
    const liveTime = Date.parse(String(liveMinRow.min_ended_at));
    if (Number.isFinite(liveTime)) candidates.push(new Date(liveTime));
  }

  if (hasLegacyHistory) {
    const legacyMinRow = await env.DB
      .prepare(
        `SELECT MIN(record_date) AS min_record_date
         FROM legacy_voyage_history`
      )
      .first();
    if (legacyMinRow?.min_record_date) {
      const legacyTime = Date.parse(`${String(legacyMinRow.min_record_date).trim()}T00:00:00.000Z`);
      if (Number.isFinite(legacyTime)) candidates.push(new Date(legacyTime));
    }
  }

  if (!candidates.length) return null;
  const first = candidates.sort((a, b) => a.getTime() - b.getTime())[0];
  first.setUTCHours(0, 0, 0, 0);
  return first;
}

function parseLegacyCatchTotal(catchSummary) {
  const text = String(catchSummary || '');
  if (!text) return 0;
  let total = 0;
  const matches = text.matchAll(/(^|,\s*)(\d+)\s+/g);
  for (const match of matches) {
    total += Math.max(0, Number(match?.[2] || 0));
  }
  return total;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requireFinancePermission(context, 'finances.view');
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const range = normalizeFinanceRange(url.searchParams.get('range'));
  const offset = Math.max(0, Math.min(12, Math.floor(Number(url.searchParams.get('offset')) || 0)));
  const tzOffsetMinutes = normalizeTzOffsetMinutes(url.searchParams.get('tzOffsetMinutes'));
  const unsettledScope = String(url.searchParams.get('unsettledScope') || 'all').toLowerCase() === 'range' ? 'range' : 'all';

  const rangeWindow = getFinanceRangeWindow(range, new Date(), tzOffsetMinutes);
  let { start, end } = shiftRangeWindow(range, rangeWindow.start, rangeWindow.end, offset);
  if (range === 'all') {
    const allTimeStart = await resolveAllTimeStart(env);
    if (allTimeStart && allTimeStart <= end) {
      start = allTimeStart;
    }
  }
  const startIso = start.toISOString();
  const endIso = end.toISOString();
  const localRangeStart = localByOffset(start, tzOffsetMinutes);
  const localRangeEnd = localByOffset(end, tzOffsetMinutes);
  const localStartDateOnly = isoDay(localRangeStart);
  const localEndDateOnly = isoDay(localRangeEnd);

  const [endedInRangeResult, legacyInRangeResult] = await Promise.all([
    env.DB
      .prepare(
        `SELECT
           v.id,
           ${VOYAGE_EVENT_AT_SQL} AS ended_at,
           v.profit,
           v.company_share,
           v.company_share_amount,
           v.effective_sell,
           COALESCE(v.company_share_status, 'UNSETTLED') AS company_share_status,
           v.company_share_settled_at,
           v.settlement_lines_json,
           v.departure_port,
           v.destination_port,
           v.sell_location_name,
           v.vessel_name,
           v.vessel_callsign,
           v.vessel_class,
           v.officer_of_watch_employee_id,
           e.roblox_username AS officer_name
         FROM voyages v
         LEFT JOIN employees e ON e.id = v.officer_of_watch_employee_id
         WHERE COALESCE(NULLIF(TRIM(v.deleted_at), ''), NULL) IS NULL
           AND UPPER(COALESCE(v.status, '')) IN ('ENDED', 'CANCELLED')
           AND ${VOYAGE_EVENT_AT_SQL} IS NOT NULL
           AND datetime(${VOYAGE_EVENT_AT_SQL}) >= datetime(?)
           AND datetime(${VOYAGE_EVENT_AT_SQL}) <= datetime(?)
         ORDER BY datetime(${VOYAGE_EVENT_AT_SQL}) ASC, v.id ASC`
      )
      .bind(startIso, endIso)
      .all(),
    hasLegacyHistoryTable(env)
      ? env.DB
          .prepare(
            `SELECT
               id,
               voyage_id,
               record_date,
               etd_time,
               skipper_username,
               arrival_port,
               status,
               revenue_florins,
               profit_florins,
               loss_florins
             FROM legacy_voyage_history
             WHERE record_date >= ? AND record_date <= ?
               AND status IN ('COMPLETED', 'CANCELLED')
             ORDER BY record_date ASC, etd_time ASC, voyage_id ASC`
          )
          .bind(localStartDateOnly, localEndDateOnly)
          .all()
      : Promise.resolve({ results: [] })
  ]);
  let endedInRange = endedInRangeResult?.results || [];
  if (!endedInRange.length) {
    const fallbackEndedRows = await env.DB
      .prepare(
        `SELECT
           v.id,
           ${VOYAGE_EVENT_AT_SQL} AS ended_at,
           v.profit,
           v.company_share,
           v.company_share_amount,
           v.effective_sell,
           COALESCE(v.company_share_status, 'UNSETTLED') AS company_share_status,
           v.company_share_settled_at,
           v.settlement_lines_json,
           v.departure_port,
           v.destination_port,
           v.sell_location_name,
           v.vessel_name,
           v.vessel_callsign,
           v.vessel_class,
           v.officer_of_watch_employee_id,
           e.roblox_username AS officer_name
         FROM voyages v
         LEFT JOIN employees e ON e.id = v.officer_of_watch_employee_id
         WHERE COALESCE(NULLIF(TRIM(v.deleted_at), ''), NULL) IS NULL
           AND UPPER(COALESCE(v.status, '')) IN ('ENDED', 'CANCELLED')
           AND ${VOYAGE_EVENT_AT_SQL} IS NOT NULL
         ORDER BY datetime(${VOYAGE_EVENT_AT_SQL}) ASC, v.id ASC`
      )
      .all();
    endedInRange = fallbackEndedRows?.results || [];
  }
  if (!endedInRange.length) {
    const ultraFallbackRows = await env.DB
      .prepare(
        `SELECT
           v.id,
           ${VOYAGE_EVENT_AT_SQL} AS ended_at,
           v.profit,
           v.company_share,
           v.company_share_amount,
           v.effective_sell,
           COALESCE(v.company_share_status, 'UNSETTLED') AS company_share_status,
           v.company_share_settled_at,
           v.settlement_lines_json,
           v.departure_port,
           v.destination_port,
           v.sell_location_name,
           v.vessel_name,
           v.vessel_callsign,
           v.vessel_class,
           v.officer_of_watch_employee_id,
           e.roblox_username AS officer_name
         FROM voyages v
         LEFT JOIN employees e ON e.id = v.officer_of_watch_employee_id
         WHERE ${VOYAGE_EVENT_AT_SQL} IS NOT NULL
         ORDER BY datetime(${VOYAGE_EVENT_AT_SQL}) ASC, v.id ASC`
      )
      .all();
    endedInRange = ultraFallbackRows?.results || [];
  }
  const legacyInRange = (legacyInRangeResult?.results || []).map((row) => {
    const date = String(row.record_date || '').trim();
    const time = String(row.etd_time || '').trim() || '00:00';
    const endedAt = date ? `${date}T${time}:00.000Z` : null;
    const revenue = normalizeLegacyAmount(row.revenue_florins || 0);
    const profit = normalizeLegacyAmount(row.profit_florins || 0);
    const freightLoss = Math.max(0, toMoney(row.loss_florins || 0));
    return {
      id: Number(row.id || 0) * -1,
      legacy_voyage_id: Number(row.voyage_id || 0),
      ended_at: endedAt,
      profit,
      legacy_revenue_florins: revenue,
      company_share: null,
      company_share_amount: null,
      effective_sell: revenue,
      company_share_status: 'SETTLED',
      company_share_settled_at: endedAt,
      settlement_lines_json: JSON.stringify([
        {
          cargoName: 'Legacy Cargo',
          lineRevenue: revenue,
          lineCost: Math.max(0, toMoney(revenue - profit)),
          netQuantity: 0,
          lostQuantity: 0,
          trueSellUnitPrice: 0,
          ownerName: String(row.skipper_username || '').trim() || 'Legacy'
        }
      ]),
      departure_port: String(row.arrival_port || '').trim(),
      destination_port: String(row.arrival_port || '').trim(),
      sell_location_name: String(row.arrival_port || '').trim(),
      vessel_name: `Legacy Voyage #${Number(row.voyage_id || 0) || Number(row.id || 0)}`,
      vessel_callsign: `LEGACY-${Number(row.voyage_id || 0) || Number(row.id || 0)}`,
      officer_of_watch_employee_id: null,
      officer_name: String(row.skipper_username || '').trim() || 'Legacy',
      legacy_freight_loss_value: freightLoss
    };
  });
  const allEndedInRange = [...endedInRange, ...legacyInRange];

  const bucketList = buildBuckets(range, start, end, tzOffsetMinutes);
  const buckets = new Map(
    bucketList.map((bucket) => [
      bucket.key,
      {
        label: bucket.label,
        netProfit: 0,
        grossRevenue: 0,
        freightCost: 0,
        companyShare: 0,
        crewShare: 0,
        freightLossValue: 0,
        voyageCount: 0,
        settledVoyageCount: 0
      }
    ])
  );

  let netProfitTotal = 0;
  let grossRevenueTotal = 0;
  let companyShareTotal = 0;
  let crewShareTotal = 0;
  let freightLossesValueTotal = 0;
  let companyShareSettledTotal = 0;
  let crudeSoldTotal = 0;
  let gasolineSoldTotal = 0;
  const settledAgesDays = [];

  const sellLocationProfit = new Map();
  const vesselProfit = new Map();
  const fleetVesselProfit = new Map();
  const voyageEarnings = new Map();
  const ootwProfit = new Map();
  const sellLocationEarnings = new Map();
  const vesselEarnings = new Map();
  const fleetVesselEarnings = new Map();
  const employeeEarnings = new Map();
  const fleetShipLabels = new Map();

  if (await hasShipyardShipsTable(env)) {
    const fleetShipsRows = await env.DB
      .prepare(
        `SELECT ship_name, vessel_class
         FROM shipyard_ships
         WHERE is_active = 1`
      )
      .all();
    (fleetShipsRows?.results || []).forEach((row) => {
      const shipName = String(row.ship_name || '').trim();
      const vesselClass = String(row.vessel_class || '').trim();
      if (!shipName || !vesselClass) return;
      const key = `${shipName.toLowerCase()}::${vesselClass.toLowerCase()}`;
      fleetShipLabels.set(key, `${shipName} | ${vesselClass}`);
    });
  }

  allEndedInRange.forEach((voyage) => {
    const endedAt = voyage.ended_at ? parseTimestamp(voyage.ended_at) : null;
    if (!endedAt || Number.isNaN(endedAt.getTime())) return;

    const bucket = bucketForDate(range, endedAt, start, tzOffsetMinutes);
    const target = buckets.get(bucket.key);
    if (!target) return;

    const netProfit = toMoney(voyage.profit || 0);
    const companyShare = companyShareForVoyage(voyage);
    const settlementLines = parseSettlementLines(voyage.settlement_lines_json);
    const grossRevenue = grossRevenueForVoyage(voyage, settlementLines);
    const crewShare = grossRevenue > 0 ? Math.max(0, toMoney(grossRevenue - companyShare)) : 0;
    const settlementFreightCost = toMoney(settlementLines.reduce((sum, line) => sum + toMoney(line.lineCost || 0), 0));
    const freightCost =
      settlementFreightCost > 0 ? settlementFreightCost : Math.max(0, toMoney(grossRevenue - Number(voyage.profit || 0)));
    const inferredLoss = Math.max(
      0,
      toMoney(
        settlementLines.reduce((sum, line) => {
          const unit = toMoney(line.trueSellUnitPrice || 0);
          const lostQty = Math.max(0, Number(line.lostQuantity || 0));
          return sum + toMoney(unit * lostQty);
        }, 0)
      )
    );
    const freightLossValue = Math.max(inferredLoss, Math.max(0, toMoney(voyage.legacy_freight_loss_value || 0)));

    settlementLines.forEach((line) => {
      const soldQty = Math.max(
        0,
        Number.isFinite(Number(line.netQuantity))
          ? Math.floor(Number(line.netQuantity))
          : Math.max(0, Math.floor(Number(line.quantity || 0)) - Math.floor(Number(line.lostQuantity || 0)))
      );
      if (soldQty <= 0) return;

      if (isCrudeOilCargo(line.cargoName)) {
        crudeSoldTotal += soldQty;
      } else if (isGasolineCargo(line.cargoName)) {
        gasolineSoldTotal += soldQty;
      }
    });

    target.netProfit = toMoney(target.netProfit + netProfit);
    target.grossRevenue = toMoney(target.grossRevenue + grossRevenue);
    target.freightCost = toMoney(target.freightCost + freightCost);
    target.companyShare = toMoney(target.companyShare + companyShare);
    target.crewShare = toMoney(target.crewShare + crewShare);
    target.freightLossValue = toMoney(target.freightLossValue + freightLossValue);
    target.voyageCount += 1;

    netProfitTotal = toMoney(netProfitTotal + netProfit);
    grossRevenueTotal = toMoney(grossRevenueTotal + grossRevenue);
    companyShareTotal = toMoney(companyShareTotal + companyShare);
    crewShareTotal = toMoney(crewShareTotal + crewShare);
    freightLossesValueTotal = toMoney(freightLossesValueTotal + freightLossValue);

    const shareStatus = String(voyage.company_share_status || 'UNSETTLED').trim().toUpperCase();
    if (shareStatus === 'SETTLED') {
      companyShareSettledTotal = toMoney(companyShareSettledTotal + companyShare);
      const settledDays = calcSettledDays(voyage.ended_at, voyage.company_share_settled_at);
      if (Number.isFinite(settledDays)) settledAgesDays.push(settledDays);
      target.settledVoyageCount += 1;
    }

    const sellLocationLabel = normalizeSellLocationLabel(voyage.sell_location_name || voyage.destination_port || voyage.departure_port);
    const vesselLabel = `${String(voyage.vessel_name || '').trim() || 'Unknown'} | ${String(voyage.vessel_callsign || '').trim() || 'N/A'}`;
    const officerLabel = String(voyage.officer_name || '').trim() || `#${Number(voyage.officer_of_watch_employee_id || 0) || 'Unknown'}`;

    addProfit(sellLocationProfit, sellLocationLabel, netProfit);
    addProfit(vesselProfit, vesselLabel, netProfit);
    addProfit(ootwProfit, officerLabel, netProfit);
    addProfit(sellLocationEarnings, sellLocationLabel, grossRevenue);
    addProfit(vesselEarnings, vesselLabel, grossRevenue);
    const fleetKey = `${String(voyage.vessel_name || '').trim().toLowerCase()}::${String(voyage.vessel_class || '').trim().toLowerCase()}`;
    const fleetLabel = fleetShipLabels.get(fleetKey);
    if (fleetLabel) {
      addProfit(fleetVesselProfit, fleetLabel, netProfit);
      addProfit(fleetVesselEarnings, fleetLabel, grossRevenue);
    }
    if (settlementLines.length) {
      settlementLines.forEach((line) => {
        const owner = String(line.ownerName || '').trim() || officerLabel;
        const ownerRevenue = Math.max(0, toMoney(line.lineRevenue || 0));
        if (ownerRevenue <= 0) return;
        addProfit(employeeEarnings, owner, ownerRevenue);
      });
    } else if (grossRevenue > 0) {
      addProfit(employeeEarnings, officerLabel, grossRevenue);
    }

    const liveVoyageId = Number(voyage.id || 0);
    const legacyVoyageId = Number(voyage.legacy_voyage_id || 0);
    const voyageLabel =
      liveVoyageId > 0
        ? `Voyage #${liveVoyageId}`
        : legacyVoyageId > 0
        ? `Voyage #${legacyVoyageId}`
        : `Legacy Voyage #${Math.abs(Number(voyage.id || 0)) || 0}`;
    addProfit(voyageEarnings, voyageLabel, grossRevenue);
  });

  const [fishKilledResult, legacySalaryRowsResult] = await Promise.all([
    env.DB
      .prepare(
        `SELECT COALESCE(SUM(CASE WHEN tl.quantity > 0 THEN tl.quantity ELSE 0 END), 0) AS total_fish
         FROM voyage_tote_lines tl
         INNER JOIN voyages v ON v.id = tl.voyage_id
         WHERE COALESCE(NULLIF(TRIM(v.deleted_at), ''), NULL) IS NULL
           AND UPPER(COALESCE(v.status, '')) IN ('ENDED', 'CANCELLED')
           AND v.ended_at IS NOT NULL
           AND v.ended_at >= ?
           AND v.ended_at <= ?`
      )
      .bind(startIso, endIso)
      .first(),
    hasLegacySalariesTable(env)
      ? env.DB
          .prepare(
            `SELECT catch_summary
             FROM legacy_voyage_salaries
             WHERE record_date >= ? AND record_date <= ?`
          )
          .bind(localStartDateOnly, localEndDateOnly)
          .all()
      : Promise.resolve({ results: [] })
  ]);
  const liveFishTotal = Math.max(0, Math.floor(Number(fishKilledResult?.total_fish || 0)));
  const legacyFishTotal = (legacySalaryRowsResult?.results || []).reduce(
    (sum, row) => sum + parseLegacyCatchTotal(row.catch_summary),
    0
  );
  const totalFishKilled = Math.max(0, Math.floor(liveFishTotal + legacyFishTotal));

  if (toMoney(netProfitTotal) === 0 && toMoney(companyShareTotal) === 0) {
    const emergencyTotals = await env.DB
      .prepare(
        `SELECT
           COUNT(*) AS voyage_count,
           ROUND(COALESCE(SUM(COALESCE(v.profit, 0)), 0)) AS net_profit_total,
           ROUND(COALESCE(SUM(COALESCE(v.company_share_amount, v.company_share, COALESCE(v.profit, 0) * ${COMPANY_SHARE_RATE})), 0)) AS company_share_total
         FROM voyages v
         WHERE COALESCE(NULLIF(TRIM(v.deleted_at), ''), NULL) IS NULL
           AND (
             UPPER(COALESCE(v.status, '')) IN ('ENDED', 'CANCELLED')
             OR ${VOYAGE_EVENT_AT_SQL} IS NOT NULL
           )`
      )
      .first();

    const emergencyNet = toMoney(emergencyTotals?.net_profit_total || 0);
    const emergencyCompanyShare = Math.max(0, toMoney(emergencyTotals?.company_share_total || 0));
    const emergencyCrewShare = Math.max(0, toMoney(emergencyNet - emergencyCompanyShare));
    const emergencyVoyages = Math.max(0, Number(emergencyTotals?.voyage_count || 0));

    if (emergencyVoyages > 0 || emergencyNet !== 0 || emergencyCompanyShare !== 0) {
      netProfitTotal = emergencyNet;
      companyShareTotal = emergencyCompanyShare;
      crewShareTotal = emergencyCrewShare;
    }
  }

  if (toMoney(grossRevenueTotal) === 0 && (toMoney(netProfitTotal) !== 0 || toMoney(companyShareTotal) !== 0)) {
    grossRevenueTotal = toMoney(companyShareTotal + crewShareTotal);
  }

  const settlementRatePct = companyShareTotal > 0 ? toMoney((companyShareSettledTotal / companyShareTotal) * 100) : 0;
  const avgDaysToSettle = settledAgesDays.length
    ? toMoney(settledAgesDays.reduce((sum, days) => sum + days, 0) / settledAgesDays.length)
    : null;
  let completedVoyagesCount = Number(allEndedInRange.length || 0);
  if (completedVoyagesCount === 0 && (toMoney(netProfitTotal) !== 0 || toMoney(companyShareTotal) !== 0)) {
    const emergencyCount = await env.DB
      .prepare(
        `SELECT COUNT(*) AS voyage_count
         FROM voyages v
         WHERE COALESCE(NULLIF(TRIM(v.deleted_at), ''), NULL) IS NULL
           AND (
             UPPER(COALESCE(v.status, '')) IN ('ENDED', 'CANCELLED')
             OR ${VOYAGE_EVENT_AT_SQL} IS NOT NULL
           )`
      )
      .first();
    completedVoyagesCount = Math.max(0, Number(emergencyCount?.voyage_count || 0));
  }
  const emissionsKg = toMoney(
    Math.max(0, crudeSoldTotal) * 430 +
      Math.max(0, gasolineSoldTotal) * 373 +
      Math.max(0, completedVoyagesCount) * 46
  );

  const unsettledBindings = [];
  let unsettledWhere = `COALESCE(NULLIF(TRIM(v.deleted_at), ''), NULL) IS NULL
    AND UPPER(COALESCE(v.status, '')) = 'ENDED'
    AND COALESCE(v.company_share_status, 'UNSETTLED') = 'UNSETTLED'
    AND ROUND(COALESCE(v.company_share_amount, v.company_share, ROUND(COALESCE(v.profit, 0) * ${COMPANY_SHARE_RATE}))) > 0`;

  if (unsettledScope === 'range') {
    unsettledWhere += ` AND ${VOYAGE_EVENT_AT_SQL} IS NOT NULL AND datetime(${VOYAGE_EVENT_AT_SQL}) >= datetime(?) AND datetime(${VOYAGE_EVENT_AT_SQL}) <= datetime(?)`;
    unsettledBindings.push(startIso, endIso);
  }

  const [unsettledRowsResult, legacyUnsettledRowsResult] = await Promise.all([
    env.DB
      .prepare(
        `SELECT
           v.id,
           ${VOYAGE_EVENT_AT_SQL} AS ended_at,
           v.profit,
           v.company_share,
           v.company_share_amount,
           v.officer_of_watch_employee_id,
           e.roblox_username AS officer_name,
           e.serial_number AS officer_serial
         FROM voyages v
         LEFT JOIN employees e ON e.id = v.officer_of_watch_employee_id
         WHERE ${unsettledWhere}
         ORDER BY v.profit DESC, datetime(${VOYAGE_EVENT_AT_SQL}) DESC, v.id DESC`
      )
      .bind(...unsettledBindings)
      .all(),
    hasLegacyFinanceEntriesTable(env)
      ? env.DB
          .prepare(
            `SELECT
               id,
               record_date,
               voyage_id,
               entry_type,
               from_username,
               to_username,
               amount_florins
             FROM legacy_finance_entries
             WHERE status = 'UNSOLVED'
               AND amount_florins > 0
               AND (
                 LOWER(COALESCE(entry_type, '')) LIKE '%profit cut%'
                 OR LOWER(COALESCE(to_username, '')) = 'codswallop'
               )
               ${unsettledScope === 'range' ? 'AND record_date >= ? AND record_date <= ?' : ''}
             ORDER BY record_date DESC, id DESC`
          )
          .bind(...(unsettledScope === 'range' ? [localStartDateOnly, localEndDateOnly] : []))
          .all()
      : Promise.resolve({ results: [] })
  ]);
  const liveUnsettledRows = unsettledRowsResult?.results || [];
  const legacyUnsettledRows = (legacyUnsettledRowsResult?.results || []).map((row) => ({
    id: Number(row.id || 0) * -1,
    ended_at: `${String(row.record_date || '').trim()}T00:00:00.000Z`,
    profit: Number(row.amount_florins || 0) * 5,
    company_share: Number(row.amount_florins || 0),
    company_share_amount: Number(row.amount_florins || 0),
    officer_of_watch_employee_id: null,
    officer_name: String(row.from_username || '').trim() || 'Unknown',
    officer_serial: '',
    isLegacyFinance: true
  }));
  const unsettledRows = [...liveUnsettledRows, ...legacyUnsettledRows];

  const unsettledTotal = Math.max(0, toMoney(unsettledRows.reduce((sum, row) => sum + companyShareForVoyage(row), 0)));
  const now = Date.now();
  const overdueVoyages = unsettledRows.reduce((count, row) => {
    const endedAt = row?.ended_at ? new Date(row.ended_at).getTime() : Number.NaN;
    if (!Number.isFinite(endedAt)) return count;
    return now - endedAt > 5 * 86400000 ? count + 1 : count;
  }, 0);

  const groupedDebts = new Map();
  unsettledRows.forEach((row) => {
    const key = Number(row.officer_of_watch_employee_id || 0) || `unknown-${row.officer_name || ''}`;
    if (!groupedDebts.has(key)) {
      groupedDebts.set(key, {
        officerEmployeeId: Number(row.officer_of_watch_employee_id || 0) || null,
        officerName: String(row.officer_name || 'Unknown').trim() || 'Unknown',
        officerSerial: String(row.officer_serial || '').trim(),
        outstanding: 0,
        voyageCount: 0
      });
    }
    const item = groupedDebts.get(key);
    item.outstanding = toMoney(item.outstanding + companyShareForVoyage(row));
    item.voyageCount += 1;
  });

  const topDebtors = [...groupedDebts.values()]
    .sort((a, b) => b.outstanding - a.outstanding || b.voyageCount - a.voyageCount || a.officerName.localeCompare(b.officerName))
    .slice(0, 5)
    .map((row) => ({ ...row, outstanding: toMoney(row.outstanding) }));

  const outstandingBaseRowsResult = await env.DB
    .prepare(
      `SELECT
         ${VOYAGE_EVENT_AT_SQL} AS ended_at,
         v.company_share_settled_at,
         v.profit,
         v.company_share,
         v.company_share_amount
       FROM voyages v
       WHERE COALESCE(NULLIF(TRIM(v.deleted_at), ''), NULL) IS NULL
         AND UPPER(COALESCE(v.status, '')) = 'ENDED'
         AND ${VOYAGE_EVENT_AT_SQL} IS NOT NULL
         AND datetime(${VOYAGE_EVENT_AT_SQL}) <= datetime(?)
         AND ROUND(COALESCE(v.company_share_amount, v.company_share, ROUND(COALESCE(v.profit, 0) * ${COMPANY_SHARE_RATE}))) > 0
       ORDER BY datetime(${VOYAGE_EVENT_AT_SQL}) ASC`
    )
    .bind(endIso)
    .all();
  const outstandingBaseRows = outstandingBaseRowsResult?.results || [];

  const outstandingCreatedByBucket = new Map();
  const outstandingSettledByBucket = new Map();
  let openingOutstanding = 0;

  outstandingBaseRows.forEach((row) => {
    const amount = companyShareForVoyage(row);
    if (amount <= 0) return;

    const endedAt = row?.ended_at ? new Date(row.ended_at) : null;
    if (!endedAt || Number.isNaN(endedAt.getTime())) return;

    const settledAt = row?.company_share_settled_at ? new Date(row.company_share_settled_at) : null;
    const settledTime = settledAt && !Number.isNaN(settledAt.getTime()) ? settledAt.getTime() : null;

    if (endedAt < start) {
      if (settledTime == null || settledAt > start) {
        openingOutstanding = toMoney(openingOutstanding + amount);
      }
    } else if (endedAt <= end) {
      const endedBucketKey = bucketForDate(range, endedAt, start, tzOffsetMinutes).key;
      if (buckets.has(endedBucketKey)) {
        const current = toMoney(outstandingCreatedByBucket.get(endedBucketKey) || 0);
        outstandingCreatedByBucket.set(endedBucketKey, toMoney(current + amount));
      }
    }

    if (settledTime != null && settledAt >= start && settledAt <= end) {
      const settledBucketKey = bucketForDate(range, settledAt, start, tzOffsetMinutes).key;
      if (buckets.has(settledBucketKey)) {
        const current = toMoney(outstandingSettledByBucket.get(settledBucketKey) || 0);
        outstandingSettledByBucket.set(settledBucketKey, toMoney(current + amount));
      }
    }
  });

  const chartBuckets = bucketList.map((bucket) => {
    const value = buckets.get(bucket.key) || {
      label: bucket.label,
      netProfit: 0,
      companyShare: 0,
      crewShare: 0,
      freightLossValue: 0,
      voyageCount: 0,
      settledVoyageCount: 0
    };

    const avgNetProfit = value.voyageCount > 0 ? toMoney(value.netProfit / value.voyageCount) : 0;
    const settlementRate = value.voyageCount > 0 ? toMoney((value.settledVoyageCount / value.voyageCount) * 100) : 0;
    return {
      key: bucket.key,
      label: value.label,
      netProfit: toMoney(value.netProfit),
      grossRevenue: toMoney(value.grossRevenue),
      freightCost: toMoney(value.freightCost),
      companyShare: toMoney(value.companyShare),
      crewShare: toMoney(value.crewShare),
      freightLossValue: Math.max(0, toMoney(value.freightLossValue)),
      avgNetProfit,
      voyageCount: Number(value.voyageCount || 0),
      settlementRate: Math.max(0, Math.min(100, settlementRate))
    };
  });

  if (chartBuckets.every((row) => Number(row.voyageCount || 0) === 0) && (toMoney(netProfitTotal) !== 0 || Number(completedVoyagesCount || 0) > 0)) {
    const targetIndex = Math.max(0, chartBuckets.length - 1);
    const target = chartBuckets[targetIndex];
    chartBuckets[targetIndex] = {
      ...target,
      netProfit: toMoney(netProfitTotal),
      grossRevenue: toMoney(grossRevenueTotal),
      companyShare: toMoney(companyShareTotal),
      crewShare: toMoney(crewShareTotal),
      voyageCount: Math.max(1, Number(completedVoyagesCount || 0)),
      avgNetProfit: Number(completedVoyagesCount || 0) > 0 ? toMoney(netProfitTotal / completedVoyagesCount) : toMoney(netProfitTotal)
    };
  }

  let runningOutstanding = Math.max(0, toMoney(openingOutstanding));
  const outstandingTrend = bucketList.map((bucket) => {
    const created = Math.max(0, toMoney(outstandingCreatedByBucket.get(bucket.key) || 0));
    const settled = Math.max(0, toMoney(outstandingSettledByBucket.get(bucket.key) || 0));
    runningOutstanding = Math.max(0, toMoney(runningOutstanding + created - settled));
    return { key: bucket.key, label: bucket.label, value: runningOutstanding };
  });

  const directRangeTotals = await env.DB
    .prepare(
      `SELECT
         COUNT(*) AS voyage_count,
         ROUND(COALESCE(SUM(COALESCE(v.profit, 0)), 0)) AS profit_total,
         ROUND(COALESCE(SUM(COALESCE(v.effective_sell, v.profit, 0)), 0)) AS gross_revenue_total,
         ROUND(COALESCE(SUM(COALESCE(v.company_share_amount, v.company_share, COALESCE(v.profit, 0) * ${COMPANY_SHARE_RATE})), 0)) AS company_share_total
       FROM voyages v
       WHERE COALESCE(NULLIF(TRIM(v.deleted_at), ''), NULL) IS NULL
         AND ${VOYAGE_EVENT_AT_SQL} IS NOT NULL
         AND datetime(${VOYAGE_EVENT_AT_SQL}) >= datetime(?)
         AND datetime(${VOYAGE_EVENT_AT_SQL}) <= datetime(?)`
    )
    .bind(startIso, endIso)
    .first();

  const directVoyageCount = Math.max(0, Number(directRangeTotals?.voyage_count || 0));
  const directNetProfit = toMoney(directRangeTotals?.profit_total || 0);
  const directGrossRevenue = toMoney(directRangeTotals?.gross_revenue_total || 0);
  const directCompanyShare = Math.max(0, toMoney(directRangeTotals?.company_share_total || 0));

  if (directVoyageCount > 0 || directNetProfit !== 0 || directGrossRevenue !== 0 || directCompanyShare !== 0) {
    netProfitTotal = directNetProfit;
    grossRevenueTotal = directGrossRevenue || Math.max(0, toMoney(directCompanyShare + crewShareTotal));
    companyShareTotal = directCompanyShare;
    crewShareTotal = Math.max(0, toMoney(grossRevenueTotal - directCompanyShare));
    if (completedVoyagesCount === 0) completedVoyagesCount = directVoyageCount;
  }

  return cachedJson(
    request,
    {
      range,
      offset,
      unsettledScope,
      kpis: {
        netProfit: toMoney(netProfitTotal),
        grossRevenue: toMoney(grossRevenueTotal),
        companyShareEarnings: toMoney(companyShareTotal),
        crewShare: toMoney(crewShareTotal),
        freightLossesValue: Math.max(0, toMoney(freightLossesValueTotal)),
        unsettledCompanyShareOutstanding: unsettledTotal,
        totalFishKilled,
        completedVoyages: completedVoyagesCount,
        settlementRatePct: Math.max(0, Math.min(100, toMoney(settlementRatePct))),
        avgDaysToSettle,
        emissionsKg,
        crudeSold: Math.max(0, Math.floor(crudeSoldTotal)),
        gasSold: Math.max(0, Math.floor(gasolineSoldTotal))
      },
      charts: {
        netProfitTrend: chartBuckets.map((row) => ({ key: row.key, label: row.label, value: row.netProfit })),
        grossRevenueTrend: chartBuckets.map((row) => ({ key: row.key, label: row.label, value: row.grossRevenue })),
        freightCostTrend: chartBuckets.map((row) => ({ key: row.key, label: row.label, value: row.freightCost })),
        companyShareTrend: chartBuckets.map((row) => ({ key: row.key, label: row.label, value: row.companyShare })),
        freightLossValueTrend: chartBuckets.map((row) => ({ key: row.key, label: row.label, value: row.freightLossValue })),
        voyageCountTrend: chartBuckets.map((row) => ({ key: row.key, label: row.label, value: row.voyageCount })),
        avgNetProfitTrend: chartBuckets.map((row) => ({ key: row.key, label: row.label, value: row.avgNetProfit })),
        settlementRateTrend: chartBuckets.map((row) => ({ key: row.key, label: row.label, value: row.settlementRate })),
        outstandingTrend
      },
      unsettled: {
        totalOutstanding: unsettledTotal,
        totalVoyages: unsettledRows.length,
        overdueVoyages,
        topDebtors
      },
      breakdowns: {
        byRoute: toSortedProfitRows(sellLocationProfit),
        bySellLocation: toSortedProfitRows(sellLocationProfit),
        byVessel: toSortedProfitRows(fleetVesselProfit),
        byOotw: toSortedProfitRows(ootwProfit)
      },
      topPerformers: {
        sellLocation: pickTop(sellLocationEarnings),
        voyage: pickTop(voyageEarnings),
        vessel: pickTop(fleetVesselEarnings),
        ootw: pickTop(employeeEarnings)
      },
      debugOverview: {
        startIso,
        endIso,
        endedInRangeCount: endedInRange.length,
        legacyInRangeCount: legacyInRange.length,
        allEndedInRangeCount: allEndedInRange.length,
        directVoyageCount,
        directNetProfit,
        directGrossRevenue,
        directCompanyShare
      }
    },
    { cacheControl: 'private, max-age=20, stale-while-revalidate=40' }
  );
}
