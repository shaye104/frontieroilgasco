import { cachedJson } from '../../auth/_lib/auth.js';
import { requireCollegeSession } from '../../_lib/college.js';

function toInt(value) {
  const n = Number(value || 0);
  return Number.isInteger(n) ? n : 0;
}

function text(value) {
  return String(value || '').trim();
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requireCollegeSession(context, { requireManage: true });
  if (errorResponse) return errorResponse;

  const nowIso = new Date().toISOString();
  const dueSoonIso = new Date(Date.now() + 3 * 86400000).toISOString();
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 86400000).toISOString();

  const [activeTraineesRow, dueSoonRow, overdueRow, accepted30Row, passed30Row, pendingMarkingRow, draftCoursesRow, draftModulesRow, draftLibraryRow, overdueRowsResult] =
    await Promise.all([
      env.DB
        .prepare(
          `SELECT COUNT(*) AS total
           FROM employees
           WHERE user_status = 'APPLICANT_ACCEPTED'
             AND college_passed_at IS NULL`
        )
        .first(),
      env.DB
        .prepare(
          `SELECT COUNT(*) AS total
           FROM employees
           WHERE user_status = 'APPLICANT_ACCEPTED'
             AND college_passed_at IS NULL
             AND college_due_at IS NOT NULL
             AND college_due_at >= ?
             AND college_due_at <= ?`
        )
        .bind(nowIso, dueSoonIso)
        .first(),
      env.DB
        .prepare(
          `SELECT COUNT(*) AS total
           FROM employees
           WHERE user_status = 'APPLICANT_ACCEPTED'
             AND college_passed_at IS NULL
             AND college_due_at IS NOT NULL
             AND college_due_at < ?`
        )
        .bind(nowIso)
        .first(),
      env.DB
        .prepare(
          `SELECT COUNT(*) AS total
           FROM college_audit_events
           WHERE action = 'accepted'
             AND created_at >= ?`
        )
        .bind(thirtyDaysAgoIso)
        .first(),
      env.DB
        .prepare(
          `SELECT COUNT(*) AS total
           FROM college_audit_events
           WHERE action = 'passed'
             AND created_at >= ?`
        )
        .bind(thirtyDaysAgoIso)
        .first(),
      env.DB
        .prepare(
          `SELECT COUNT(*) AS total
           FROM college_exam_attempts
           WHERE submitted_at IS NOT NULL
             AND score IS NULL`
        )
        .first(),
      env.DB
        .prepare(
          `SELECT COUNT(*) AS total
           FROM college_courses
           WHERE published = 0`
        )
        .first(),
      env.DB
        .prepare(
          `SELECT COUNT(*) AS total
           FROM college_course_modules
           WHERE published = 0`
        )
        .first(),
      env.DB
        .prepare(
          `SELECT COUNT(*) AS total
           FROM college_library_documents
           WHERE published = 0`
        )
        .first(),
      env.DB
        .prepare(
          `SELECT
             e.id,
             e.roblox_username,
             e.serial_number,
             e.college_due_at
           FROM employees e
           WHERE e.user_status = 'APPLICANT_ACCEPTED'
             AND e.college_passed_at IS NULL
             AND e.college_due_at IS NOT NULL
             AND e.college_due_at < ?
           ORDER BY e.college_due_at ASC
           LIMIT 10`
        )
        .bind(nowIso)
        .all()
    ]);

  const accepted30 = Math.max(0, toInt(accepted30Row?.total));
  const passed30 = Math.max(0, toInt(passed30Row?.total));
  const passRate30 = accepted30 > 0 ? Math.round((passed30 / accepted30) * 100) : 0;

  return cachedJson(
    request,
    {
      ok: true,
      kpis: {
        activeTrainees: Math.max(0, toInt(activeTraineesRow?.total)),
        dueSoon: Math.max(0, toInt(dueSoonRow?.total)),
        overdue: Math.max(0, toInt(overdueRow?.total)),
        passRate30
      },
      actionNeeded: {
        overdueTrainees: (overdueRowsResult?.results || []).map((row) => ({
          employeeId: Number(row.id || 0),
          username: text(row.roblox_username) || `Employee #${Number(row.id || 0)}`,
          serialNumber: text(row.serial_number),
          dueAt: row.college_due_at || null
        })),
        examsAwaitingMarking: Math.max(0, toInt(pendingMarkingRow?.total)),
        draftsPendingPublish:
          Math.max(0, toInt(draftCoursesRow?.total)) +
          Math.max(0, toInt(draftModulesRow?.total)) +
          Math.max(0, toInt(draftLibraryRow?.total))
      }
    },
    { cacheControl: 'private, max-age=15, stale-while-revalidate=30' }
  );
}

