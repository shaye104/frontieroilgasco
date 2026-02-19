import { json } from '../../auth/_lib/auth.js';
import { hasPermission } from '../../_lib/permissions.js';
import { getVoyageBase, requireVoyagePermission } from '../../_lib/voyages.js';

export async function onRequestGet(context) {
  const { env, params, request } = context;
  const { errorResponse } = await requireVoyagePermission(context, 'voyages.read');
  if (errorResponse) return errorResponse;

  const voyageId = Number(params.id);
  if (!Number.isInteger(voyageId) || voyageId <= 0) return json({ error: 'Invalid voyage id.' }, 400);

  const voyage = await getVoyageBase(env, voyageId);
  if (!voyage) return json({ error: 'Voyage not found.' }, 404);

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const pageSize = Math.min(200, Math.max(1, Number(url.searchParams.get('pageSize')) || 50));
  const offset = (page - 1) * pageSize;

  const logs = await env.DB
    .prepare(
      `SELECT vl.id, vl.message, vl.created_at, vl.updated_at,
              e.id AS author_employee_id, e.roblox_username AS author_name
       FROM voyage_logs vl
       INNER JOIN employees e ON e.id = vl.author_employee_id
       WHERE vl.voyage_id = ?
       ORDER BY vl.created_at DESC, vl.id DESC
       LIMIT ? OFFSET ?`
    )
    .bind(voyageId, pageSize, offset)
    .all();
  const totalRow = await env.DB.prepare(`SELECT COUNT(*) AS total FROM voyage_logs WHERE voyage_id = ?`).bind(voyageId).first();

  return json({
    logs: logs?.results || [],
    pagination: {
      page,
      pageSize,
      total: Number(totalRow?.total || 0)
    }
  });
}

export async function onRequestPost(context) {
  const { env, params } = context;
  const { errorResponse, employee, session } = await requireVoyagePermission(context, 'voyages.edit');
  if (errorResponse) return errorResponse;

  const voyageId = Number(params.id);
  if (!Number.isInteger(voyageId) || voyageId <= 0) return json({ error: 'Invalid voyage id.' }, 400);

  const voyage = await getVoyageBase(env, voyageId);
  if (!voyage) return json({ error: 'Voyage not found.' }, 404);
  if (String(voyage.status) !== 'ONGOING') return json({ error: 'Voyage log is locked once voyage ends.' }, 400);
  if (Number(voyage.owner_employee_id) !== Number(employee.id) || !hasPermission(session, 'voyages.edit')) {
    return json({ error: 'Only voyage owner can add ship log entries.' }, 403);
  }

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const message = String(payload?.message || '').trim();
  if (!message) return json({ error: 'Log message is required.' }, 400);

  await env.DB
    .prepare('INSERT INTO voyage_logs (voyage_id, author_employee_id, message, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
    .bind(voyageId, employee.id, message)
    .run();

  const logs = await env.DB
    .prepare(
      `SELECT vl.id, vl.message, vl.created_at, vl.updated_at,
              e.id AS author_employee_id, e.roblox_username AS author_name
       FROM voyage_logs vl
       INNER JOIN employees e ON e.id = vl.author_employee_id
       WHERE vl.voyage_id = ?
       ORDER BY vl.created_at ASC, vl.id ASC`
    )
    .bind(voyageId)
    .all();

  return json({ logs: logs?.results || [] }, 201);
}
