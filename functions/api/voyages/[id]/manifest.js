import { json } from '../../auth/_lib/auth.js';
import { canManageVoyage, getVoyageBase, requireVoyagePermission, toMoney } from '../../_lib/voyages.js';

const MAX_TOTES_PER_VOYAGE = 18;

function normalizeToteRows(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => ({
      ownerEmployeeId: Number(row?.ownerEmployeeId),
      fishTypeId: Number(row?.fishTypeId),
      quantity: Number(row?.quantity)
    }))
    .filter((row) => Number.isInteger(row.ownerEmployeeId) && row.ownerEmployeeId > 0 && Number.isInteger(row.fishTypeId) && row.fishTypeId > 0);
}

function mapToteRows(rows) {
  return (rows?.results || []).map((row) => ({
    id: Number(row.id),
    owner_employee_id: Number(row.owner_employee_id),
    owner_name: String(row.owner_name || '').trim(),
    fish_type_id: Number(row.fish_type_id),
    fish_name: String(row.fish_name || '').trim(),
    quantity: Math.max(0, Math.floor(Number(row.quantity || 0))),
    unit_price_snapshot: toMoney(row.unit_price_snapshot || 0),
    sell_multiplier_snapshot: Number(row.sell_multiplier_snapshot || 1) || 1,
    row_base_total: toMoney(row.row_base_total || 0),
    row_final_total: toMoney(row.row_final_total || 0),
    updated_at: row.updated_at
  }));
}

async function listToteRows(env, voyageId) {
  const rows = await env.DB
    .prepare(
      `SELECT
         vtl.id,
         vtl.owner_employee_id,
         e.roblox_username AS owner_name,
         vtl.fish_type_id,
         COALESCE(cft.name, vtl.fish_name_snapshot) AS fish_name,
         vtl.quantity,
         vtl.unit_price_snapshot,
         vtl.sell_multiplier_snapshot,
         vtl.row_base_total,
         vtl.row_final_total,
         vtl.updated_at
       FROM voyage_tote_lines vtl
       LEFT JOIN employees e ON e.id = vtl.owner_employee_id
       LEFT JOIN config_fish_types cft ON cft.id = vtl.fish_type_id
       WHERE vtl.voyage_id = ?
       ORDER BY vtl.id ASC`
    )
    .bind(voyageId)
    .all();
  const toteEntries = mapToteRows(rows);
  return {
    toteEntries,
    totals: {
      totalFish: Math.round(toteEntries.reduce((sum, row) => sum + Number(row.quantity || 0), 0)),
      totalBase: toMoney(toteEntries.reduce((sum, row) => sum + Number(row.row_base_total || 0), 0)),
      totalGross: toMoney(toteEntries.reduce((sum, row) => sum + Number(row.row_final_total || 0), 0))
    }
  };
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const { errorResponse } = await requireVoyagePermission(context, 'voyages.read');
  if (errorResponse) return errorResponse;

  const voyageId = Number(params.id);
  if (!Number.isInteger(voyageId) || voyageId <= 0) return json({ error: 'Invalid voyage id.' }, 400);

  const voyage = await getVoyageBase(env, voyageId);
  if (!voyage) return json({ error: 'Voyage not found.' }, 404);

  const payload = await listToteRows(env, voyageId);
  return json({
    toteEntries: payload.toteEntries,
    manifest: payload.toteEntries,
    totals: payload.totals,
    buyTotal: payload.totals.totalBase
  });
}

