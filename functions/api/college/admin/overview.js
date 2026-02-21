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
  const { errorResponse } = await requireCollegeSession(context, { requiredAnyCapabilities: ['college:admin', 'progress:view'] });
  if (errorResponse) return errorResponse;

  const nowIso = new Date().toISOString();
  const dueSoonIso = new Date(Date.now() + 3 * 86400000).toISOString();
  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 86400000).toISOString();

  const [
    activeTraineesRow,
    dueSoonRow,
    overdueRow,
    accepted30Row,
    passed30Row,
    avgDaysToPassRow,
    pendingMarkingRow,
    draftCoursesRow,
    draftModulesRow,
    draftLibraryRow,
    overdueRowsResult
  ] =
    await Promise.all([
      env.DB
        .prepare(
          `SELECT COUNT(*) AS total
           FROM college_profiles
           WHERE trainee_status = 'TRAINEE_ACTIVE'`
        )
        .first(),
      env.DB
        .prepare(
          `SELECT COUNT(*) AS total
           FROM college_profiles
           WHERE trainee_status = 'TRAINEE_ACTIVE'
             AND due_at IS NOT NULL
             AND due_at >= ?
             AND due_at <= ?`
        )
        .bind(nowIso, dueSoonIso)
        .first(),
      env.DB
        .prepare(
          `SELECT COUNT(*) AS total
           FROM college_profiles
           WHERE trainee_status = 'TRAINEE_ACTIVE'
             AND due_at IS NOT NULL
             AND due_at < ?`
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
          `SELECT
             AVG(
               (julianday(COALESCE(passed_at, CURRENT_TIMESTAMP)) - julianday(start_at))
             ) AS avg_days
           FROM college_profiles
           WHERE passed_at IS NOT NULL
             AND start_at IS NOT NULL
             AND passed_at >= ?`
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
             cp.due_at AS college_due_at
           FROM college_profiles cp
           INNER JOIN employees e ON e.id = cp.user_employee_id
           WHERE cp.trainee_status = 'TRAINEE_ACTIVE'
             AND cp.due_at IS NOT NULL
             AND cp.due_at < ?
           ORDER BY cp.due_at ASC
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
        passRate30,
        avgDaysToPass: avgDaysToPassRow?.avg_days == null ? null : Math.max(0, Number(avgDaysToPassRow.avg_days.toFixed(1)))
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
