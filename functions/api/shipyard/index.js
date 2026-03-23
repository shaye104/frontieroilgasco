import { json } from '../auth/_lib/auth.js';
import { requirePermission } from '../admin/_lib/admin-auth.js';
import { listShipyardShips } from '../_lib/db.js';

function text(value) {
  return String(value || '').trim();
}

export async function onRequestGet(context) {
  const { errorResponse } = await requirePermission(context, ['voyages.read']);
  if (errorResponse) return errorResponse;
  const includeInactive = new URL(context.request.url).searchParams.get('includeInactive') === '1';
  const ships = await listShipyardShips(context.env, { includeInactive });
  return json({ ships });
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse } = await requirePermission(context, ['voyages.config.manage']);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const shipName = text(payload?.shipName);
  const vesselCallsign = text(payload?.vesselCallsign);
  const vesselType = text(payload?.vesselType) || 'Freight';
  const vesselClass = text(payload?.vesselClass);
  const isActive = Number(payload?.isActive ?? 1) ? 1 : 0;
  if (!shipName || !vesselCallsign || !vesselClass) return json({ error: 'Ship name, callsign, and vessel class are required.' }, 400);

  try {
    await env.DB
      .prepare(
        `INSERT INTO shipyard_ships (ship_name, vessel_callsign, vessel_type, vessel_class, is_active, updated_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      )
      .bind(shipName, vesselCallsign, vesselType, vesselClass, isActive)
      .run();
  } catch (error) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('ux_shipyard_ship_')) return json({ error: 'Ship already exists.' }, 409);
    throw error;
  }

  const ships = await listShipyardShips(env, { includeInactive: true });
  const created = ships.find(
    (row) =>
      String(row.ship_name || '').toLowerCase() === shipName.toLowerCase() &&
      String(row.vessel_callsign || '').toLowerCase() === vesselCallsign.toLowerCase() &&
      String(row.vessel_class || '').toLowerCase() === vesselClass.toLowerCase()
  );
  return json({ ship: created || null }, 201);
}
