import { cachedJson, json } from '../../auth/_lib/auth.js';
import { hasPermission } from '../../_lib/permissions.js';
import { canManageVoyage, canOverrideVoyage, getVoyageBase, getVoyageDetail, isVoyageSkipper, requireVoyagePermission, toMoney } from '../../_lib/voyages.js';

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

export async function onRequestGet(context) {
  const { params, request } = context;
  const { errorResponse, session, employee } = await requireVoyagePermission(context, 'voyages.read');
  if (errorResponse) return errorResponse;
  const url = new URL(request.url);
  const includeSetup = url.searchParams.get('includeSetup') === '1';
  const includeManifest = url.searchParams.get('includeManifest') === '1' || url.searchParams.get('includeTotes') === '1';
  const includeLogs = url.searchParams.get('includeLogs') === '1';

  const voyageId = Number(params.id);
  if (!Number.isInteger(voyageId) || voyageId <= 0) return json({ error: 'Invalid voyage id.' }, 400);

  const detail = await getVoyageDetail(context.env, voyageId, { includeManifest, includeLogs });
  if (!detail) return json({ error: 'Voyage not found.' }, 404);

  const cargoLost = detail.voyage.cargo_lost_json ? JSON.parse(detail.voyage.cargo_lost_json) : [];
  const voyageSettlementLines = detail.voyage.settlement_lines_json ? JSON.parse(detail.voyage.settlement_lines_json) : [];
  const ownerSettlements = detail.voyage.settlement_owner_totals_json ? JSON.parse(detail.voyage.settlement_owner_totals_json) : [];
  const isSkipper = isVoyageSkipper(detail.voyage, employee);
  const override = canOverrideVoyage(session);
  const [employees, ports, fishTypes, sellLocations] = includeSetup
    ? await Promise.all([
        context.env.DB
          .prepare('SELECT id, roblox_username, serial_number, rank, grade FROM employees ORDER BY roblox_username ASC, id ASC')
          .all(),
        context.env.DB.prepare('SELECT id, value FROM config_voyage_ports ORDER BY value ASC, id ASC').all(),
        context.env.DB.prepare('SELECT id, name, unit_price FROM config_fish_types WHERE active = 1 ORDER BY name ASC, id ASC').all(),
        context.env.DB.prepare('SELECT id, name, multiplier, linked_port FROM config_sell_locations WHERE active = 1 ORDER BY name ASC, id ASC').all()
      ])
    : [null, null, null, null];

  return cachedJson(
    request,
    {
      ...detail,
      cargoLost,
      voyageSettlementLines,
      ownerSettlements,
      employees: employees?.results || [],
      voyageConfig: {
        ports: ports?.results || [],
        fishTypes: fishTypes?.results || [],
        sellLocations: sellLocations?.results || [],
        cargoTypes: (fishTypes?.results || []).map((row) => ({
          id: row.id,
          name: row.name,
          default_price: row.unit_price
        })),
        vesselNames: [],
        vesselClasses: [],
        vesselCallsigns: []
      },
      permissions: {
        canRead: hasPermission(session, 'voyages.read'),
        canEdit: hasPermission(session, 'voyages.edit') && (isSkipper || override) && detail.voyage.status === 'ONGOING',
        canEnd: hasPermission(session, 'voyages.end') && (isSkipper || override) && detail.voyage.status === 'ONGOING',
        canDelete:
          hasPermission(session, 'voyages.delete') &&
          (isSkipper || override) &&
          ['ENDED', 'CANCELLED'].includes(String(detail.voyage.status || '').toUpperCase())
      },
      includes: {
        includeSetup,
        includeManifest,
        includeLogs
      }
    },
    { cacheControl: 'private, max-age=15, stale-while-revalidate=30' }
  );
}

export async function onRequestDelete(context) {
  return handleCancel(context);
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
  const lostQtyByToteId = toLostQuantityMap(payload?.lostRows);
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
      const requestedLost = lostQtyByToteId.has(Number(row.id))
        ? Number(lostQtyByToteId.get(Number(row.id)))
        : lostToteIds.has(Number(row.id))
        ? quantity
        : 0;
      const lostQuantity = Math.max(0, Math.min(quantity, Math.floor(Number(requestedLost || 0))));
      const isLost = lostQuantity > 0;
      const lostValue = toMoney(lostQuantity * unitPrice * sellMultiplier);
      const lostReimbursement = isLost ? toMoney(lostQuantity * unitPrice) : 0;
      const rowNetFinalTotal = isLost ? 0 : rowFinalTotal;
      return {
        toteId: Number(row.id || 0),
        ownerEmployeeId,
        ownerName: String(row.owner_name || '').trim() || `Employee #${ownerEmployeeId}`,
        fishTypeId,
        fishName: String(row.fish_name || '').trim() || `Cargo #${fishTypeId}`,
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
    return json({ error: 'Voyage can only be cancelled when cargo earnings are zero. Mark Freight/Cargo rows as lost first if needed.' }, 400);
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

export async function onRequestPost(context) {
  let payload = null;
  try {
    payload = await context.request.json();
  } catch {
    payload = null;
  }

  const action = String(payload?.action || '').trim().toLowerCase();
  if (action !== 'cancel') {
    return json({ error: 'Unsupported action.' }, 405);
  }
  return handleCancel(context, payload || null);
}

