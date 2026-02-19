import { json } from '../auth/_lib/auth.js';
import { hasPermission } from '../_lib/permissions.js';
import { requireVoyagePermission } from '../_lib/voyages.js';

function text(value) {
  return String(value || '').trim();
}

function asEmployeeIds(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

async function listConfigValues(env, tableName) {
  const rows = await env.DB.prepare(`SELECT id, value FROM ${tableName} ORDER BY value ASC, id ASC`).all();
  return rows?.results || [];
}

function valueSet(items) {
  return new Set((items || []).map((item) => String(item.value || '').trim().toLowerCase()).filter(Boolean));
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

  const [employees, ports, vesselNames, vesselClasses, vesselCallsigns] = await Promise.all([
    hasPermission(session, 'voyages.create')
      ? (
          await env.DB
            .prepare(
              'SELECT id, roblox_username, serial_number, rank, grade FROM employees ORDER BY roblox_username ASC, id ASC'
            )
            .all()
        )?.results || []
      : [],
    listConfigValues(env, 'config_voyage_ports'),
    listConfigValues(env, 'config_vessel_names'),
    listConfigValues(env, 'config_vessel_classes'),
    listConfigValues(env, 'config_vessel_callsigns')
  ]);

  return json({
    voyages,
    ongoing: voyages.filter((voyage) => voyage.isOngoing),
    archived: voyages.filter((voyage) => !voyage.isOngoing),
    employees,
    voyageConfig: {
      ports,
      vesselNames,
      vesselClasses,
      vesselCallsigns
    },
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

  const [ports, vesselNames, vesselClasses, vesselCallsigns] = await Promise.all([
    listConfigValues(env, 'config_voyage_ports'),
    listConfigValues(env, 'config_vessel_names'),
    listConfigValues(env, 'config_vessel_classes'),
    listConfigValues(env, 'config_vessel_callsigns')
  ]);
  const allowedPorts = valueSet(ports);
  const allowedNames = valueSet(vesselNames);
  const allowedClasses = valueSet(vesselClasses);
  const allowedCallsigns = valueSet(vesselCallsigns);

  if (
    !allowedPorts.has(departurePort.toLowerCase()) ||
    !allowedPorts.has(destinationPort.toLowerCase()) ||
    !allowedNames.has(vesselName.toLowerCase()) ||
    !allowedClasses.has(vesselClass.toLowerCase()) ||
    !allowedCallsigns.has(vesselCallsign.toLowerCase())
  ) {
    return json({ error: 'Voyage must use configured ports and vessel values.' }, 400);
  }

  const duplicateOngoing = await env.DB
    .prepare(
      `SELECT id
       FROM voyages
       WHERE status = 'ONGOING' AND LOWER(vessel_name) = LOWER(?) AND LOWER(vessel_callsign) = LOWER(?)
       LIMIT 1`
    )
    .bind(vesselName, vesselCallsign)
    .first();
  if (duplicateOngoing) {
    return json({ error: 'An ongoing voyage already exists for that vessel and callsign.' }, 400);
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

  let insert;
  try {
    insert = await env.DB
      .prepare(
        `INSERT INTO voyages
         (status, owner_employee_id, departure_port, destination_port, vessel_name, vessel_class, vessel_callsign, officer_of_watch_employee_id, started_at, updated_at)
         VALUES ('ONGOING', ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      )
      .bind(employee.id, departurePort, destinationPort, vesselName, vesselClass, vesselCallsign, officerOfWatchEmployeeId)
      .run();
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('ux_voyages_active_vessel_callsign')) {
      return json({ error: 'An ongoing voyage already exists for that vessel and callsign.' }, 400);
    }
    throw error;
  }
  const voyageId = Number(insert?.meta?.last_row_id);

  await env.DB.batch(
    crewComplementIds.map((crewId) =>
      env.DB.prepare('INSERT OR IGNORE INTO voyage_crew_members (voyage_id, employee_id) VALUES (?, ?)').bind(voyageId, crewId)
    )
  );

  const created = await env.DB.prepare('SELECT id FROM voyages WHERE id = ?').bind(voyageId).first();
  return json({ voyageId: created?.id || voyageId }, 201);
}
