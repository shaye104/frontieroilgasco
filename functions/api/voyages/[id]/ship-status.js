import { json } from '../../auth/_lib/auth.js';
import { hasPermission } from '../../_lib/permissions.js';
import { getVoyageBase, requireVoyagePermission } from '../../_lib/voyages.js';

const LABELS = {
  IN_PORT: 'Ship In Port',
  UNDERWAY: 'Ship Underway'
};

function normalizeStatus(value) {
  const input = String(value || '').trim().toUpperCase();
  return input === 'UNDERWAY' ? 'UNDERWAY' : input === 'IN_PORT' ? 'IN_PORT' : '';
}

export async function onRequestPut(context) {
  const { env, params } = context;
  const { errorResponse, employee, session } = await requireVoyagePermission(context, 'voyages.edit');
  if (errorResponse) return errorResponse;

  const voyageId = Number(params.id);
  if (!Number.isInteger(voyageId) || voyageId <= 0) return json({ error: 'Invalid voyage id.' }, 400);

  const voyage = await getVoyageBase(env, voyageId);
  if (!voyage) return json({ error: 'Voyage not found.' }, 404);
  if (String(voyage.status) !== 'ONGOING') return json({ error: 'Only ongoing voyages can change ship status.' }, 400);
  if (Number(voyage.owner_employee_id) !== Number(employee.id) || !hasPermission(session, 'voyages.edit')) {
    return json({ error: 'Only the voyage owner can change ship status.' }, 403);
  }

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }
  const shipStatus = normalizeStatus(payload?.shipStatus);
  if (!shipStatus) return json({ error: 'shipStatus must be IN_PORT or UNDERWAY.' }, 400);

  if (String(voyage.ship_status || 'IN_PORT') === shipStatus) {
    return json({ ok: true, shipStatus });
  }

  await env.DB
    .prepare(`UPDATE voyages SET ship_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(shipStatus, voyageId)
    .run();

  await env.DB
    .prepare(`INSERT INTO voyage_logs (voyage_id, author_employee_id, message, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)`)
    .bind(
      voyageId,
      employee.id,
      `Status changed: ${LABELS[String(voyage.ship_status || 'IN_PORT')] || 'Ship In Port'} -> ${LABELS[shipStatus]}`
    )
    .run();

  return json({ ok: true, shipStatus });
}
