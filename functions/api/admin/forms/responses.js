import { json } from '../../auth/_lib/auth.js';
import { requirePermission } from '../_lib/admin-auth.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requirePermission(context, ['forms.responses.read']);
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const formId = Number(url.searchParams.get('formId'));
  const categoryId = Number(url.searchParams.get('categoryId'));
  const employeeId = Number(url.searchParams.get('employeeId'));
  const dateFrom = String(url.searchParams.get('dateFrom') || '').trim();
  const dateTo = String(url.searchParams.get('dateTo') || '').trim();

  let sql = `SELECT r.id, r.form_id, r.employee_id, r.respondent_discord_user_id, r.submitted_at,
                    f.title AS form_title, f.category_id, c.name AS category_name,
                    e.roblox_username AS respondent_name, e.serial_number AS respondent_serial
             FROM form_responses r
             INNER JOIN forms f ON f.id = r.form_id
             LEFT JOIN form_categories c ON c.id = f.category_id
             LEFT JOIN employees e ON e.id = r.employee_id
             WHERE 1=1`;

  const bindings = [];

  if (Number.isInteger(formId) && formId > 0) {
    sql += ' AND r.form_id = ?';
    bindings.push(formId);
  }

  if (Number.isInteger(categoryId) && categoryId > 0) {
    sql += ' AND f.category_id = ?';
    bindings.push(categoryId);
  }

  if (Number.isInteger(employeeId) && employeeId > 0) {
    sql += ' AND r.employee_id = ?';
    bindings.push(employeeId);
  }

  if (dateFrom) {
    sql += ' AND date(r.submitted_at) >= date(?)';
    bindings.push(dateFrom);
  }

  if (dateTo) {
    sql += ' AND date(r.submitted_at) <= date(?)';
    bindings.push(dateTo);
  }

  sql += ' ORDER BY r.submitted_at DESC, r.id DESC';

  let query = env.DB.prepare(sql);
  if (bindings.length) query = query.bind(...bindings);
  const result = await query.all();

  return json({ responses: result?.results || [] });
}
