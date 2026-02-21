import { json } from '../../auth/_lib/auth.js';
import { hasPermission } from '../../_lib/permissions.js';
import { getVoyageBase, getVoyageDetail, requireVoyagePermission, toMoney } from '../../_lib/voyages.js';

function normalizeCargoLost(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      cargoTypeId: Number(item?.cargoTypeId),
      lostQuantity: Number(item?.lostQuantity)
    }))
    .filter((item) => Number.isInteger(item.cargoTypeId) && item.cargoTypeId > 0);
}

function normalizeBaseSellPrices(items) {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => ({
      cargoTypeId: Number(item?.cargoTypeId),
      baseSellPrice: Number(item?.baseSellPrice)
    }))
    .filter((item) => Number.isInteger(item.cargoTypeId) && item.cargoTypeId > 0);
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
  if (Number(voyage.owner_employee_id) !== Number(employee.id) || !hasPermission(session, 'voyages.end')) {
    return json({ error: 'Only voyage owner can end voyage.' }, 403);
  }

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const sellMultiplier = Number(payload?.sellMultiplier);
  if (!Number.isFinite(sellMultiplier) || sellMultiplier < 0) return json({ error: 'Sell multiplier must be >= 0.' }, 400);

  const detail = await getVoyageDetail(env, voyageId);
  const manifestByCargo = new Map((detail?.manifest || []).map((line) => [Number(line.cargo_type_id), Number(line.quantity || 0)]));
  const manifestNameByCargo = new Map((detail?.manifest || []).map((line) => [Number(line.cargo_type_id), String(line.cargo_name || `Cargo #${line.cargo_type_id}`)]));
  const manifestBuyPriceByCargo = new Map((detail?.manifest || []).map((line) => [Number(line.cargo_type_id), Number(line.buy_price || 0)]));
  const cargoLostRaw = normalizeCargoLost(payload?.cargoLost || []);
  const baseSellPricesRaw = normalizeBaseSellPrices(payload?.baseSellPrices || []);
  const baseSellPriceByCargo = new Map();
  try {
    baseSellPricesRaw.forEach((entry) => {
      const manifestQty = manifestByCargo.get(entry.cargoTypeId);
      if (!Number.isInteger(manifestQty) || manifestQty <= 0) throw new Error('Base sell price contains cargo not in manifest.');
      if (!Number.isFinite(entry.baseSellPrice) || entry.baseSellPrice < 0) throw new Error('Base sell price must be >= 0.');
      baseSellPriceByCargo.set(entry.cargoTypeId, entry.baseSellPrice);
    });
  } catch (error) {
    return json({ error: error.message || 'Invalid base sell prices input.' }, 400);
  }
  let cargoLost = [];
  try {
    cargoLost = cargoLostRaw.map((loss) => {
      const manifestQty = manifestByCargo.get(loss.cargoTypeId);
      if (!Number.isInteger(manifestQty)) throw new Error('Freight loss adjustment contains cargo not in manifest.');
      if (!Number.isInteger(loss.lostQuantity) || loss.lostQuantity < 0) throw new Error('Freight loss adjustment quantity must be >= 0.');
      if (loss.lostQuantity > manifestQty) throw new Error('Freight loss adjustment quantity cannot exceed manifest quantity.');
      const line = (detail?.manifest || []).find((entry) => Number(entry.cargo_type_id) === Number(loss.cargoTypeId));
      return {
        cargoTypeId: loss.cargoTypeId,
        cargoName: line?.cargo_name || `Cargo #${loss.cargoTypeId}`,
        manifestQuantity: manifestQty,
        lostQuantity: loss.lostQuantity
      };
    });
  } catch (error) {
    return json({ error: error.message || 'Invalid freight loss adjustment input.' }, 400);
  }

  const manifest = detail?.manifest || [];
  const cargoLostMap = new Map(cargoLost.map((item) => [Number(item.cargoTypeId), Number(item.lostQuantity)]));
  const manifestActiveLines = manifest.filter((line) => Math.max(0, Math.floor(Number(line.quantity || 0))) > 0);
  for (const line of manifestActiveLines) {
    const cargoTypeId = Number(line.cargo_type_id);
    if (!baseSellPriceByCargo.has(cargoTypeId)) {
      const cargoName = manifestNameByCargo.get(cargoTypeId) || `Cargo #${cargoTypeId}`;
      return json({ error: `Base sell price is required for ${cargoName}.` }, 400);
    }
  }

  const settlementLines = manifest
    .filter((line) => Math.max(0, Math.floor(Number(line.quantity || 0))) > 0)
    .map((line) => {
    const cargoTypeId = Number(line.cargo_type_id);
    const cargoName = manifestNameByCargo.get(cargoTypeId) || `Cargo #${cargoTypeId}`;
    const quantity = Math.max(0, Math.floor(Number(line.quantity || 0)));
    const buyPrice = Math.max(0, Number(manifestBuyPriceByCargo.get(cargoTypeId) || 0));
    const lostQuantity = Math.max(0, Math.floor(Number(cargoLostMap.get(cargoTypeId) || 0)));
    const netQuantity = Math.max(quantity - lostQuantity, 0);
    const lineCost = toMoney(buyPrice * quantity);
    const baseSellPrice = Number(baseSellPriceByCargo.get(cargoTypeId) || 0);
    const trueSellUnitPrice = toMoney(sellMultiplier * baseSellPrice);
    const lineRevenue = toMoney(trueSellUnitPrice * netQuantity);
    const lineProfit = toMoney(lineRevenue - lineCost);
    return {
      cargoTypeId,
      cargoName,
      quantity,
      lostQuantity,
      netQuantity,
      buyPrice: toMoney(buyPrice),
      baseSellPrice: toMoney(baseSellPrice),
      trueSellUnitPrice,
      lineCost,
      lineRevenue,
      lineProfit
    };
    });

  const totalCost = toMoney(settlementLines.reduce((sum, line) => sum + line.lineCost, 0));
  const totalRevenue = toMoney(settlementLines.reduce((sum, line) => sum + line.lineRevenue, 0));
  const profit = toMoney(settlementLines.reduce((sum, line) => sum + line.lineProfit, 0));
  const companyShare = toMoney((profit > 0 ? profit : 0) * 0.1);
  const crewShare = profit > 0 ? toMoney(profit - companyShare) : 0;
  const totalLossUnits = Math.round(settlementLines.reduce((sum, line) => sum + line.lostQuantity, 0));

  await env.DB
    .prepare(
      `UPDATE voyages
       SET status = 'ENDED',
           sell_multiplier = ?,
           base_sell_price = ?,
           buy_total = ?,
           effective_sell = ?,
           profit = ?,
           company_share = ?,
           company_share_amount = ?,
           company_share_status = 'UNSETTLED',
           company_share_settled_at = NULL,
           company_share_settled_by_employee_id = NULL,
           company_share_settled_by_discord_id = NULL,
           cargo_lost_json = ?,
           settlement_lines_json = ?,
           ended_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(
      sellMultiplier,
      null,
      totalCost,
      totalRevenue,
      profit,
      companyShare,
      companyShare,
      JSON.stringify(cargoLost),
      JSON.stringify(settlementLines),
      voyageId
    )
    .run();

  return json({
    ok: true,
    metrics: { totalRevenue, totalCost, profit, companyShare, crewShare, totalLossUnits },
    settlementLines
  });
}
