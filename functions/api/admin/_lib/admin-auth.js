import { json, readSessionFromRequest } from '../../auth/_lib/auth.js';
import { ensureCoreSchema } from '../../_lib/db.js';
import { enrichSessionWithPermissions, hasAnyPermission } from '../../_lib/permissions.js';
import { canAccessGeneralIntranet, deriveLifecycleStatusFromEmployee } from '../../_lib/lifecycle.js';

function isReadOnlyRequest(request) {
  const method = String(request?.method || '').toUpperCase();
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS';
}

function hasAdminReadOnly(session) {
  const permissions = Array.isArray(session?.permissions) ? session.permissions : [];
  return permissions.includes('admin.read_only');
}

export async function requirePermission(context, permissionKeys = []) {
  const { env, request } = context;
  const rawSession = await readSessionFromRequest(env, request);
  const session = rawSession ? await enrichSessionWithPermissions(env, rawSession) : null;

  if (!session) {
    return { errorResponse: json({ error: 'Authentication required.' }, 401), session: null };
  }

  const hasTargetPermission = permissionKeys.length ? hasAnyPermission(session, permissionKeys) : true;
  const allowReadOnlyBypass = permissionKeys.length && hasAdminReadOnly(session) && isReadOnlyRequest(request);
  if (!hasTargetPermission && !allowReadOnlyBypass) {
    return { errorResponse: json({ error: 'Forbidden. Missing required permission.' }, 403), session: null };
  }
  if (!session.isAdmin) {
    const lifecycleStatus = deriveLifecycleStatusFromEmployee(session?.employee, session?.userStatus || 'ACTIVE');
    if (!session.employee || !canAccessGeneralIntranet(lifecycleStatus)) {
      return { errorResponse: json({ error: 'Account is not active.' }, 403), session: null };
    }
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
