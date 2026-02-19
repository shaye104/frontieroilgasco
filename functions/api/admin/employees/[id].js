import { json } from '../../auth/_lib/auth.js';
import { requireAdmin } from '../_lib/admin-auth.js';

function valueText(value) {
  const text = String(value ?? '').trim();
  return text || 'Unset';
}

function buildChangeEntries(previous, next) {
  const tracked = [
    { key: 'rank', label: 'Rank changed' },
    { key: 'grade', label: 'Grade changed' },
    { key: 'employee_status', label: 'Status changed' },
    { key: 'serial_number', label: 'Serial Number changed' },
    { key: 'hire_date', label: 'Hire Date changed' }
  ];

  return tracked
    .filter(({ key }) => String(previous?.[key] || '').trim() !== String(next?.[key] || '').trim())
    .map(({ key, label }) => ({
      actionType: label,
      details: `${valueText(previous?.[key])} -> ${valueText(next?.[key])}`
    }));
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const { errorResponse } = await requireAdmin(context);
  if (errorResponse) return errorResponse;

  const employeeId = Number(params.id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return json({ error: 'Invalid employee id.' }, 400);

  const employee = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  if (!employee) return json({ error: 'Employee not found.' }, 404);

  const disciplinaries = await env.DB.prepare(
    `SELECT id, record_type, record_date, record_status, notes, issued_by, created_at
     FROM disciplinary_records
     WHERE employee_id = ?
     ORDER BY COALESCE(record_date, created_at) DESC`
  )
    .bind(employeeId)
    .all();

  const notes = await env.DB.prepare(
    `SELECT id, note, authored_by, created_at
     FROM employee_notes
     WHERE employee_id = ?
     ORDER BY created_at DESC`
  )
    .bind(employeeId)
    .all();

  return json({ employee, disciplinaries: disciplinaries?.results || [], notes: notes?.results || [] });
}

export async function onRequestPut(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requireAdmin(context);
  if (errorResponse) return errorResponse;

  const employeeId = Number(params.id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return json({ error: 'Invalid employee id.' }, 400);

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const existing = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  if (!existing) return json({ error: 'Employee not found.' }, 404);

  await env.DB.prepare(
    `UPDATE employees
     SET roblox_username = ?,
         roblox_user_id = ?,
         rank = ?,
         grade = ?,
         serial_number = ?,
         employee_status = ?,
         hire_date = ?,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  )
    .bind(
      String(payload?.robloxUsername || '').trim(),
      String(payload?.robloxUserId || '').trim(),
      String(payload?.rank || '').trim(),
      String(payload?.grade || '').trim(),
      String(payload?.serialNumber || '').trim(),
      String(payload?.employeeStatus || '').trim(),
      String(payload?.hireDate || '').trim(),
      employeeId
    )
    .run();

  const employee = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  if (!employee) return json({ error: 'Employee not found.' }, 404);

  const actor = session.displayName || session.userId;
  const changes = buildChangeEntries(existing, employee);
  if (changes.length) {
    await env.DB.batch(
      changes.map((entry) =>
        env.DB
          .prepare('INSERT INTO employee_notes (employee_id, note, authored_by) VALUES (?, ?, ?)')
          .bind(employeeId, `[Activity] ${entry.actionType}: ${entry.details}`, actor)
      )
    );
  }

  return json({ employee });
}
