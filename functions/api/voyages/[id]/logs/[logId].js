import { json } from '../../../auth/_lib/auth.js';
import { hasPermission } from '../../../_lib/permissions.js';
import { getVoyageBase, requireVoyagePermission } from '../../../_lib/voyages.js';

export async function onRequestPut(context) {
  const { env, params } = context;
  const { errorResponse, employee, session } = await requireVoyagePermission(context, 'voyages.edit');
  if (errorResponse) return errorResponse;

  const voyageId = Number(params.id);
  const logId = Number(params.logId);
  if (!Number.isInteger(voyageId) || voyageId <= 0 || !Number.isInteger(logId) || logId <= 0) {
    return json({ error: 'Invalid voyage/log id.' }, 400);
  }

  const voyage = await getVoyageBase(env, voyageId);
  if (!voyage) return json({ error: 'Voyage not found.' }, 404);
  if (String(voyage.status) !== 'ONGOING') return json({ error: 'Voyage log is locked once voyage ends.' }, 400);
  if (Number(voyage.owner_employee_id) !== Number(employee.id) || !hasPermission(session, 'voyages.edit')) {
    return json({ error: 'Only voyage owner can edit ship log entries.' }, 403);
  }

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }
  const message = String(payload?.message || '').trim();
  if (!message) return json({ error: 'Log message is required.' }, 400);

  const existing = await env.DB.prepare('SELECT id FROM voyage_logs WHERE id = ? AND voyage_id = ?').bind(logId, voyageId).first();
  if (!existing) return json({ error: 'Log entry not found.' }, 404);

  await env.DB
    .prepare('UPDATE voyage_logs SET message = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(message, logId)
    .run();

  return json({ ok: true });
}
