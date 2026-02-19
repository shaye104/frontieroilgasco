import { ensureCoreSchema } from '../../_lib/db.js';

function normalizeRoleIds(roleIds) {
  return [...new Set(roleIds.map((value) => String(value).trim()).filter((value) => /^\d{6,30}$/.test(value)))];
}

async function ensureSchema(env) {
  await ensureCoreSchema(env);
}

export async function getConfiguredRoleIds(env) {
  await ensureSchema(env);

  const result = await env.DB.prepare('SELECT role_id FROM intranet_allowed_roles ORDER BY created_at ASC').all();
  return normalizeRoleIds((result?.results || []).map((row) => row.role_id));
}

export async function saveConfiguredRoleIds(env, roleIds) {
  await ensureSchema(env);

  const normalized = normalizeRoleIds(Array.isArray(roleIds) ? roleIds : []);
  const statements = [env.DB.prepare('DELETE FROM intranet_allowed_roles')];
  normalized.forEach((roleId) => {
    statements.push(env.DB.prepare('INSERT INTO intranet_allowed_roles (role_id) VALUES (?)').bind(roleId));
  });

  await env.DB.batch(statements);
  return normalized;
}
