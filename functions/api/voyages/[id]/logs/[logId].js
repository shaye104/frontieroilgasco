import { json } from '../../../auth/_lib/auth.js';
import { requireVoyagePermission } from '../../../_lib/voyages.js';

export async function onRequestPut(context) {
  const { errorResponse } = await requireVoyagePermission(context, 'voyages.edit');
  if (errorResponse) return errorResponse;
  return json({ error: 'Ship log entries are immutable and cannot be edited.' }, 403);
}
