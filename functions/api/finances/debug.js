import { json } from '../auth/_lib/auth.js';
import { getFinanceRangeWindow, normalizeFinanceRange, normalizeTzOffsetMinutes, parseSettlementLines, requireFinancePermission, resolveVoyageCompanyShare, resolveVoyageEarnings, toMoney } from '../_lib/finances.js';

const COMPANY_SHARE_RATE = 0.1;
const VOYAGE_EVENT_AT_SQL = `COALESCE(NULLIF(TRIM(v.ended_at), ''), NULLIF(TRIM(v.updated_at), ''), NULLIF(TRIM(v.created_at), ''))`;

function normalizeCargoName(value) {
  return String(value || '').trim().toUpperCase();
}

function isCrudeOilCargo(name) {
  return normalizeCargoName(name).includes('CRUDE');
}

function isGasolineCargo(name) {
  return normalizeCargoName(name).includes('GASOLINE');
}

function normalizeSellLocationLabel(value) {
  const raw = String(value || '').trim();
  return raw || 'Unspecified';
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
  if (!entries.length) return { label: 'No data', netProfit: 0 };
  return entries[0];
}

function toSortedProfitRows(map) {
  return [...map.entries()]
    .map(([label, netProfit]) => ({ label: String(label || '').trim() || 'Unknown', netProfit: toMoney(netProfit || 0) }))
    .sort((a, b) => b.netProfit - a.netProfit || a.label.localeCompare(b.label))
    .map((row, index) => ({ rank: index + 1, label: row.label, netProfit: toMoney(row.netProfit) }));
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
  if (!safeOffset || range === 'all') return { start, end };
  if (range === 'week') return { start: addDays(start, safeOffset * -7), end: addDays(end, safeOffset * -7) };
  if (range === 'month') return { start: addMonths(start, safeOffset * -1), end: addMonths(end, safeOffset * -1) };
  if (range === '3m') return { start: addMonths(start, safeOffset * -3), end: addMonths(end, safeOffset * -3) };
  if (range === '6m') return { start: addMonths(start, safeOffset * -6), end: addMonths(end, safeOffset * -6) };
  return { start: addMonths(start, safeOffset * -12), end: addMonths(end, safeOffset * -12) };
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requireFinancePermission(context, 'finances.view');
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const range = normalizeFinanceRange(url.searchParams.get('range'));
  const offset = Math.max(0, Math.min(12, Math.floor(Number(url.searchParams.get('offset')) || 0)));
  const tzOffsetMinutes = normalizeTzOffsetMinutes(url.searchParams.get('tzOffsetMinutes'));
  const window = getFinanceRangeWindow(range, new Date(), tzOffsetMinutes);
  const shifted = shiftRangeWindow(range, window.start, window.end, offset);
  const startIso = shifted.start.toISOString();
  const endIso = shifted.end.toISOString();

  const [voyageStats, rangeStats, rangeVoyagesResult, unsettledRowsResult, statusStatsResult, recentRowsResult, tableStats] = await Promise.all([
    env.DB
      .prepare(
        `SELECT
           COUNT(*) AS voyage_total,
           SUM(CASE WHEN ${VOYAGE_EVENT_AT_SQL} IS NOT NULL THEN 1 ELSE 0 END) AS voyage_with_event_time,
           ROUND(COALESCE(SUM(COALESCE(v.profit, 0)), 0)) AS profit_total,
           ROUND(COALESCE(SUM(COALESCE(v.company_share_amount, v.company_share, COALESCE(v.profit, 0) * ${COMPANY_SHARE_RATE})), 0)) AS company_share_total,
           MIN(${VOYAGE_EVENT_AT_SQL}) AS min_event_at,
           MAX(${VOYAGE_EVENT_AT_SQL}) AS max_event_at
         FROM voyages v
         WHERE COALESCE(NULLIF(TRIM(v.deleted_at), ''), NULL) IS NULL`
      )
      .first(),
    env.DB
      .prepare(
        `SELECT
           COUNT(*) AS range_voyage_count,
           ROUND(COALESCE(SUM(COALESCE(v.profit, 0)), 0)) AS range_profit_total,
           ROUND(COALESCE(SUM(COALESCE(v.effective_sell, v.profit, 0)), 0)) AS range_gross_revenue_total,
           ROUND(COALESCE(SUM(COALESCE(v.company_share_amount, v.company_share, COALESCE(v.profit, 0) * ${COMPANY_SHARE_RATE})), 0)) AS range_company_share_total
         FROM voyages v
         WHERE COALESCE(NULLIF(TRIM(v.deleted_at), ''), NULL) IS NULL
           AND ${VOYAGE_EVENT_AT_SQL} IS NOT NULL
           AND datetime(${VOYAGE_EVENT_AT_SQL}) >= datetime(?)
           AND datetime(${VOYAGE_EVENT_AT_SQL}) <= datetime(?)`
      )
      .bind(startIso, endIso)
      .first(),
    env.DB
      .prepare(
        `SELECT
           v.id,
           ${VOYAGE_EVENT_AT_SQL} AS ended_at,
           v.profit,
           v.effective_sell,
           v.company_share,
           v.company_share_amount,
           v.settlement_lines_json,
           v.sell_location_name,
           v.destination_port,
           v.departure_port,
           v.vessel_name,
           v.vessel_callsign,
           e.roblox_username AS officer_name
         FROM voyages v
         LEFT JOIN employees e ON e.id = v.officer_of_watch_employee_id
         WHERE COALESCE(NULLIF(TRIM(v.deleted_at), ''), NULL) IS NULL
           AND ${VOYAGE_EVENT_AT_SQL} IS NOT NULL
           AND datetime(${VOYAGE_EVENT_AT_SQL}) >= datetime(?)
           AND datetime(${VOYAGE_EVENT_AT_SQL}) <= datetime(?)
         ORDER BY datetime(${VOYAGE_EVENT_AT_SQL}) ASC, v.id ASC`
      )
      .bind(startIso, endIso)
      .all(),
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
         WHERE COALESCE(NULLIF(TRIM(v.deleted_at), ''), NULL) IS NULL
           AND UPPER(COALESCE(v.status, '')) = 'ENDED'
           AND COALESCE(v.company_share_status, 'UNSETTLED') = 'UNSETTLED'
           AND ROUND(COALESCE(v.company_share_amount, v.company_share, ROUND(COALESCE(v.profit, 0) * ${COMPANY_SHARE_RATE}))) > 0
           AND ${VOYAGE_EVENT_AT_SQL} IS NOT NULL
         ORDER BY datetime(${VOYAGE_EVENT_AT_SQL}) DESC, v.id DESC`
      )
      .all(),
    env.DB
      .prepare(
        `SELECT UPPER(COALESCE(v.status, '')) AS status, COUNT(*) AS count
         FROM voyages v
         WHERE COALESCE(NULLIF(TRIM(v.deleted_at), ''), NULL) IS NULL
         GROUP BY UPPER(COALESCE(v.status, ''))
         ORDER BY count DESC`
      )
      .all(),
    env.DB
      .prepare(
        `SELECT
           v.id,
           v.status,
           v.ended_at,
           v.updated_at,
           v.created_at,
           v.profit,
           v.company_share_amount
         FROM voyages v
         WHERE COALESCE(NULLIF(TRIM(v.deleted_at), ''), NULL) IS NULL
         ORDER BY datetime(${VOYAGE_EVENT_AT_SQL}) DESC, v.id DESC
         LIMIT 8`
      )
      .all(),
    env.DB
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM voyage_tote_lines) AS tote_lines,
           (SELECT COUNT(*) FROM finance_cash_ledger_entries) AS cashflow_entries`
      )
      .first()
  ]);

  const rangeVoyages = rangeVoyagesResult?.results || [];
  const unsettledRows = unsettledRowsResult?.results || [];
  let freightLossValue = 0;
  let crudeSold = 0;
  let gasSold = 0;
  let grossRevenueTotal = 0;
  const sellLocationEarnings = new Map();
  const voyageEarnings = new Map();
  const employeeEarnings = new Map();
  const routeProfit = new Map();
  const vesselProfit = new Map();
  const ootwProfit = new Map();
  const netProfitTrend = [];
  const companyShareTrend = [];
  const freightLossTrend = [];
  const voyageCountTrend = [];
  const grossRevenueTrend = [];

  rangeVoyages.forEach((voyage) => {
    const lines = parseSettlementLines(voyage.settlement_lines_json);
    const netProfit = resolveVoyageEarnings(voyage, lines);
    const companyShare = resolveVoyageCompanyShare(voyage, lines, COMPANY_SHARE_RATE, netProfit);
    const routeLabel = normalizeSellLocationLabel(voyage.sell_location_name || voyage.destination_port || voyage.departure_port);
    const voyageLabel = `Voyage #${Number(voyage.id || 0)}`;
    const officerLabel = String(voyage.officer_name || '').trim() || 'Unknown';
    const vesselLabel = `${String(voyage.vessel_name || '').trim() || 'Unknown'} | ${String(voyage.vessel_callsign || '').trim() || 'N/A'}`;
    addProfit(sellLocationEarnings, routeLabel, netProfit);
    addProfit(voyageEarnings, voyageLabel, netProfit);
    addProfit(routeProfit, routeLabel, netProfit);
    addProfit(vesselProfit, vesselLabel, netProfit);
    addProfit(ootwProfit, officerLabel, netProfit);

    const voyageFreightLoss = Math.max(
      0,
      toMoney(
        lines.reduce((sum, line) => {
          const lostQty = Math.max(0, Number(line.lostQuantity || 0));
          const lostValue = Math.max(0, Number(line.lostValue || 0));
          if (lostValue > 0) return sum + toMoney(lostValue);
          const unit = Math.max(0, Number(line.trueSellUnitPrice || line.baseSellPrice || 0));
          return sum + toMoney(lostQty * unit);
        }, 0)
      )
    );
    const grossRevenue = netProfit;
    const pointKey = String(voyage.ended_at || `voyage-${Number(voyage.id || 0)}`);
    netProfitTrend.push({ key: pointKey, label: pointKey, value: netProfit });
    companyShareTrend.push({ key: pointKey, label: pointKey, value: companyShare });
    freightLossTrend.push({ key: pointKey, label: pointKey, value: voyageFreightLoss });
    voyageCountTrend.push({ key: pointKey, label: pointKey, value: 1 });
    grossRevenueTrend.push({ key: pointKey, label: pointKey, value: grossRevenue });
    grossRevenueTotal = toMoney(grossRevenueTotal + grossRevenue);

    if (lines.length) {
      lines.forEach((line) => {
        const owner = String(line.ownerName || '').trim() || officerLabel;
        const ownerRevenue = Math.max(0, toMoney(line.lineRevenue || 0));
        if (ownerRevenue > 0) addProfit(employeeEarnings, owner, ownerRevenue);

        const lostQty = Math.max(0, Number(line.lostQuantity || 0));
        const lostValue = Math.max(0, Number(line.lostValue || 0));
        if (lostValue > 0) freightLossValue = toMoney(freightLossValue + toMoney(lostValue));
        else {
          const unit = Math.max(0, Number(line.trueSellUnitPrice || line.baseSellPrice || 0));
          freightLossValue = toMoney(freightLossValue + toMoney(lostQty * unit));
        }

        const soldQty = Math.max(0, Number(line.netQuantity || Math.max(0, Number(line.quantity || 0) - lostQty)));
        if (isCrudeOilCargo(line.cargoName)) crudeSold += soldQty;
        else if (isGasolineCargo(line.cargoName)) gasSold += soldQty;
      });
    } else if (netProfit > 0) {
      addProfit(employeeEarnings, officerLabel, netProfit);
    }
  });

  const completedVoyages = Math.max(0, Number(rangeStats?.range_voyage_count || 0));
  const emissionsKg = toMoney(Math.max(0, crudeSold) * 430 + Math.max(0, gasSold) * 373 + Math.max(0, completedVoyages) * 46);
  const unsettledTotal = Math.max(
    0,
    toMoney(
      unsettledRows.reduce((sum, row) => {
        const settlementLines = parseSettlementLines(row.settlement_lines_json);
        const fallbackShare = resolveVoyageEarnings(row, settlementLines);
        const amount = resolveVoyageCompanyShare(row, settlementLines, COMPANY_SHARE_RATE, fallbackShare);
        return sum + amount;
      }, 0)
    )
  );
  const now = Date.now();
  const overdueVoyages = unsettledRows.reduce((count, row) => {
    const endedAt = row?.ended_at ? new Date(row.ended_at).getTime() : Number.NaN;
    if (!Number.isFinite(endedAt)) return count;
    return now - endedAt > 5 * 86400000 ? count + 1 : count;
  }, 0);
  const debtByOfficer = new Map();
  unsettledRows.forEach((row) => {
    const key = Number(row.officer_of_watch_employee_id || 0) || `unknown:${String(row.officer_name || '').trim()}`;
    if (!debtByOfficer.has(key)) {
      debtByOfficer.set(key, {
        officerEmployeeId: Number(row.officer_of_watch_employee_id || 0) || null,
        officerName: String(row.officer_name || 'Unknown').trim() || 'Unknown',
        officerSerial: String(row.officer_serial || '').trim(),
        outstanding: 0,
        voyageCount: 0
      });
    }
    const entry = debtByOfficer.get(key);
    const settlementLines = parseSettlementLines(row.settlement_lines_json);
    const fallbackShare = resolveVoyageEarnings(row, settlementLines);
    const amount = resolveVoyageCompanyShare(row, settlementLines, COMPANY_SHARE_RATE, fallbackShare);
    entry.outstanding = toMoney(entry.outstanding + amount);
    entry.voyageCount += 1;
  });
  const topDebtors = [...debtByOfficer.values()]
    .sort((a, b) => b.outstanding - a.outstanding || b.voyageCount - a.voyageCount || a.officerName.localeCompare(b.officerName))
    .slice(0, 5);

  const fallbackOverview = {
    kpis: {
      netProfit: toMoney(netProfitTrend.reduce((sum, point) => sum + Number(point.value || 0), 0)),
      grossRevenue: toMoney(grossRevenueTotal),
      companyShareEarnings: Math.max(0, toMoney(rangeStats?.range_company_share_total || 0)),
      crewShare: Math.max(0, toMoney(grossRevenueTotal - Number(rangeStats?.range_company_share_total || 0))),
      completedVoyages,
      freightLossesValue: Math.max(0, toMoney(freightLossValue)),
      emissionsKg,
      crudeSold: Math.max(0, Math.floor(crudeSold)),
      gasSold: Math.max(0, Math.floor(gasSold))
    },
    topPerformers: {
      sellLocation: pickTop(sellLocationEarnings),
      voyage: pickTop(voyageEarnings),
      ootw: pickTop(employeeEarnings)
    },
    charts: {
      netProfitTrend,
      companyShareTrend,
      freightLossValueTrend: freightLossTrend,
      voyageCountTrend,
      grossRevenueTrend,
      avgNetProfitTrend: (() => {
        let cumulative = 0;
        return netProfitTrend.map((point, index) => {
          cumulative = toMoney(cumulative + Number(point.value || 0));
          return {
            key: point.key,
            label: point.label,
            value: toMoney(cumulative / Math.max(1, index + 1))
          };
        });
      })(),
      outstandingTrend: companyShareTrend
    },
    breakdowns: {
      byRoute: toSortedProfitRows(routeProfit),
      byVessel: toSortedProfitRows(vesselProfit),
      byOotw: toSortedProfitRows(ootwProfit)
    },
    unsettled: {
      totalOutstanding: unsettledTotal,
      totalVoyages: unsettledRows.length,
      overdueVoyages,
      topDebtors
    }
  };

  return json({
    ok: true,
    dbBinding: 'DB',
    dbIdHint: '70582565-bf09-43a5-b471-f0d1b845eab5',
    nowUtc: new Date().toISOString(),
    request: {
      range,
      offset,
      tzOffsetMinutes,
      startIso,
      endIso
    },
    voyageStats: {
      voyageTotal: Number(voyageStats?.voyage_total || 0),
      voyageWithEventTime: Number(voyageStats?.voyage_with_event_time || 0),
      profitTotal: toMoney(voyageStats?.profit_total || 0),
      companyShareTotal: toMoney(voyageStats?.company_share_total || 0),
      minEventAt: voyageStats?.min_event_at || null,
      maxEventAt: voyageStats?.max_event_at || null
    },
    rangeStats: {
      rangeVoyageCount: Number(rangeStats?.range_voyage_count || 0),
      rangeProfitTotal: toMoney(rangeStats?.range_profit_total || 0),
      rangeGrossRevenueTotal: toMoney(rangeStats?.range_gross_revenue_total || 0),
      rangeCompanyShareTotal: toMoney(rangeStats?.range_company_share_total || 0)
    },
    tableStats: {
      toteLines: Number(tableStats?.tote_lines || 0),
      cashflowEntries: Number(tableStats?.cashflow_entries || 0)
    },
    fallbackOverview,
    statusStats: statusStatsResult?.results || [],
    recentVoyages: recentRowsResult?.results || []
  });
}




