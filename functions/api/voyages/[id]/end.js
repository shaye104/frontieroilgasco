import { json } from '../../auth/_lib/auth.js';
import { canManageVoyage, getVoyageBase, requireVoyagePermission, toMoney } from '../../_lib/voyages.js';

const COMPANY_SHARE_RATE = 0.1;
const CREW_DUE_TO_SKIPPER_RATE = 0.1;

function toPositiveInt(value) {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function toPositiveIntSet(values) {
  if (!Array.isArray(values)) return new Set();
  const out = new Set();
  values.forEach((value) => {
    const id = toPositiveInt(value);
    if (id) out.add(id);
  });
  return out;
}

function toLostQuantityMap(values) {
  const out = new Map();
  if (!Array.isArray(values)) return out;
  values.forEach((row) => {
    const toteId = toPositiveInt(row?.toteId);
    if (!toteId) return;
    const qtyRaw = Number(row?.lostQuantity);
    const qty = Number.isFinite(qtyRaw) ? Math.max(0, Math.floor(qtyRaw)) : 0;
    if (qty > 0) out.set(toteId, qty);
  });
  return out;
}

function toNonNegativeMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.max(0, toMoney(n));
}

function toSettlementPriceMap(input) {
  const out = new Map();
  if (!Array.isArray(input)) return out;
  input.forEach((row) => {
    const toteId = toPositiveInt(row?.toteId);
    const baseSellPrice = toNonNegativeMoney(row?.baseSellPrice);
    if (!toteId || baseSellPrice === null) return;
    out.set(toteId, baseSellPrice);
  });
  return out;
}

