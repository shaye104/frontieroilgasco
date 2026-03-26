import { json } from '../../auth/_lib/auth.js';
import { requirePermission } from '../_lib/admin-auth.js';

async function listEmployeeStatuses(env) {
  try {
    return await env.DB
      .prepare('SELECT id, value, restrict_intranet, exclude_from_stats, created_at FROM config_employee_statuses ORDER BY value ASC, id ASC')
      .all();
  } catch (error) {
    if (!String(error?.message || '').includes('no such column')) throw error;
    return env.DB
      .prepare('SELECT id, value, 0 AS restrict_intranet, 0 AS exclude_from_stats, created_at FROM config_employee_statuses ORDER BY value ASC, id ASC')
      .all();
  }
}

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse } = await requirePermission(context, ['employees.read']);
  if (errorResponse) return errorResponse;

  const [statuses, ranks, grades, disciplinaryTypes, settingsRows] = await Promise.all([
    listEmployeeStatuses(env),
    env.DB
      .prepare('SELECT id, value, level, description, updated_at, created_at FROM config_ranks ORDER BY level DESC, value ASC, id ASC')
      .all(),
    env.DB.prepare('SELECT id, value, created_at FROM config_grades ORDER BY value ASC').all(),
    env.DB
      .prepare(
        `SELECT id, key, label, value, severity, is_active, default_status, requires_end_date, default_duration_days,
                apply_suspension_rank, set_employee_status, restrict_intranet, restrict_voyages, restrict_finance, updated_at, created_at
         FROM config_disciplinary_types
         ORDER BY severity DESC, label ASC, id ASC`
      )
      .all(),
    env.DB.prepare(`SELECT key, value, updated_at FROM config_settings ORDER BY key ASC`).all()
  ]);

  return json({
    statuses: statuses?.results || [],
    ranks: ranks?.results || [],
    grades: grades?.results || [],
    disciplinaryTypes: disciplinaryTypes?.results || [],
    settings: settingsRows?.results || []
  });
}
