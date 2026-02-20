import { json } from '../../auth/_lib/auth.js';
import { requirePermission } from '../_lib/admin-auth.js';

function normalizeDirection(value) {
  const direction = String(value || '').trim().toLowerCase();
  return direction === 'up' || direction === 'down' ? direction : '';
}

async function listRoles(env) {
  const result = await env.DB
    .prepare(
      `SELECT id, role_key, name, description, sort_order, is_system, created_at, updated_at
       FROM app_roles
       ORDER BY sort_order ASC, id ASC`
    )
    .all();
  return result?.results || [];
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse } = await requirePermission(context, ['user_groups.manage']);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const roleId = Number(payload?.id);
  const direction = normalizeDirection(payload?.direction);
  if (!Number.isInteger(roleId) || roleId <= 0) return json({ error: 'Role id is required.' }, 400);
  if (!direction) return json({ error: 'Direction must be up or down.' }, 400);

  const roles = await listRoles(env);
  const index = roles.findIndex((role) => Number(role.id) === roleId);
  if (index < 0) return json({ error: 'Role not found.' }, 404);

  const neighborIndex = direction === 'up' ? index - 1 : index + 1;
  if (neighborIndex < 0 || neighborIndex >= roles.length) {
    return json({ roles });
  }

  const current = roles[index];
  const neighbor = roles[neighborIndex];

  await env.DB.batch([
    env.DB.prepare('UPDATE app_roles SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(
      neighbor.sort_order,
      current.id
    ),
    env.DB.prepare('UPDATE app_roles SET sort_order = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(
      current.sort_order,
      neighbor.id
    )
  ]);

  return json({ roles: await listRoles(env) });
}
