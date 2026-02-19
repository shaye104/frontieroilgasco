import { json, readSessionFromRequest } from '../../auth/_lib/auth.js';
import { ensureCoreSchema } from '../../_lib/db.js';
import { enrichSessionWithPermissions, hasAnyPermission } from '../../_lib/permissions.js';

export async function requirePermission(context, permissionKeys = []) {
  const { env, request } = context;
  const rawSession = await readSessionFromRequest(env, request);
  const session = rawSession ? await enrichSessionWithPermissions(env, rawSession) : null;

  if (!session) {
    return { errorResponse: json({ error: 'Authentication required.' }, 401), session: null };
  }

  if (!hasAnyPermission(session, ['admin.access', ...permissionKeys])) {
    return { errorResponse: json({ error: 'Forbidden. Missing required permission.' }, 403), session: null };
  }

  try {
    await ensureCoreSchema(env);
  } catch (error) {
    return { errorResponse: json({ error: error.message || 'Database unavailable.' }, 500), session: null };
  }

  return { errorResponse: null, session };
}

export async function requireAdmin(context) {
  return requirePermission(context, []);
}
