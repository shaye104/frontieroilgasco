import { json } from '../auth/_lib/auth.js';
import { requireVoyagePermission } from '../_lib/voyages.js';

async function readList(env, tableName) {
  const rows = await env.DB.prepare(`SELECT id, value FROM ${tableName} ORDER BY value ASC, id ASC`).all();
  return rows?.results || [];
}

async function ensureSellLocationLinkedPortColumn(env) {
  const columns = await env.DB.prepare(`PRAGMA table_info(config_sell_locations)`).all();
  const names = new Set((columns?.results || []).map((row) => String(row.name || '').toLowerCase()));
  if (!names.has('linked_port')) {
    await env.DB.prepare(`ALTER TABLE config_sell_locations ADD COLUMN linked_port TEXT`).run();
  }
}

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse } = await requireVoyagePermission(context, 'voyages.read');
  if (errorResponse) return errorResponse;
  await ensureSellLocationLinkedPortColumn(env);

  const [ports, fishTypes, sellLocations] = await Promise.all([
    readList(env, 'config_voyage_ports'),
    env.DB
      .prepare('SELECT id, name, unit_price FROM config_fish_types WHERE active = 1 ORDER BY name ASC, id ASC')
      .all(),
    env.DB
      .prepare('SELECT id, name, multiplier, linked_port FROM config_sell_locations WHERE active = 1 ORDER BY name ASC, id ASC')
      .all()
  ]);

  return json({
    ports,
    fishTypes: fishTypes?.results || [],
    sellLocations: sellLocations?.results || [],
    cargoTypes: (fishTypes?.results || []).map((row) => ({
      id: row.id,
      name: row.name,
      default_price: row.unit_price
    }))
  });
}