export async function onRequestPut(context) {
  const { env, params } = context;
  const { errorResponse, employee, session } = await requireVoyagePermission(context, 'voyages.edit');
  if (errorResponse) return errorResponse;

  const voyageId = Number(params.id);
  if (!Number.isInteger(voyageId) || voyageId <= 0) return json({ error: 'Invalid voyage id.' }, 400);

  const voyage = await getVoyageBase(env, voyageId);
  if (!voyage) return json({ error: 'Voyage not found.' }, 404);
  if (String(voyage.status) !== 'ONGOING') return json({ error: 'Only ongoing voyages can be edited.' }, 400);

  if (!canManageVoyage(session, employee, voyage, 'voyages.edit')) {
    return json({ error: 'Only the voyage Officer of the Watch (OOTW) (or voyage override) can edit cargo log.' }, 403);
  }

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const rows = normalizeToteRows(payload?.lines || payload?.toteEntries);
  if (rows.length > MAX_TOTES_PER_VOYAGE) {
    return json({ error: `A voyage can have at most ${MAX_TOTES_PER_VOYAGE} Freight/Cargo entries.` }, 400);
  }

  const ownerIds = [...new Set(rows.map((row) => Number(row.ownerEmployeeId)).filter((id) => Number.isInteger(id) && id > 0))];
  const fishTypeIds = [...new Set(rows.map((row) => Number(row.fishTypeId)).filter((id) => Number.isInteger(id) && id > 0))];

  if (!rows.length) {
    await env.DB.prepare('DELETE FROM voyage_tote_lines WHERE voyage_id = ?').bind(voyageId).run();
    const next = await listToteRows(env, voyageId);
    return json({ toteEntries: next.toteEntries, manifest: next.toteEntries, totals: next.totals, buyTotal: next.totals.totalBase });
  }

  for (const row of rows) {
    if (!Number.isInteger(row.quantity) || row.quantity < 0) return json({ error: 'Quantity must be an integer >= 0.' }, 400);
  }

  const [ownerRows, fishRows] = await Promise.all([
    env.DB
      .prepare(`SELECT id FROM employees WHERE id IN (${ownerIds.map(() => '?').join(', ')})`)
      .bind(...ownerIds)
      .all(),
    env.DB
      .prepare(
        `SELECT id, name, unit_price
         FROM config_fish_types
         WHERE active = 1 AND id IN (${fishTypeIds.map(() => '?').join(', ')})`
      )
      .bind(...fishTypeIds)
      .all()
  ]);

  const ownerSet = new Set((ownerRows?.results || []).map((row) => Number(row.id)));
  const fishById = new Map((fishRows?.results || []).map((row) => [Number(row.id), row]));
  const participantRows = await env.DB
    .prepare(
      `SELECT employee_id
       FROM voyage_participants
       WHERE voyage_id = ?`
    )
    .bind(voyageId)
    .all();
  const allowedOwnerIds = new Set((participantRows?.results || []).map((row) => Number(row.employee_id)).filter((id) => Number.isInteger(id) && id > 0));
  allowedOwnerIds.add(Number(voyage.officer_of_watch_employee_id));

  for (const row of rows) {
    if (!ownerSet.has(Number(row.ownerEmployeeId))) return json({ error: 'Every cargo owner must be a valid employee.' }, 400);
    if (!allowedOwnerIds.has(Number(row.ownerEmployeeId))) {
      return json({ error: 'Cargo owner must be assigned as Officer of the Watch (OOTW) or crew on this voyage.' }, 400);
    }
    if (!fishById.has(Number(row.fishTypeId))) return json({ error: 'Every cargo type must be an active configured cargo type.' }, 400);
  }

  const sellMultiplier = Number(voyage.sell_multiplier || 1) || 1;
  const statements = [env.DB.prepare('DELETE FROM voyage_tote_lines WHERE voyage_id = ?').bind(voyageId)];
  rows.forEach((row) => {
    const fish = fishById.get(Number(row.fishTypeId));
    const quantity = Math.max(0, Math.floor(Number(row.quantity || 0)));
    const unitPrice = toMoney(fish?.unit_price || 0);
    const rowBaseTotal = toMoney(quantity * unitPrice);
    const rowFinalTotal = toMoney(rowBaseTotal * sellMultiplier);
    statements.push(
      env.DB
        .prepare(
          `INSERT INTO voyage_tote_lines
             (voyage_id, owner_employee_id, fish_type_id, fish_name_snapshot, quantity, unit_price_snapshot, sell_multiplier_snapshot, row_base_total, row_final_total, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
        )
        .bind(voyageId, row.ownerEmployeeId, row.fishTypeId, String(fish?.name || `Cargo #${row.fishTypeId}`), quantity, unitPrice, sellMultiplier, rowBaseTotal, rowFinalTotal)
    );
  });
  await env.DB.batch(statements);

  const next = await listToteRows(env, voyageId);
  return json({
    toteEntries: next.toteEntries,
    manifest: next.toteEntries,
    totals: next.totals,
    buyTotal: next.totals.totalBase
  });
}

