import { cachedJson, json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { calculateTenureDays, ensureCoreSchema, getEmployeeByDiscordUserId } from '../_lib/db.js';
import { enrichSessionWithPermissions } from '../_lib/permissions.js';
import { expireDisciplinaryRecordsForEmployee, listDisciplinaryRecordsForEmployee, reconcileEmployeeSuspensionState } from '../_lib/disciplinary.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const rawSession = await readSessionFromRequest(env, request);
  const session = rawSession ? await enrichSessionWithPermissions(env, rawSession) : null;

  if (!session) {
    return json({ loggedIn: false }, 401);
  }

  try {
    await ensureCoreSchema(env);
  } catch (error) {
    return json({ error: error.message || 'Database unavailable.' }, 500);
  }

  const employee = await getEmployeeByDiscordUserId(env, session.userId);

  if (!employee) {
    if (session.isAdmin) {
      return cachedJson(request, {
        loggedIn: true,
        isAdmin: true,
        accessPending: false,
        employee: null,
        activeDisciplinaryRecords: [],
        disciplinaryHistory: []
      });
    }

    return cachedJson(request, {
      loggedIn: true,
      isAdmin: false,
      accessPending: true,
      employee: null,
      activeDisciplinaryRecords: [],
      disciplinaryHistory: []
    });
  }

  const activationStatus = String(employee.activation_status || '').trim().toUpperCase() || 'PENDING';
  if (!session.isAdmin && activationStatus !== 'ACTIVE') {
    return json(
      {
        error: 'Account pending activation.',
        activationStatus,
        accessPending: true
      },
      403
    );
  }

  await expireDisciplinaryRecordsForEmployee(env, Number(employee.id));
  const suspensionState = await reconcileEmployeeSuspensionState(env, Number(employee.id));
  const effectiveEmployee = suspensionState?.employee || employee;

  const disciplinaryHistory = await listDisciplinaryRecordsForEmployee(env, Number(employee.id));
  const activeDisciplinaryRecords = disciplinaryHistory.filter((item) => {
    const state = String(item.status || item.record_status || '').toLowerCase();
    return state === 'open' || state === 'active';
  });

  const statsRow = await env.DB
    .prepare(
      `SELECT
        COUNT(DISTINCT v.id) AS total_voyages,
        COUNT(
          DISTINCT CASE
            WHEN datetime(v.ended_at, 'localtime') >= datetime('now', 'localtime', 'start of month')
              AND datetime(v.ended_at, 'localtime') < datetime('now', 'localtime', 'start of month', '+1 month')
            THEN v.id
          END
        ) AS monthly_voyages
       FROM voyage_participants vp
       INNER JOIN voyages v ON v.id = vp.voyage_id
       WHERE vp.employee_id = ? AND v.deleted_at IS NULL AND v.status = 'ENDED'`
    )
    .bind(employee.id)
    .first();

  return cachedJson(request, {
    loggedIn: true,
    isAdmin: Boolean(session.isAdmin),
    accessPending: false,
    employee: {
      id: effectiveEmployee.id,
      robloxUsername: effectiveEmployee.roblox_username || '',
      robloxUserId: effectiveEmployee.roblox_user_id || '',
      rank: effectiveEmployee.rank || '',
      grade: effectiveEmployee.grade || '',
      serialNumber: effectiveEmployee.serial_number || '',
      employeeStatus: effectiveEmployee.employee_status || '',
      hireDate: effectiveEmployee.hire_date || '',
      tenureDays: calculateTenureDays(effectiveEmployee.hire_date)
    },
    voyageActivity: {
      totalVoyages: Number(statsRow?.total_voyages || 0),
      monthlyVoyages: Number(statsRow?.monthly_voyages || 0)
    },
    activeDisciplinaryRecords,
    disciplinaryHistory
  });
}
