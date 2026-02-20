import { json } from '../../../auth/_lib/auth.js';
import { requirePermission } from '../../_lib/admin-auth.js';
import { canEditEmployeeByRank, getEmployeeByDiscordUserId } from '../../../_lib/db.js';
import { hasPermission } from '../../../_lib/permissions.js';

export async function onRequestPost(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.notes']);
  if (errorResponse) return errorResponse;

  const employeeId = Number(params.id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return json({ error: 'Invalid employee id.' }, 400);
  const targetEmployee = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  if (!targetEmployee) return json({ error: 'Employee not found.' }, 404);
  const actorEmployee = await getEmployeeByDiscordUserId(env, session.userId);
  const canEditByRank = actorEmployee
    ? await canEditEmployeeByRank(env, actorEmployee, targetEmployee)
    : false;
  if (!hasPermission(session, 'admin.override') && !canEditByRank) {
    return json({ error: 'You cannot edit employees with a higher rank than yours.' }, 403);
  }

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const note = String(payload?.note || '').trim();
  const category = String(payload?.category || '').trim();
  if (!note) return json({ error: 'note is required.' }, 400);

  const finalNote = category ? `[${category}] ${note}` : note;

  await env.DB.prepare('INSERT INTO employee_notes (employee_id, note, authored_by) VALUES (?, ?, ?)')
    .bind(employeeId, finalNote, session.displayName || session.userId)
    .run();

  const notes = await env.DB.prepare(
    `SELECT id, note, authored_by, created_at
     FROM employee_notes
     WHERE employee_id = ?
     ORDER BY created_at DESC`
  )
    .bind(employeeId)
    .all();

  return json({ notes: notes?.results || [] }, 201);
}
