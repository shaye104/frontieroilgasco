import { json } from '../auth/_lib/auth.js';
import { requireVoyagePermission } from '../_lib/voyages.js';

function text(value) {
  return String(value || '').trim().toLowerCase();
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requireVoyagePermission(context, 'voyages.read');
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const username = text(url.searchParams.get('username'));
  const serial = text(url.searchParams.get('serial'));
  const query = username || serial;
  const limit = Math.min(25, Math.max(1, Number(url.searchParams.get('limit')) || 12));

  if (!query) return json({ employees: [] });

  let sql = `SELECT id, roblox_username, serial_number, rank, grade
             FROM employees
             WHERE 1=1`;
  const binds = [];
  if (username) {
    sql += ' AND LOWER(roblox_username) LIKE ?';
    binds.push(`%${username}%`);
  }
  if (serial) {
    sql += ' AND LOWER(serial_number) LIKE ?';
    binds.push(`%${serial}%`);
  }
  sql += ' ORDER BY roblox_username ASC, id ASC LIMIT ?';
  binds.push(limit);

  const result = await env.DB.prepare(sql).bind(...binds).all();
  return json({ employees: result?.results || [] });
}
