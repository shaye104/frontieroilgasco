import { json } from '../../auth/_lib/auth.js';
import { requirePermission } from '../_lib/admin-auth.js';

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse } = await requirePermission(context, ['employees.read']);
  if (errorResponse) return errorResponse;

  const [statuses, ranks, grades] = await Promise.all([
    env.DB.prepare('SELECT id, value, created_at FROM config_employee_statuses ORDER BY value ASC').all(),
    env.DB
      .prepare('SELECT id, value, level, description, updated_at, created_at FROM config_ranks ORDER BY level DESC, value ASC, id ASC')
      .all(),
    env.DB.prepare('SELECT id, value, created_at FROM config_grades ORDER BY value ASC').all()
  ]);

  return json({
    statuses: statuses?.results || [],
    ranks: ranks?.results || [],
    grades: grades?.results || []
  });
}
