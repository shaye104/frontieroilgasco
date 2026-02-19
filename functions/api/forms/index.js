import { json } from '../auth/_lib/auth.js';
import { requireAuthenticated } from '../_lib/forms.js';

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse, session, employee } = await requireAuthenticated(context);
  if (errorResponse) return errorResponse;

  const categoriesResult = await env.DB
    .prepare('SELECT id, name, description, sort_order FROM form_categories ORDER BY sort_order ASC, name ASC')
    .all();
  const categories = categoriesResult?.results || [];

  let forms = [];

  if (session.isAdmin) {
    const result = await env.DB
      .prepare(
        `SELECT f.id, f.title, f.description, f.instructions, f.category_id, c.name AS category_name, f.status, f.updated_at
         FROM forms f
         LEFT JOIN form_categories c ON c.id = f.category_id
         WHERE f.status != 'archived'
         ORDER BY f.updated_at DESC, f.id DESC`
      )
      .all();
    forms = result?.results || [];
  } else {
    if (!employee) return json({ error: 'Employee profile is required for forms access.' }, 403);

    const roles = Array.isArray(session.roles) ? session.roles.map((r) => String(r)) : [];

    let sql = `SELECT DISTINCT f.id, f.title, f.description, f.instructions, f.category_id, c.name AS category_name, f.status, f.updated_at
               FROM forms f
               LEFT JOIN form_categories c ON c.id = f.category_id
               LEFT JOIN form_access_employees fae ON fae.form_id = f.id
               LEFT JOIN form_access_roles far ON far.form_id = f.id
               WHERE f.status = 'published'
                 AND (
                    fae.employee_id = ?`;
    const bindings = [employee.id];

    if (roles.length) {
      sql += ` OR far.role_id IN (${roles.map(() => '?').join(',')})`;
      bindings.push(...roles);
    }

    sql += ' ) ORDER BY f.updated_at DESC, f.id DESC';

    const result = await env.DB.prepare(sql).bind(...bindings).all();
    forms = result?.results || [];
  }

  const grouped = categories.map((category) => ({
    ...category,
    forms: forms.filter((form) => Number(form.category_id) === Number(category.id))
  }));

  const uncategorized = forms.filter((form) => !form.category_id);

  return json({
    isAdmin: Boolean(session.isAdmin),
    categories: grouped,
    uncategorized
  });
}
