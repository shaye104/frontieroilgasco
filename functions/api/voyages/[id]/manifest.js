import { json } from '../../auth/_lib/auth.js';
import { hasPermission } from '../../_lib/permissions.js';
import { getVoyageBase, getVoyageDetail, requireVoyagePermission, toMoney } from '../../_lib/voyages.js';

function normalizeManifestLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line) => ({
      cargoTypeId: Number(line?.cargoTypeId),
      quantity: Number(line?.quantity),
      buyPrice: line?.buyPrice === '' || line?.buyPrice === null || line?.buyPrice === undefined ? NaN : Number(line?.buyPrice)
    }))
    .filter((line) => Number.isInteger(line.cargoTypeId) && line.cargoTypeId > 0);
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const { errorResponse } = await requireVoyagePermission(context, 'voyages.read');
  if (errorResponse) return errorResponse;

  const voyageId = Number(params.id);
  if (!Number.isInteger(voyageId) || voyageId <= 0) return json({ error: 'Invalid voyage id.' }, 400);

  const voyage = await getVoyageBase(env, voyageId);
  if (!voyage) return json({ error: 'Voyage not found.' }, 404);

  const lines = await env.DB
    .prepare(
      `SELECT vml.id, vml.cargo_type_id, ct.name AS cargo_name, ct.active, ct.default_price,
              vml.quantity, vml.buy_price, vml.line_total, vml.updated_at
       FROM voyage_manifest_lines vml
       INNER JOIN cargo_types ct ON ct.id = vml.cargo_type_id
       WHERE vml.voyage_id = ?
       ORDER BY ct.name ASC, ct.id ASC`
    )
    .bind(voyageId)
    .all();

  const manifest = lines?.results || [];
  const buyTotal = toMoney(manifest.reduce((acc, line) => acc + Number(line.line_total || 0), 0));
  return json({ manifest, buyTotal });
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

  const isOwner = Number(voyage.owner_employee_id) === Number(employee.id);
  if (!isOwner || !hasPermission(session, 'voyages.edit')) return json({ error: 'Only the voyage owner can edit manifest.' }, 403);

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const lines = normalizeManifestLines(payload?.lines);

  const activeCargoRows = await env.DB.prepare('SELECT id FROM cargo_types WHERE active = 1').all();
  const allowedCargo = new Set((activeCargoRows?.results || []).map((row) => Number(row.id)));

  for (const line of lines) {
    if (!allowedCargo.has(line.cargoTypeId)) return json({ error: 'Manifest can only include active cargo types.' }, 400);
    if (!Number.isInteger(line.quantity) || line.quantity < 0) return json({ error: 'Quantity must be an integer >= 0.' }, 400);
    if (line.quantity > 0 && !Number.isFinite(line.buyPrice)) return json({ error: 'Buy price is required when quantity > 0.' }, 400);
    if (Number.isFinite(line.buyPrice) && line.buyPrice < 0) return json({ error: 'Buy price must be a number >= 0.' }, 400);
  }

  await env.DB.batch([
    env.DB
      .prepare('DELETE FROM voyage_manifest_lines WHERE voyage_id = ?')
      .bind(voyageId),
    ...lines.map((line) => {
      const buyPrice = Number.isFinite(line.buyPrice) ? toMoney(line.buyPrice) : 0;
      const lineTotal = toMoney(line.quantity * buyPrice);
      return env.DB
        .prepare(
          `INSERT INTO voyage_manifest_lines (voyage_id, cargo_type_id, quantity, buy_price, line_total, updated_at)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
           ON CONFLICT(voyage_id, cargo_type_id)
           DO UPDATE SET quantity = excluded.quantity, buy_price = excluded.buy_price, line_total = excluded.line_total, updated_at = CURRENT_TIMESTAMP`
        )
        .bind(voyageId, line.cargoTypeId, line.quantity, buyPrice, lineTotal);
    })
  ]);

  const detail = await getVoyageDetail(env, voyageId);
  return json({ manifest: detail?.manifest || [], buyTotal: detail?.buyTotal || 0 });
}
