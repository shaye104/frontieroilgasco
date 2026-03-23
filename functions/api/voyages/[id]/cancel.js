import { json } from '../../auth/_lib/auth.js';
import { canManageVoyage, getVoyageBase, requireVoyagePermission, toMoney } from '../../_lib/voyages.js';

const LOST_TOTE_REIMBURSEMENT = 50;
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

async function handleCancel(context, payload = null) {
  const { env, params } = context;
  const { errorResponse, employee, session } = await requireVoyagePermission(context, 'voyages.end');
  if (errorResponse) return errorResponse;

  const voyageId = Number(params.id);
  if (!Number.isInteger(voyageId) || voyageId <= 0) return json({ error: 'Invalid voyage id.' }, 400);

  const voyage = await getVoyageBase(env, voyageId);
  if (!voyage) return json({ error: 'Voyage not found.' }, 404);
  if (String(voyage.status) !== 'ONGOING') return json({ error: 'Only ongoing voyages can be cancelled.' }, 400);
  if (!canManageVoyage(session, employee, voyage, 'voyages.end')) {
    return json({ error: 'Only the voyage Officer of the Watch (OOTW) (or voyage override) can cancel voyage.' }, 403);
  }

  const lostToteIds = toPositiveIntSet(payload?.lostToteIds);
  const sellMultiplier = Number(voyage.sell_multiplier || 1) > 0 ? Number(voyage.sell_multiplier || 1) : 1;
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
  const settlementLines = toteEntries
    .map((row) => {
      const ownerEmployeeId = Number(row.owner_employee_id || 0);
      const fishTypeId = Number(row.fish_type_id || 0);
      const quantity = Math.max(0, Math.floor(Number(row.quantity || 0)));
      const unitPrice = toMoney(row.unit_price || 0);
      const rowBaseTotal = toMoney(quantity * unitPrice);
      const rowFinalTotal = toMoney(rowBaseTotal * sellMultiplier);
      const isLost = lostToteIds.has(Number(row.id));
      const lostQuantity = isLost ? quantity : 0;
      const lostValue = toMoney(lostQuantity * unitPrice * sellMultiplier);
      const lostReimbursement = isLost ? LOST_TOTE_REIMBURSEMENT : 0;
      const rowNetFinalTotal = isLost ? 0 : rowFinalTotal;
      return {
        toteId: Number(row.id || 0),
        ownerEmployeeId,
        ownerName: String(row.owner_name || '').trim() || `Employee #${ownerEmployeeId}`,
        fishTypeId,
        fishName: String(row.fish_name || '').trim() || `Fish #${fishTypeId}`,
        quantity,
        netQuantity: isLost ? 0 : quantity,
        isLost,
        lostQuantity,
        lostValue,
        lostReimbursement,
        unitPrice,
        sellMultiplier,
        rowBaseTotal,
        rowFinalTotal,
        rowNetFinalTotal
      };
    })
    .filter((line) => line.ownerEmployeeId > 0 && line.fishTypeId > 0 && line.quantity > 0);

  const totalGrossEarnings = toMoney(settlementLines.reduce((sum, line) => sum + Number(line.rowNetFinalTotal || 0), 0));
  if (totalGrossEarnings > 0) {
    return json({ error: 'Voyage can only be cancelled when tote earnings are zero. Mark Freight/Cargo rows as lost first if needed.' }, 400);
  }

  const skipperEmployeeId = Number(voyage.officer_of_watch_employee_id || 0);
  const ownerSummaryMap = new Map();
  settlementLines.forEach((line) => {
    const key = Number(line.ownerEmployeeId || 0);
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
  const ownerSettlements = [...ownerSummaryMap.values()]
    .map((owner) => ({
      ...owner,
      payableTotal:
        skipperEmployeeId > 0 && Number(owner.ownerEmployeeId) === skipperEmployeeId
          ? 0
          : Math.max(0, toMoney(Number(owner.grossTotal || 0) * CREW_DUE_TO_SKIPPER_RATE))
    }))
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName));

  const totalBase = toMoney(settlementLines.reduce((sum, line) => sum + Number(line.rowBaseTotal || 0), 0));
  const totalLostValue = toMoney(
    settlementLines.reduce((sum, line) => sum + Number(line.lostValue || 0) + Number(line.lostReimbursement || 0), 0)
  );
  const totalReimbursements = toMoney(settlementLines.reduce((sum, line) => sum + Number(line.lostReimbursement || 0), 0));
  const totalFishQuantity = Math.round(settlementLines.reduce((sum, line) => sum + Number(line.quantity || 0), 0));
  const voyageProfit = toMoney(totalGrossEarnings - totalReimbursements);

  await env.DB.batch([
    ...settlementLines.map((line) =>
      env.DB
        .prepare(
          `UPDATE voyage_tote_lines
           SET unit_price_snapshot = ?, sell_multiplier_snapshot = ?, row_base_total = ?, row_final_total = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND voyage_id = ?`
        )
        .bind(line.unitPrice, sellMultiplier, line.rowBaseTotal, line.rowFinalTotal, line.toteId, voyageId)
    ),
    env.DB
      .prepare(
        `UPDATE voyages
         SET status = 'CANCELLED',
             buy_total = ?,
             effective_sell = ?,
             profit = ?,
             company_share = 0,
             company_share_amount = 0,
             total_fish_quantity = ?,
             total_payable_amount = 0,
             settlement_lines_json = ?,
             settlement_owner_totals_json = ?,
             company_share_status = 'SETTLED',
             company_share_settled_at = CURRENT_TIMESTAMP,
             company_share_settled_by_employee_id = ?,
             company_share_settled_by_discord_id = ?,
             ended_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(
        totalBase,
        totalGrossEarnings,
        voyageProfit,
        totalFishQuantity,
        JSON.stringify(settlementLines),
        JSON.stringify(ownerSettlements),
        Number(employee.id),
        Number(employee.discord_id || session?.discord?.id || 0) || null,
        voyageId
      ),
    env.DB
      .prepare(
        `INSERT INTO voyage_logs (voyage_id, author_employee_id, message, log_type, updated_at)
         VALUES (?, ?, ?, 'system', CURRENT_TIMESTAMP)`
      )
      .bind(
        voyageId,
        Number(employee.id),
        `Voyage cancelled. Earnings ${totalGrossEarnings > 0 ? '+' : ''}${totalGrossEarnings}, losses ${totalLostValue}, reimbursements ${totalReimbursements}.`
      )
  ]);

  return json({
    ok: true,
    totals: {
      totalFishQuantity,
      totalGrossEarnings,
      totalLostValue,
      totalReimbursements,
      voyageProfit
    }
  });
}

export async function onRequestDelete(context) {
  return handleCancel(context);
}

export async function onRequestPost(context) {
  let payload = null;
  try {
    payload = await context.request.json();
  } catch {
    payload = null;
  }
  return handleCancel(context, payload || null);
}
