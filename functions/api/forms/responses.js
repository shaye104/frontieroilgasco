import { json } from '../auth/_lib/auth.js';
import { hasFormsAdminAccess, requireAuthenticated } from '../_lib/forms.js';

function parseFilters(url) {
  return {
    formId: Number(url.searchParams.get('formId')),
    categoryId: Number(url.searchParams.get('categoryId')),
    employeeId: Number(url.searchParams.get('employeeId')),
    dateFrom: String(url.searchParams.get('dateFrom') || '').trim(),
    dateTo: String(url.searchParams.get('dateTo') || '').trim()
  };
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse, session, employee } = await requireAuthenticated(context);
  if (errorResponse) return errorResponse;

  const isFormsAdmin = hasFormsAdminAccess(env, session);
  const filters = parseFilters(new URL(request.url));

  let sql = `SELECT r.id, r.form_id, r.employee_id, r.respondent_discord_user_id, r.submitted_at,
                    f.title AS form_title, f.category_id, c.name AS category_name,
                    e.roblox_username AS respondent_name, e.serial_number AS respondent_serial
             FROM form_responses r
             INNER JOIN forms f ON f.id = r.form_id
             LEFT JOIN form_categories c ON c.id = f.category_id
             LEFT JOIN employees e ON e.id = r.employee_id
             WHERE 1=1`;

  const bindings = [];

  if (!isFormsAdmin) {
    if (!employee) return json({ responses: [] });
    const roles = Array.isArray(session.roles) ? session.roles.map((r) => String(r)) : [];

    sql += ` AND r.respondent_discord_user_id = ?
             AND (
               EXISTS (SELECT 1 FROM form_access_employees fae WHERE fae.form_id = f.id AND fae.employee_id = ?)`;
    bindings.push(session.userId, employee.id);

    if (roles.length) {
      sql += ` OR EXISTS (SELECT 1 FROM form_access_roles far WHERE far.form_id = f.id AND far.role_id IN (${roles.map(() => '?').join(',')}))`;
      bindings.push(...roles);
    }

    sql += ' )';
  }

  if (Number.isInteger(filters.formId) && filters.formId > 0) {
    sql += ' AND r.form_id = ?';
    bindings.push(filters.formId);
  }
  if (Number.isInteger(filters.categoryId) && filters.categoryId > 0) {
    sql += ' AND f.category_id = ?';
    bindings.push(filters.categoryId);
  }
  if (isFormsAdmin && Number.isInteger(filters.employeeId) && filters.employeeId > 0) {
    sql += ' AND r.employee_id = ?';
    bindings.push(filters.employeeId);
  }
  if (filters.dateFrom) {
    sql += ' AND date(r.submitted_at) >= date(?)';
    bindings.push(filters.dateFrom);
  }
  if (filters.dateTo) {
    sql += ' AND date(r.submitted_at) <= date(?)';
    bindings.push(filters.dateTo);
  }

  sql += ' ORDER BY r.submitted_at DESC, r.id DESC';

  let query = env.DB.prepare(sql);
  if (bindings.length) query = query.bind(...bindings);

  const result = await query.all();
  return json({ responses: result?.results || [], isFormsAdmin });
}
