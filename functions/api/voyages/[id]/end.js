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
  const baseSellPrice = Number(payload?.baseSellPrice);
  if (!Number.isFinite(sellMultiplier) || sellMultiplier < 0) return json({ error: 'Sell multiplier must be >= 0.' }, 400);
  if (!Number.isFinite(baseSellPrice) || baseSellPrice < 0) return json({ error: 'Base sell price must be >= 0.' }, 400);

  const detail = await getVoyageDetail(env, voyageId);
  const manifestByCargo = new Map((detail?.manifest || []).map((line) => [Number(line.cargo_type_id), Number(line.quantity || 0)]));
  const cargoLostRaw = normalizeCargoLost(payload?.cargoLost || []);
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

  const trueSellUnitPrice = toMoney(sellMultiplier * baseSellPrice);
  const manifest = detail?.manifest || [];
  const cargoLostMap = new Map(cargoLost.map((item) => [Number(item.cargoTypeId), Number(item.lostQuantity)]));

  const totalCost = toMoney(
    manifest.reduce((sum, line) => {
      const quantity = Math.max(0, Math.floor(Number(line.quantity || 0)));
      const buyPrice = Math.max(0, Number(line.buy_price || 0));
      return sum + quantity * buyPrice;
    }, 0)
  );
  const totalRevenue = toMoney(
    manifest.reduce((sum, line) => {
      const quantity = Math.max(0, Math.floor(Number(line.quantity || 0)));
      const lostQuantity = Math.max(0, Math.floor(Number(cargoLostMap.get(Number(line.cargo_type_id)) || 0)));
      const netQuantity = Math.max(quantity - lostQuantity, 0);
      const revenueLine = toMoney(trueSellUnitPrice * netQuantity);
      return sum + revenueLine;
    }, 0)
  );
  const profit = toMoney(totalRevenue - totalCost);
  const companyShare = toMoney((profit > 0 ? profit : 0) * 0.1);

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
           cargo_lost_json = ?,
           ended_at = CURRENT_TIMESTAMP,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(sellMultiplier, baseSellPrice, totalCost, totalRevenue, profit, companyShare, JSON.stringify(cargoLost), voyageId)
    .run();

  return json({
    ok: true,
    metrics: { totalRevenue, totalCost, trueSellUnitPrice, profit, companyShare }
  });
}
