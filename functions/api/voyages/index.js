import { json } from '../auth/_lib/auth.js';
import { hasPermission } from '../_lib/permissions.js';
import { requireVoyagePermission, toMoney } from '../_lib/voyages.js';

function text(value) {
  return String(value || '').trim();
}

function asEmployeeIds(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse, session, employee } = await requireVoyagePermission(context, 'voyages.read');
  if (errorResponse) return errorResponse;

  const rows = await env.DB
    .prepare(
      `SELECT v.id, v.status, v.owner_employee_id, v.departure_port, v.destination_port, v.vessel_name, v.vessel_class, v.vessel_callsign,
              v.officer_of_watch_employee_id, v.started_at, v.ended_at, v.buy_total, v.effective_sell, v.profit, v.company_share,
              ow.roblox_username AS officer_name,
              owner.roblox_username AS owner_name
       FROM voyages v
       LEFT JOIN employees ow ON ow.id = v.officer_of_watch_employee_id
       LEFT JOIN employees owner ON owner.id = v.owner_employee_id
       ORDER BY CASE WHEN v.status = 'ONGOING' THEN 0 ELSE 1 END, COALESCE(v.started_at, v.created_at) DESC, v.id DESC`
    )
    .all();

  const voyages = (rows?.results || []).map((voyage) => ({
    ...voyage,
    isOwner: Number(voyage.owner_employee_id) === Number(employee.id),
    isOngoing: String(voyage.status) === 'ONGOING'
  }));

  const employees = hasPermission(session, 'voyages.create')
    ? (
        await env.DB
          .prepare('SELECT id, roblox_username, rank, grade FROM employees ORDER BY roblox_username ASC, id ASC')
          .all()
      )?.results || []
    : [];

  return json({
    voyages,
    ongoing: voyages.filter((voyage) => voyage.isOngoing),
    archived: voyages.filter((voyage) => !voyage.isOngoing),
    employees,
    permissions: {
      canCreate: hasPermission(session, 'voyages.create'),
      canEdit: hasPermission(session, 'voyages.edit'),
      canEnd: hasPermission(session, 'voyages.end')
    }
  });
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse, employee } = await requireVoyagePermission(context, 'voyages.create');
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const departurePort = text(payload?.departurePort);
  const destinationPort = text(payload?.destinationPort);
  const vesselName = text(payload?.vesselName);
  const vesselClass = text(payload?.vesselClass);
  const vesselCallsign = text(payload?.vesselCallsign);
  const officerOfWatchEmployeeId = Number(payload?.officerOfWatchEmployeeId);
  const crewComplementIds = asEmployeeIds(payload?.crewComplementIds);

  if (!departurePort || !destinationPort || !vesselName || !vesselClass || !vesselCallsign) {
    return json({ error: 'All voyage start fields are required.' }, 400);
  }
  if (!Number.isInteger(officerOfWatchEmployeeId) || officerOfWatchEmployeeId <= 0) {
    return json({ error: 'Officer of the Watch is required.' }, 400);
  }
  if (!crewComplementIds.length) {
    return json({ error: 'Crew complement requires at least one employee.' }, 400);
  }

  const employeeRows = await env.DB
    .prepare(
      `SELECT id
       FROM employees
       WHERE id IN (${[officerOfWatchEmployeeId, ...crewComplementIds].map(() => '?').join(',')})`
    )
    .bind(officerOfWatchEmployeeId, ...crewComplementIds)
    .all();
  const knownIds = new Set((employeeRows?.results || []).map((row) => Number(row.id)));
  if (!knownIds.has(officerOfWatchEmployeeId) || crewComplementIds.some((id) => !knownIds.has(id))) {
    return json({ error: 'Selected crew members must exist.' }, 400);
  }

  const insert = await env.DB
    .prepare(
      `INSERT INTO voyages
       (status, owner_employee_id, departure_port, destination_port, vessel_name, vessel_class, vessel_callsign, officer_of_watch_employee_id, started_at, updated_at)
       VALUES ('ONGOING', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(employee.id, departurePort, destinationPort, vesselName, vesselClass, vesselCallsign, officerOfWatchEmployeeId)
    .run();
  const voyageId = Number(insert?.meta?.last_row_id);

  await env.DB.batch(
    crewComplementIds.map((crewId) =>
      env.DB.prepare('INSERT OR IGNORE INTO voyage_crew_members (voyage_id, employee_id) VALUES (?, ?)').bind(voyageId, crewId)
    )
  );

  const activeCargo = await env.DB
    .prepare('SELECT id, default_price FROM cargo_types WHERE active = 1 ORDER BY name ASC, id ASC')
    .all();
  if ((activeCargo?.results || []).length) {
    await env.DB.batch(
      activeCargo.results.map((cargo) => {
        const buyPrice = toMoney(cargo.default_price || 0);
        return env.DB
          .prepare(
            `INSERT INTO voyage_manifest_lines (voyage_id, cargo_type_id, quantity, buy_price, line_total, updated_at)
             VALUES (?, ?, 0, ?, 0, CURRENT_TIMESTAMP)`
          )
          .bind(voyageId, cargo.id, buyPrice);
      })
    );
  }

  const created = await env.DB.prepare('SELECT id FROM voyages WHERE id = ?').bind(voyageId).first();
  return json({ voyageId: created?.id || voyageId }, 201);
}
