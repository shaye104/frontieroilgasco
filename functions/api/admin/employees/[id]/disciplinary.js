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

  const recordType = String(payload?.recordType || payload?.actionType || '').trim();
  const recordStatus = String(payload?.recordStatus || '').trim() || 'open';
  const recordDate = String(payload?.recordDate || '').trim() || new Date().toISOString().slice(0, 10);
  const reason = String(payload?.reason || '').trim();
  const severity = String(payload?.severity || '').trim();
  const effectiveFrom = String(payload?.effectiveFrom || '').trim();
  const effectiveTo = String(payload?.effectiveTo || '').trim();
  const notes = String(payload?.notes || '').trim();

  if (!recordType) return json({ error: 'recordType is required.' }, 400);

  const composedNotes = [notes, reason ? `Reason: ${reason}` : '', severity ? `Severity: ${severity}` : '', effectiveFrom ? `Effective From: ${effectiveFrom}` : '', effectiveTo ? `Effective To: ${effectiveTo}` : '']
    .filter(Boolean)
    .join(' | ');

  await env.DB.prepare(
    `INSERT INTO disciplinary_records (employee_id, record_type, record_date, record_status, notes, issued_by)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(employeeId, recordType, recordDate, recordStatus, composedNotes, session.displayName || session.userId)
    .run();

  const actor = session.displayName || session.userId;
  await env.DB.prepare('INSERT INTO employee_notes (employee_id, note, authored_by) VALUES (?, ?, ?)')
    .bind(
      employeeId,
      `[Activity] Disciplinary action recorded: ${recordType} (${recordStatus}) on ${recordDate}${reason ? ` | Reason: ${reason}` : ''}`,
      actor
    )
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
