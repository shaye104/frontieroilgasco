import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { getConfiguredRoleIds, saveConfiguredRoleIds } from '../auth/_lib/roles-store.js';

function unauthorized() {
  return json({ error: 'Forbidden. Admin access required.' }, 403);
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const session = await readSessionFromRequest(env, request);

  if (!session?.isAdmin) return unauthorized();

  try {
    const roleIds = await getConfiguredRoleIds(env);
    return json({ roleIds });
  } catch (error) {
    return json({ error: error.message || 'Unable to load role configuration.' }, 500);
  }
}

export async function onRequestPut(context) {
  const { env, request } = context;
  const session = await readSessionFromRequest(env, request);

  if (!session?.isAdmin) return unauthorized();

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  try {
    const roleIds = await saveConfiguredRoleIds(env, payload?.roleIds || []);
    return json({ roleIds });
  } catch (error) {
    return json({ error: error.message || 'Unable to save role configuration.' }, 500);
  }
}
