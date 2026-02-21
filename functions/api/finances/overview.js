import { cachedJson } from '../auth/_lib/auth.js';
import { getFinanceRangeWindow, normalizeFinanceRange, parseSettlementLines, requireFinancePermission, toMoney } from '../_lib/finances.js';

function isoDay(date) {
  return date.toISOString().slice(0, 10);
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
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

function bucketForDate(range, date, rangeStart) {
  if (range === 'week' || range === 'month') {
    return {
      key: isoDay(date),
      label: date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    };
  }

  if (range === '3m' || range === '6m') {
    const stepDays = range === '3m' ? 7 : 14;
    const base = startOfUtcWeek(rangeStart);
    const weekStart = startOfUtcWeek(date);
    const diffDays = Math.max(0, Math.floor((weekStart.getTime() - base.getTime()) / 86400000));
    const steppedDays = Math.floor(diffDays / stepDays) * stepDays;
    const bucketStart = addDays(base, steppedDays);
    return {
      key: isoDay(bucketStart),
      label: bucketStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' })
    };
  }

  const startOfMonth = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0, 0));
  return {
    key: monthKey(startOfMonth),
    label: startOfMonth.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' })
  };
}

function buildBuckets(range, start, end) {
  const buckets = [];

  if (range === 'week' || range === 'month') {
    let cursor = new Date(start.getTime());
    while (cursor <= end) {
      buckets.push({ key: isoDay(cursor), label: cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) });
      cursor = addDays(cursor, 1);
    }
    return buckets;
  }

  if (range === '3m' || range === '6m') {
    const stepDays = range === '3m' ? 7 : 14;
    let cursor = startOfUtcWeek(start);
    while (cursor <= end) {
      buckets.push({ key: isoDay(cursor), label: cursor.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }) });
      cursor = addDays(cursor, stepDays);
    }
    return buckets;
  }

  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1, 0, 0, 0, 0));
  while (cursor <= end) {
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
  const ended = new Date(endedAt);
  const settled = new Date(settledAt);
  if (Number.isNaN(ended.getTime()) || Number.isNaN(settled.getTime())) return null;
  const diff = settled.getTime() - ended.getTime();
  if (diff < 0) return null;
  return diff / 86400000;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requireFinancePermission(context, 'finances.view');
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const range = normalizeFinanceRange(url.searchParams.get('range'));
  const offset = Math.max(0, Math.min(12, Math.floor(Number(url.searchParams.get('offset')) || 0)));
  const unsettledScope = String(url.searchParams.get('unsettledScope') || 'all').toLowerCase() === 'range' ? 'range' : 'all';

  const rangeWindow = getFinanceRangeWindow(range);
  const { start, end } = shiftRangeWindow(range, rangeWindow.start, rangeWindow.end, offset);
  const startIso = start.toISOString();
  const endIso = end.toISOString();

  const endedInRangeResult = await env.DB
    .prepare(
      `SELECT
         v.id,
         v.ended_at,
         v.profit,
         v.company_share,
         v.company_share_amount,
         COALESCE(v.company_share_status, 'UNSETTLED') AS company_share_status,
         v.company_share_settled_at,
         v.settlement_lines_json,
         v.departure_port,
         v.destination_port,
         v.vessel_name,
         v.vessel_callsign,
         v.officer_of_watch_employee_id,
         e.roblox_username AS officer_name
       FROM voyages v
       LEFT JOIN employees e ON e.id = v.officer_of_watch_employee_id
       WHERE v.status = 'ENDED' AND v.ended_at IS NOT NULL
         AND v.ended_at >= ? AND v.ended_at <= ?
       ORDER BY v.ended_at ASC, v.id ASC`
    )
    .bind(startIso, endIso)
    .all();
  const endedInRange = endedInRangeResult?.results || [];

  const bucketList = buildBuckets(range, start, end);
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
  let companyShareTotal = 0;
  let crewShareTotal = 0;
  let freightLossesValueTotal = 0;
  let companyShareSettledTotal = 0;
  let crudeSoldTotal = 0;
  let gasolineSoldTotal = 0;
  const settledAgesDays = [];

  const routeProfit = new Map();
  const vesselProfit = new Map();
  const ootwProfit = new Map();

  endedInRange.forEach((voyage) => {
    const endedAt = voyage.ended_at ? new Date(voyage.ended_at) : null;
    if (!endedAt || Number.isNaN(endedAt.getTime())) return;

    const bucket = bucketForDate(range, endedAt, start);
    const target = buckets.get(bucket.key);
    if (!target) return;

    const netProfit = toMoney(voyage.profit || 0);
    const companyShare = Math.max(0, toMoney(voyage.company_share_amount ?? voyage.company_share ?? 0));
    const crewShare = netProfit > 0 ? toMoney(netProfit - companyShare) : 0;
    const settlementLines = parseSettlementLines(voyage.settlement_lines_json);
    const grossRevenue = toMoney(settlementLines.reduce((sum, line) => sum + toMoney(line.lineRevenue || 0), 0));
    const freightCost = toMoney(settlementLines.reduce((sum, line) => sum + toMoney(line.lineCost || 0), 0));
    const freightLossValue = Math.max(
      0,
      toMoney(
        settlementLines.reduce((sum, line) => {
          const unit = toMoney(line.trueSellUnitPrice || 0);
          const lostQty = Math.max(0, Number(line.lostQuantity || 0));
          return sum + toMoney(unit * lostQty);
        }, 0)
      )
    );

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

    const routeLabel = `${String(voyage.departure_port || '').trim() || 'Unknown'} \u2192 ${String(voyage.destination_port || '').trim() || 'Unknown'}`;
    const vesselLabel = `${String(voyage.vessel_name || '').trim() || 'Unknown'} | ${String(voyage.vessel_callsign || '').trim() || 'N/A'}`;
    const officerLabel = String(voyage.officer_name || '').trim() || `#${Number(voyage.officer_of_watch_employee_id || 0) || 'Unknown'}`;

    addProfit(routeProfit, routeLabel, netProfit);
    addProfit(vesselProfit, vesselLabel, netProfit);
    addProfit(ootwProfit, officerLabel, netProfit);
  });

  const settlementRatePct = companyShareTotal > 0 ? toMoney((companyShareSettledTotal / companyShareTotal) * 100) : 0;
  const avgDaysToSettle = settledAgesDays.length
    ? toMoney(settledAgesDays.reduce((sum, days) => sum + days, 0) / settledAgesDays.length)
    : null;
  const emissionsKg = toMoney(Math.max(0, crudeSoldTotal) * 430 + Math.max(0, gasolineSoldTotal) * 373);

  const unsettledBindings = [];
  let unsettledWhere = `v.status = 'ENDED' AND COALESCE(v.company_share_status, 'UNSETTLED') = 'UNSETTLED'
    AND ROUND(COALESCE(v.company_share_amount, v.company_share, 0)) > 0`;

  if (unsettledScope === 'range') {
    unsettledWhere += ' AND v.ended_at IS NOT NULL AND v.ended_at >= ? AND v.ended_at <= ?';
    unsettledBindings.push(startIso, endIso);
  }

  const unsettledRowsResult = await env.DB
    .prepare(
      `SELECT
         v.id,
         v.ended_at,
         ROUND(COALESCE(v.company_share_amount, v.company_share, 0)) AS company_share_amount,
         v.officer_of_watch_employee_id,
         e.roblox_username AS officer_name,
         e.serial_number AS officer_serial
       FROM voyages v
       LEFT JOIN employees e ON e.id = v.officer_of_watch_employee_id
       WHERE ${unsettledWhere}
       ORDER BY company_share_amount DESC, v.ended_at DESC, v.id DESC`
    )
    .bind(...unsettledBindings)
    .all();
  const unsettledRows = unsettledRowsResult?.results || [];

  const unsettledTotal = Math.max(0, toMoney(unsettledRows.reduce((sum, row) => sum + Number(row.company_share_amount || 0), 0)));
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
    item.outstanding = toMoney(item.outstanding + toMoney(row.company_share_amount || 0));
    item.voyageCount += 1;
  });

  const topDebtors = [...groupedDebts.values()]
    .sort((a, b) => b.outstanding - a.outstanding || b.voyageCount - a.voyageCount || a.officerName.localeCompare(b.officerName))
    .slice(0, 5)
    .map((row) => ({ ...row, outstanding: toMoney(row.outstanding) }));

  const outstandingBaseRowsResult = await env.DB
    .prepare(
      `SELECT
         v.ended_at,
         v.company_share_settled_at,
         ROUND(COALESCE(v.company_share_amount, v.company_share, 0)) AS company_share_amount
       FROM voyages v
       WHERE v.status = 'ENDED'
         AND v.ended_at IS NOT NULL
         AND v.ended_at <= ?
         AND ROUND(COALESCE(v.company_share_amount, v.company_share, 0)) > 0
       ORDER BY v.ended_at ASC`
    )
    .bind(endIso)
    .all();
  const outstandingBaseRows = outstandingBaseRowsResult?.results || [];

  const outstandingCreatedByBucket = new Map();
  const outstandingSettledByBucket = new Map();
  let openingOutstanding = 0;

  outstandingBaseRows.forEach((row) => {
    const amount = Math.max(0, toMoney(row.company_share_amount || 0));
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
      const endedBucketKey = bucketForDate(range, endedAt, start).key;
      if (buckets.has(endedBucketKey)) {
        const current = toMoney(outstandingCreatedByBucket.get(endedBucketKey) || 0);
        outstandingCreatedByBucket.set(endedBucketKey, toMoney(current + amount));
      }
    }

    if (settledTime != null && settledAt >= start && settledAt <= end) {
      const settledBucketKey = bucketForDate(range, settledAt, start).key;
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

  let runningOutstanding = Math.max(0, toMoney(openingOutstanding));
  const outstandingTrend = bucketList.map((bucket) => {
    const created = Math.max(0, toMoney(outstandingCreatedByBucket.get(bucket.key) || 0));
    const settled = Math.max(0, toMoney(outstandingSettledByBucket.get(bucket.key) || 0));
    runningOutstanding = Math.max(0, toMoney(runningOutstanding + created - settled));
    return { key: bucket.key, label: bucket.label, value: runningOutstanding };
  });

  return cachedJson(
    request,
    {
      range,
      offset,
      unsettledScope,
      kpis: {
        netProfit: toMoney(netProfitTotal),
        companyShareEarnings: toMoney(companyShareTotal),
        crewShare: toMoney(crewShareTotal),
        freightLossesValue: Math.max(0, toMoney(freightLossesValueTotal)),
        unsettledCompanyShareOutstanding: unsettledTotal,
        completedVoyages: Number(endedInRange.length || 0),
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
        byRoute: toSortedProfitRows(routeProfit),
        byVessel: toSortedProfitRows(vesselProfit),
        byOotw: toSortedProfitRows(ootwProfit)
      },
      topPerformers: {
        route: pickTop(routeProfit),
        vessel: pickTop(vesselProfit),
        ootw: pickTop(ootwProfit)
      }
    },
    { cacheControl: 'private, max-age=20, stale-while-revalidate=40' }
  );
}
