import { json } from '../../../auth/_lib/auth.js';
import { requireAdmin } from '../../_lib/admin-auth.js';

export async function onRequestPost(context) {
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

  const recordType = String(payload?.recordType || '').trim();
  const recordStatus = String(payload?.recordStatus || '').trim() || 'open';
  const recordDate = String(payload?.recordDate || '').trim() || new Date().toISOString().slice(0, 10);
  const notes = String(payload?.notes || '').trim();

  if (!recordType) return json({ error: 'recordType is required.' }, 400);

  await env.DB.prepare(
    `INSERT INTO disciplinary_records (employee_id, record_type, record_date, record_status, notes, issued_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(employeeId, recordType, recordDate, recordStatus, notes, session.displayName || session.userId)
    .run();

  const records = await env.DB.prepare(
    `SELECT id, record_type, record_date, record_status, notes, issued_by, created_at
     FROM disciplinary_records
     WHERE employee_id = ?
     ORDER BY COALESCE(record_date, created_at) DESC`
  )
    .bind(employeeId)
    .all();

  return json({ disciplinaries: records?.results || [] }, 201);
}
