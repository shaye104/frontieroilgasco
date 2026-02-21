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

  const endedInRangeQuery = await env.DB
    .prepare(
      `SELECT id, ended_at, profit, company_share, company_share_amount, settlement_lines_json
       FROM voyages
       WHERE status = 'ENDED' AND ended_at IS NOT NULL
         AND ended_at >= ? AND ended_at <= ?
       ORDER BY ended_at ASC, id ASC`
    )
    .bind(startIso, endIso)
    .all();
  const endedInRange = endedInRangeQuery?.results || [];

  const bucketList = buildBuckets(range, start, end);
  const buckets = new Map(
    bucketList.map((bucket) => [
      bucket.key,
      {
        label: bucket.label,
        netProfit: 0,
        companyShare: 0,
        crewShare: 0,
        freightLossValue: 0,
        voyageCount: 0
      }
    ])
  );

  let netProfitTotal = 0;
  let companyShareTotal = 0;
  let crewShareTotal = 0;
  let freightLossesValueTotal = 0;

  endedInRange.forEach((voyage) => {
    const endedAt = voyage.ended_at ? new Date(voyage.ended_at) : null;
    if (!endedAt || Number.isNaN(endedAt.getTime())) return;
    const bucket = bucketForDate(range, endedAt, start);
    const target = buckets.get(bucket.key);
    if (!target) return;

    const netProfit = toMoney(voyage.profit || 0);
    const companyShare = toMoney(voyage.company_share_amount ?? voyage.company_share ?? 0);
    const crewShare = netProfit > 0 ? toMoney(netProfit - companyShare) : 0;
    const settlementLines = parseSettlementLines(voyage.settlement_lines_json);
    const freightLossValue = Math.max(
      0,
      toMoney(settlementLines.reduce((sum, line) => sum + toMoney(line.trueSellUnitPrice * line.lostQuantity), 0))
    );

    target.netProfit += netProfit;
    target.companyShare += companyShare;
    target.crewShare += crewShare;
    target.freightLossValue += freightLossValue;
    target.voyageCount += 1;

    netProfitTotal += netProfit;
    companyShareTotal += companyShare;
    crewShareTotal += crewShare;
    freightLossesValueTotal += freightLossValue;
  });

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
  const grouped = new Map();
  unsettledRows.forEach((row) => {
    const key = Number(row.officer_of_watch_employee_id || 0) || `unknown-${row.officer_name || ''}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        officerEmployeeId: Number(row.officer_of_watch_employee_id || 0) || null,
        officerName: String(row.officer_name || 'Unknown').trim() || 'Unknown',
        officerSerial: String(row.officer_serial || '').trim(),
        outstanding: 0,
        voyageCount: 0
      });
    }
    const item = grouped.get(key);
    item.outstanding += toMoney(row.company_share_amount || 0);
    item.voyageCount += 1;
  });

  const topDebtors = [...grouped.values()]
    .sort((a, b) => b.outstanding - a.outstanding || b.voyageCount - a.voyageCount || a.officerName.localeCompare(b.officerName))
    .slice(0, 5)
    .map((row) => ({ ...row, outstanding: toMoney(row.outstanding) }));

  const chartBuckets = bucketList.map((bucket) => {
    const value = buckets.get(bucket.key) || {
      label: bucket.label,
      netProfit: 0,
      companyShare: 0,
      crewShare: 0,
      freightLossValue: 0,
      voyageCount: 0
    };
    return {
      key: bucket.key,
      label: value.label,
      netProfit: toMoney(value.netProfit),
      companyShare: toMoney(value.companyShare),
      crewShare: toMoney(value.crewShare),
      freightLossValue: toMoney(value.freightLossValue),
      avgNetProfit: value.voyageCount > 0 ? toMoney(value.netProfit / value.voyageCount) : 0,
      voyageCount: value.voyageCount
    };
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
        completedVoyages: Number(endedInRange.length || 0)
      },
      charts: {
        netProfitTrend: chartBuckets.map((row) => ({ key: row.key, label: row.label, value: row.netProfit })),
        companyShareTrend: chartBuckets.map((row) => ({ key: row.key, label: row.label, value: row.companyShare })),
        freightLossValueTrend: chartBuckets.map((row) => ({ key: row.key, label: row.label, value: row.freightLossValue })),
        avgNetProfitTrend: chartBuckets.map((row) => ({ key: row.key, label: row.label, value: row.avgNetProfit }))
      },
      unsettled: {
        totalOutstanding: unsettledTotal,
        totalVoyages: unsettledRows.length,
        topDebtors
      }
    },
    { cacheControl: 'private, max-age=20, stale-while-revalidate=40' }
  );
}
