import { json, readSessionFromRequest } from '../../auth/_lib/auth.js';
import { ensureCoreSchema } from '../../_lib/db.js';

export async function requireAdmin(context) {
  const { env, request } = context;
  const session = await readSessionFromRequest(env, request);

  if (!session || !session.isAdmin) {
    return { errorResponse: json({ error: 'Forbidden. Admin access required.' }, 403), session: null };
  }

  try {
    await ensureCoreSchema(env);
  } catch (error) {
    return { errorResponse: json({ error: error.message || 'Database unavailable.' }, 500), session: null };
  }

  return { errorResponse: null, session };
}
