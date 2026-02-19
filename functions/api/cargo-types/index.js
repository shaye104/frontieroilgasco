import { json } from '../auth/_lib/auth.js';
import { requireVoyagePermission } from '../_lib/voyages.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const includeInactive = new URL(request.url).searchParams.get('includeInactive') === '1';
  const { errorResponse } = await requireVoyagePermission(context, 'voyages.read');
  if (errorResponse) return errorResponse;

  let sql = 'SELECT id, name, active, default_price, created_at, updated_at FROM cargo_types';
  if (!includeInactive) sql += ' WHERE active = 1';
  sql += ' ORDER BY name ASC, id ASC';

  const result = await env.DB.prepare(sql).all();
  return json({ cargoTypes: result?.results || [] });
}
