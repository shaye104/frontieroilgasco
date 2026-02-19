import { json } from '../auth/_lib/auth.js';
import { hasPermission } from '../_lib/permissions.js';
import { getVoyageDetail, requireVoyagePermission } from '../_lib/voyages.js';

export async function onRequestGet(context) {
  const { params } = context;
  const { errorResponse, session, employee } = await requireVoyagePermission(context, 'voyages.read');
  if (errorResponse) return errorResponse;

  const voyageId = Number(params.id);
  if (!Number.isInteger(voyageId) || voyageId <= 0) return json({ error: 'Invalid voyage id.' }, 400);

  const detail = await getVoyageDetail(context.env, voyageId);
  if (!detail) return json({ error: 'Voyage not found.' }, 404);

  const cargoLost = detail.voyage.cargo_lost_json ? JSON.parse(detail.voyage.cargo_lost_json) : [];
  const isOwner = Number(detail.voyage.owner_employee_id) === Number(employee.id);

  return json({
    ...detail,
    cargoLost,
    isOwner,
    permissions: {
      canRead: hasPermission(session, 'voyages.read'),
      canEdit: hasPermission(session, 'voyages.edit') && isOwner && detail.voyage.status === 'ONGOING',
      canEnd: hasPermission(session, 'voyages.end') && isOwner && detail.voyage.status === 'ONGOING'
    }
  });
}