export async function onRequestPost(context) {
  const { env, params } = context;
  const { errorResponse, employee, session } = await requireVoyagePermission(context, 'voyages.end');
  if (errorResponse) return errorResponse;

  const voyageId = Number(params.id);
  if (!Number.isInteger(voyageId) || voyageId <= 0) return json({ error: 'Invalid voyage id.' }, 400);

  const voyage = await getVoyageBase(env, voyageId);
  if (!voyage) return json({ error: 'Voyage not found.' }, 404);
  if (String(voyage.status) !== 'ONGOING') return json({ error: 'Voyage is already ended.' }, 400);
  if (!canManageVoyage(session, employee, voyage, 'voyages.end')) {
    return json({ error: 'Only the voyage Officer of the Watch (OOTW) (or voyage override) can end voyage.' }, 403);
  }

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const requestedSellLocationId = toPositiveInt(payload?.sellLocationId);
  let selectedLocation = null;
  if (requestedSellLocationId) {
    selectedLocation = await env.DB
      .prepare(
        `SELECT id, name, linked_port
         FROM config_sell_locations
         WHERE id = ? AND active = 1
         LIMIT 1`
      )
      .bind(requestedSellLocationId)
      .first();
    if (!selectedLocation) return json({ error: 'Selected sell location is invalid.' }, 400);
  }

  const sellMultiplier = Number(payload?.sellMultiplier || 1);
  if (!Number.isFinite(sellMultiplier) || sellMultiplier < 0) return json({ error: 'Sell multiplier must be >= 0.' }, 400);
  const lostToteIds = toPositiveIntSet(payload?.lostToteIds);
  const lostQtyByToteId = toLostQuantityMap(payload?.lostRows);
  const settlementPriceByToteId = toSettlementPriceMap(payload?.settlementRows);

  const toteRows = await env.DB
    .prepare(
      `SELECT
         vtl.id,
         vtl.owner_employee_id,
         e.roblox_username AS owner_name,
         vtl.fish_type_id,
         COALESCE(cft.name, vtl.fish_name_snapshot) AS fish_name,
         vtl.quantity,
         COALESCE(cft.unit_price, vtl.unit_price_snapshot, 0) AS unit_price
       FROM voyage_tote_lines vtl
       LEFT JOIN employees e ON e.id = vtl.owner_employee_id
       LEFT JOIN config_fish_types cft ON cft.id = vtl.fish_type_id
       WHERE vtl.voyage_id = ?
       ORDER BY vtl.id ASC`
    )
    .bind(voyageId)
    .all();
  const toteEntries = toteRows?.results || [];
  if (!toteEntries.length) return json({ error: 'At least one cargo entry is required to end the voyage.' }, 400);

  const settlementLines = toteEntries
    .map((row) => {
      const ownerEmployeeId = Number(row.owner_employee_id);
      const fishTypeId = Number(row.fish_type_id);
      const quantity = Math.max(0, Math.floor(Number(row.quantity || 0)));
      const buyUnitPrice = toMoney(row.unit_price || 0);
      const baseSellPrice = settlementPriceByToteId.has(Number(row.id))
        ? Number(settlementPriceByToteId.get(Number(row.id)))
        : buyUnitPrice;
      const rowBuyTotal = toMoney(quantity * buyUnitPrice);
      const rowFinalTotal = toMoney(quantity * baseSellPrice * sellMultiplier);
      const requestedLost = lostQtyByToteId.has(Number(row.id))
        ? Number(lostQtyByToteId.get(Number(row.id)))
        : lostToteIds.has(Number(row.id))
        ? quantity
        : 0;
      const lostQuantity = Math.max(0, Math.min(quantity, Math.floor(Number(requestedLost || 0))));
      const netQuantity = Math.max(0, quantity - lostQuantity);
      const lostValue = toMoney(lostQuantity * baseSellPrice * sellMultiplier);
      const isLost = lostQuantity > 0;
      const lostReimbursement = isLost ? toMoney(lostQuantity * buyUnitPrice) : 0;
      const rowNetFinalTotal = Math.max(0, toMoney(rowFinalTotal - lostValue));
      return {
        toteId: Number(row.id),
        ownerEmployeeId,
        ownerName: String(row.owner_name || '').trim() || `Employee #${ownerEmployeeId}`,
        fishTypeId,
        fishName: String(row.fish_name || '').trim() || `Cargo #${fishTypeId}`,
        quantity,
        netQuantity,
        isLost,
        lostQuantity,
        lostValue,
        lostReimbursement,
        buyUnitPrice,
        baseSellPrice,
        trueSellUnitPrice: baseSellPrice,
        sellMultiplier: Number(sellMultiplier),
        rowBuyTotal,
        rowFinalTotal,
        rowNetFinalTotal
      };
    })
    .filter((line) => line.ownerEmployeeId > 0 && line.fishTypeId > 0 && line.quantity > 0);
  if (!settlementLines.length) {
    return json({ error: 'At least one completed cargo entry (owner, cargo, qty > 0) is required to end the voyage.' }, 400);
  }

  const ownerSummaryMap = new Map();
  settlementLines.forEach((line) => {
    const key = Number(line.ownerEmployeeId);
    const existing = ownerSummaryMap.get(key) || {
      ownerEmployeeId: key,
      ownerName: line.ownerName,
      toteCount: 0,
      totalQuantity: 0,
      lostQuantity: 0,
      reimbursementTotal: 0,
      grossTotal: 0,
      payableTotal: 0
    };
    existing.toteCount += 1;
    existing.totalQuantity += Number(line.quantity || 0);
    existing.lostQuantity += Number(line.lostQuantity || 0);
    existing.reimbursementTotal = toMoney(existing.reimbursementTotal + Number(line.lostReimbursement || 0));
    existing.grossTotal = toMoney(existing.grossTotal + Number(line.rowNetFinalTotal || 0));
    ownerSummaryMap.set(key, existing);
  });

  const skipperEmployeeId = Number(voyage.officer_of_watch_employee_id || 0);
  const ownerSettlements = [...ownerSummaryMap.values()]
    .map((owner) => ({
      ...owner,
      payableTotal:
        skipperEmployeeId > 0 && Number(owner.ownerEmployeeId) === skipperEmployeeId
          ? 0
          : Math.max(0, toMoney(Number(owner.grossTotal || 0) * CREW_DUE_TO_SKIPPER_RATE))
    }))
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName));
  const totalFishQuantity = Math.round(settlementLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0));
  const totalBuy = toMoney(settlementLines.reduce((sum, line) => sum + Number(line.rowBuyTotal || 0), 0));
  const totalLostValue = toMoney(
    settlementLines.reduce((sum, line) => sum + Number(line.lostValue || 0) + Number(line.lostReimbursement || 0), 0)
  );
  const totalReimbursements = toMoney(settlementLines.reduce((sum, line) => sum + Number(line.lostReimbursement || 0), 0));
  const totalGrossEarnings = toMoney(settlementLines.reduce((sum, line) => sum + Number(line.rowNetFinalTotal || 0), 0));
  const totalCrewDuesToSkipper = toMoney(ownerSettlements.reduce((sum, owner) => sum + Number(owner.payableTotal || 0), 0));
  const voyageProfit = toMoney(totalGrossEarnings);
  const companyShareAmount = Math.max(0, toMoney(totalGrossEarnings * COMPANY_SHARE_RATE));
  const destinationPort = String(selectedLocation?.linked_port || '').trim() || String(voyage.destination_port || '').trim();

  await env.DB.batch([
    ...settlementLines.map((line) =>
      env.DB
        .prepare(
          `UPDATE voyage_tote_lines
           SET unit_price_snapshot = ?, sell_multiplier_snapshot = ?, row_base_total = ?, row_final_total = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND voyage_id = ?`
        )
        .bind(line.buyUnitPrice, sellMultiplier, line.rowBuyTotal, line.rowFinalTotal, line.toteId, voyageId)
    ),
    env.DB
      .prepare(
        `UPDATE voyages
         SET status = 'ENDED',
             sell_multiplier = ?,
             sell_location_id = ?,
             sell_location_name = ?,
             destination_port = ?,
             buy_total = ?,
             effective_sell = ?,
             profit = ?,
             company_share = ?,
             company_share_amount = ?,
             total_fish_quantity = ?,
             total_payable_amount = ?,
             settlement_lines_json = ?,
             settlement_owner_totals_json = ?,
             company_share_status = 'UNSETTLED',
             company_share_settled_at = NULL,
             company_share_settled_by_employee_id = NULL,
             company_share_settled_by_discord_id = NULL,
             ended_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
        .bind(
        sellMultiplier,
        selectedLocation?.id || null,
        selectedLocation?.name || null,
        destinationPort,
        totalBuy,
        totalGrossEarnings,
        voyageProfit,
        companyShareAmount,
        companyShareAmount,
        totalFishQuantity,
        companyShareAmount,
        JSON.stringify(settlementLines),
        JSON.stringify(ownerSettlements),
        voyageId
      )
  ]);

  return json({
    ok: true,
    sellLocation: selectedLocation
      ? {
          id: Number(selectedLocation.id),
          name: String(selectedLocation.name || '').trim(),
          linkedPort: String(selectedLocation.linked_port || '').trim(),
          multiplier: Number(sellMultiplier || 1)
        }
      : null,
    totals: {
      totalFishQuantity,
      totalGrossEarnings,
      totalPayable: companyShareAmount,
      totalCrewDuesToSkipper,
      totalBuy,
      totalLostValue,
      totalReimbursements,
      voyageProfit,
      companyShareAmount
    },
    ownerSettlements,
    settlementLines
  });
}

