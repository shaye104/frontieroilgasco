import { cachedJson, json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { calculateTenureDays, createOrRefreshAccessRequest, ensureCoreSchema, getEmployeeByDiscordUserId } from '../_lib/db.js';
import { enrichSessionWithPermissions, hasPermission } from '../_lib/permissions.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const rawSession = await readSessionFromRequest(env, request);
  const session = rawSession ? await enrichSessionWithPermissions(env, rawSession) : null;

  if (!session) {
    return json({ loggedIn: false }, 401);
  }

  if (!hasPermission(session, 'my_details.view')) {
    return json({ error: 'Forbidden. Missing required permission.' }, 403);
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

    await createOrRefreshAccessRequest(env, {
      discordUserId: session.userId,
      displayName: session.displayName
    });

    return cachedJson(request, {
      loggedIn: true,
      isAdmin: false,
      accessPending: true,
      employee: null,
      activeDisciplinaryRecords: [],
      disciplinaryHistory: []
    });
  }

  const disciplinaryQuery = await env.DB.prepare(
    `SELECT id, record_type, record_date, record_status, notes, issued_by, created_at
     FROM disciplinary_records
     WHERE employee_id = ?
     ORDER BY COALESCE(record_date, created_at) DESC`
  )
    .bind(employee.id)
    .all();

  const disciplinaryHistory = disciplinaryQuery?.results || [];
  const activeDisciplinaryRecords = disciplinaryHistory.filter((item) => {
    const state = String(item.record_status || '').toLowerCase();
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
       WHERE vp.employee_id = ? AND v.status = 'ENDED'`
    )
    .bind(employee.id)
    .first();

  return cachedJson(request, {
    loggedIn: true,
    isAdmin: Boolean(session.isAdmin),
    accessPending: false,
    employee: {
      id: employee.id,
      robloxUsername: employee.roblox_username || '',
      robloxUserId: employee.roblox_user_id || '',
      rank: employee.rank || '',
      grade: employee.grade || '',
      serialNumber: employee.serial_number || '',
      employeeStatus: employee.employee_status || '',
      hireDate: employee.hire_date || '',
      tenureDays: calculateTenureDays(employee.hire_date)
    },
    voyageActivity: {
      totalVoyages: Number(statsRow?.total_voyages || 0),
      monthlyVoyages: Number(statsRow?.monthly_voyages || 0)
    },
    activeDisciplinaryRecords,
    disciplinaryHistory
  });
}
