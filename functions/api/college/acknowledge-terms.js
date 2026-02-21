import { json } from '../auth/_lib/auth.js';
import { evaluateAndApplyCollegePass, getCollegeOverview, requireCollegeSession } from '../_lib/college.js';

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse, employee } = await requireCollegeSession(context);
  if (errorResponse) return errorResponse;

  const employeeId = Number(employee?.id || 0);
  await env.DB
    .prepare(
      `UPDATE college_enrollments
       SET terms_acknowledged = 1
       WHERE user_employee_id = ?`
    )
    .bind(employeeId)
    .run();

  await evaluateAndApplyCollegePass(env, employee, employeeId, 'terms_acknowledged');
  const refreshed = await env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(employeeId).first();
  const overview = await getCollegeOverview(env, refreshed || employee);

  return json({ ok: true, overview });
}
