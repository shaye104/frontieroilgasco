import { json } from '../auth/_lib/auth.js';
import { requirePermission } from '../admin/_lib/admin-auth.js';
import { getShipyardShipById } from '../_lib/db.js';

function text(value) {
  return String(value || '').trim();
}

export async function onRequestPut(context) {
  const { env, params } = context;
  const { errorResponse } = await requirePermission(context, ['voyages.config.manage']);
  if (errorResponse) return errorResponse;

  const shipId = Number(params.id);
  if (!Number.isInteger(shipId) || shipId <= 0) return json({ error: 'Invalid ship id.' }, 400);
  const existing = await getShipyardShipById(env, shipId);
  if (!existing) return json({ error: 'Ship not found.' }, 404);

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const shipName = text(payload?.shipName) || text(existing.ship_name);
  const vesselCallsign = text(payload?.vesselCallsign) || text(existing.vessel_callsign) || shipName;
  const vesselType = text(payload?.vesselType) || text(existing.vessel_type) || 'Freight';
  const vesselClass = text(payload?.vesselClass) || text(existing.vessel_class);
  const isActive = payload?.isActive === undefined ? Number(existing.is_active || 0) : Number(payload.isActive) ? 1 : 0;
  if (!shipName || !vesselCallsign || !vesselClass) return json({ error: 'Ship name, callsign, and vessel class are required.' }, 400);

  try {
    await env.DB
      .prepare(
        `UPDATE shipyard_ships
         SET ship_name = ?, vessel_callsign = ?, vessel_type = ?, vessel_class = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(shipName, vesselCallsign, vesselType, vesselClass, isActive, shipId)
      .run();
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('ux_shipyard_ship_')) return json({ error: 'Ship already exists.' }, 409);
    throw error;
  }

  const ship = await getShipyardShipById(env, shipId);
  return json({ ship });
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  const { errorResponse } = await requirePermission(context, ['voyages.config.manage']);
  if (errorResponse) return errorResponse;

  const shipId = Number(params.id);
  if (!Number.isInteger(shipId) || shipId <= 0) return json({ error: 'Invalid ship id.' }, 400);
  const existing = await getShipyardShipById(env, shipId);
  if (!existing) return json({ error: 'Ship not found.' }, 404);

  const activeAssignment = await env.DB
    .prepare(
      `SELECT id
       FROM employee_vessel_assignments
       WHERE ship_id = ? AND ended_at IS NULL
       LIMIT 1`
    )
    .bind(shipId)
    .first();
  if (activeAssignment) {
    return json({ error: 'Cannot delete ship while active crew assignments exist.' }, 409);
  }

  await env.DB
    .prepare('DELETE FROM shipyard_ships WHERE id = ?')
    .bind(shipId)
    .run();
  return json({ ok: true, deleted: shipId });
}
