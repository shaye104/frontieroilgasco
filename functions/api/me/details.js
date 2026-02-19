import { json, readSessionFromRequest } from '../auth/_lib/auth.js';
import { calculateTenureDays, createOrRefreshAccessRequest, ensureCoreSchema, getEmployeeByDiscordUserId } from '../_lib/db.js';

export async function onRequestGet(context) {
  const { env, request } = context;
  const session = await readSessionFromRequest(env, request);

  if (!session) {
    return json({ loggedIn: false }, 401);
  }

  try {
    await ensureCoreSchema(env);
  } catch (error) {
    return json({ error: error.message || 'Database unavailable.' }, 500);
  }

  if (session.isAdmin) {
    return json({
      loggedIn: true,
      isAdmin: true,
      accessPending: false,
      employee: null,
      activeDisciplinaryRecords: [],
      disciplinaryHistory: []
    });
  }

  const employee = await getEmployeeByDiscordUserId(env, session.userId);

  if (!employee) {
    await createOrRefreshAccessRequest(env, {
      discordUserId: session.userId,
      displayName: session.displayName
    });

    return json({
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

  return json({
    loggedIn: true,
    isAdmin: false,
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
    activeDisciplinaryRecords,
    disciplinaryHistory
  });
}
