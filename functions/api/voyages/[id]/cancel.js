import { json } from '../../auth/_lib/auth.js';
import { hasPermission } from '../../_lib/permissions.js';
import { getVoyageBase, requireVoyagePermission } from '../../_lib/voyages.js';

export async function onRequestDelete(context) {
  const { env, params } = context;
  const { errorResponse, employee, session } = await requireVoyagePermission(context, 'voyages.end');
  if (errorResponse) return errorResponse;

  const voyageId = Number(params.id);
  if (!Number.isInteger(voyageId) || voyageId <= 0) return json({ error: 'Invalid voyage id.' }, 400);

  const voyage = await getVoyageBase(env, voyageId);
  if (!voyage) return json({ error: 'Voyage not found.' }, 404);
  if (String(voyage.status) !== 'ONGOING') return json({ error: 'Only ongoing voyages can be cancelled.' }, 400);
  if (!hasPermission(session, 'voyages.end') || Number(voyage.owner_employee_id) !== Number(employee.id)) {
    return json({ error: 'Only voyage owner can cancel voyage.' }, 403);
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM voyage_manifest_lines WHERE voyage_id = ?').bind(voyageId),
    env.DB.prepare('DELETE FROM voyage_logs WHERE voyage_id = ?').bind(voyageId),
    env.DB.prepare('DELETE FROM voyage_crew_members WHERE voyage_id = ?').bind(voyageId),
    env.DB.prepare('DELETE FROM voyages WHERE id = ?').bind(voyageId)
  ]);

  return json({ ok: true });
}
