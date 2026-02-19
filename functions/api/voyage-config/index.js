import { json } from '../auth/_lib/auth.js';
import { requireVoyagePermission } from '../_lib/voyages.js';

async function readList(env, tableName) {
  const rows = await env.DB.prepare(`SELECT id, value FROM ${tableName} ORDER BY value ASC, id ASC`).all();
  return rows?.results || [];
}

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse } = await requireVoyagePermission(context, 'voyages.read');
  if (errorResponse) return errorResponse;

  const [ports, vesselNames, vesselClasses, vesselCallsigns, cargoTypes] = await Promise.all([
    readList(env, 'config_voyage_ports'),
    readList(env, 'config_vessel_names'),
    readList(env, 'config_vessel_classes'),
    readList(env, 'config_vessel_callsigns'),
    env.DB.prepare('SELECT id, name, default_price FROM cargo_types WHERE active = 1 ORDER BY name ASC, id ASC').all()
  ]);

  return json({
    ports,
    vesselNames,
    vesselClasses,
    vesselCallsigns,
    cargoTypes: cargoTypes?.results || []
  });
}
