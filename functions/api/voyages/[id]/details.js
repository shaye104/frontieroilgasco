import { json } from '../../auth/_lib/auth.js';
import { hasPermission } from '../../_lib/permissions.js';
import { getVoyageBase, getVoyageDetail, requireVoyagePermission } from '../../_lib/voyages.js';

function text(value) {
  return String(value || '').trim();
}

function asEmployeeIds(input) {
  if (!Array.isArray(input)) return [];
  return [...new Set(input.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
}

async function listConfigValues(env, tableName) {
  const rows = await env.DB.prepare(`SELECT value FROM ${tableName}`).all();
  return new Set((rows?.results || []).map((row) => String(row.value || '').trim().toLowerCase()).filter(Boolean));
}

function changeLine(fieldLabel, fromValue, toValue) {
  return `${fieldLabel} changed: ${fromValue || 'N/A'} -> ${toValue || 'N/A'}`;
}

export async function onRequestPut(context) {
  const { env, params } = context;
  const { errorResponse, employee, session } = await requireVoyagePermission(context, 'voyages.edit');
  if (errorResponse) return errorResponse;

  const voyageId = Number(params.id);
  if (!Number.isInteger(voyageId) || voyageId <= 0) return json({ error: 'Invalid voyage id.' }, 400);

  const voyage = await getVoyageBase(env, voyageId);
  if (!voyage) return json({ error: 'Voyage not found.' }, 404);
  if (String(voyage.status) !== 'ONGOING') return json({ error: 'Only ongoing voyages can be edited.' }, 400);
  if (!hasPermission(session, 'voyages.edit') || Number(voyage.owner_employee_id) !== Number(employee.id)) {
    return json({ error: 'Only the voyage owner can edit voyage details.' }, 403);
  }

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const currentCrewRows = await env.DB
    .prepare(
      `SELECT e.id, e.roblox_username
       FROM voyage_crew_members vcm
       INNER JOIN employees e ON e.id = vcm.employee_id
       WHERE vcm.voyage_id = ?
       ORDER BY e.roblox_username ASC, e.id ASC`
    )
    .bind(voyageId)
    .all();
  const currentCrew = currentCrewRows?.results || [];

  const departurePort = text(payload?.departurePort) || text(voyage.departure_port);
  const destinationPort = text(payload?.destinationPort) || text(voyage.destination_port);
  const vesselName = text(payload?.vesselName) || text(voyage.vessel_name);
  const vesselClass = text(payload?.vesselClass) || text(voyage.vessel_class);
  const vesselCallsign = text(payload?.vesselCallsign) || text(voyage.vessel_callsign);
  const officerOfWatchEmployeeId = Number(payload?.officerOfWatchEmployeeId || voyage.officer_of_watch_employee_id);
  let crewComplementIds = Array.isArray(payload?.crewComplementIds)
    ? asEmployeeIds(payload?.crewComplementIds)
    : currentCrew.map((row) => Number(row.id));

  if (!departurePort || !destinationPort || !vesselName || !vesselClass || !vesselCallsign) {
    return json({ error: 'All voyage detail fields are required.' }, 400);
  }
  if (!Number.isInteger(officerOfWatchEmployeeId) || officerOfWatchEmployeeId <= 0) {
    return json({ error: 'Officer of the Watch is required.' }, 400);
  }
  if (crewComplementIds.includes(officerOfWatchEmployeeId)) {
    crewComplementIds = crewComplementIds.filter((id) => id !== officerOfWatchEmployeeId);
  }

  const [ports, vesselNames, vesselClasses, vesselCallsigns] = await Promise.all([
    listConfigValues(env, 'config_voyage_ports'),
    listConfigValues(env, 'config_vessel_names'),
    listConfigValues(env, 'config_vessel_classes'),
    listConfigValues(env, 'config_vessel_callsigns')
  ]);
  if (
    !ports.has(departurePort.toLowerCase()) ||
    !ports.has(destinationPort.toLowerCase()) ||
    !vesselNames.has(vesselName.toLowerCase()) ||
    !vesselClasses.has(vesselClass.toLowerCase()) ||
    !vesselCallsigns.has(vesselCallsign.toLowerCase())
  ) {
    return json({ error: 'Voyage must use configured ports and vessel values.' }, 400);
  }

  const duplicateOngoing = await env.DB
    .prepare(
      `SELECT id
       FROM voyages
       WHERE status = 'ONGOING' AND id != ? AND LOWER(vessel_name) = LOWER(?) AND LOWER(vessel_callsign) = LOWER(?)
       LIMIT 1`
    )
    .bind(voyageId, vesselName, vesselCallsign)
    .first();
  if (duplicateOngoing) {
    return json({ error: 'An ongoing voyage already exists for that vessel and callsign.' }, 400);
  }

  const selectedIds = [officerOfWatchEmployeeId, ...crewComplementIds];
  const employeeRows = await env.DB
    .prepare(
      `SELECT id, roblox_username
       FROM employees
       WHERE id IN (${selectedIds.map(() => '?').join(',')})`
    )
    .bind(...selectedIds)
    .all();
  const employeeMap = new Map((employeeRows?.results || []).map((row) => [Number(row.id), row]));
  if (!employeeMap.has(officerOfWatchEmployeeId) || crewComplementIds.some((id) => !employeeMap.has(id))) {
    return json({ error: 'Selected crew members must exist.' }, 400);
  }

  const currentCrewIds = new Set(currentCrew.map((row) => Number(row.id)));
  const nextCrewIds = new Set(crewComplementIds);

  const logs = [];
  if (voyage.departure_port !== departurePort) logs.push(changeLine('Departure Port', voyage.departure_port, departurePort));
  if (voyage.destination_port !== destinationPort)
    logs.push(changeLine('Destination Port', voyage.destination_port, destinationPort));
  if (voyage.vessel_name !== vesselName) logs.push(changeLine('Vessel Name', voyage.vessel_name, vesselName));
  if (voyage.vessel_class !== vesselClass) logs.push(changeLine('Vessel Class', voyage.vessel_class, vesselClass));
  if (voyage.vessel_callsign !== vesselCallsign) logs.push(changeLine('Vessel Callsign', voyage.vessel_callsign, vesselCallsign));

  const oldOow = String(voyage.officer_name || 'N/A');
  const nextOow = String(employeeMap.get(officerOfWatchEmployeeId)?.roblox_username || 'N/A');
  if (Number(voyage.officer_of_watch_employee_id) !== officerOfWatchEmployeeId) {
    logs.push(changeLine('Officer of the Watch', oldOow, nextOow));
    if (currentCrewIds.has(officerOfWatchEmployeeId)) {
      logs.push(`Crew Complement auto-update: removed ${nextOow} because Officer of the Watch cannot be in crew.`);
    }
  }

  const crewChanged =
    currentCrew.length !== crewComplementIds.length || [...nextCrewIds].some((id) => !currentCrewIds.has(id));
  if (crewChanged) {
    const oldCrew = currentCrew.map((row) => row.roblox_username).join(', ') || 'N/A';
    const nextCrew = crewComplementIds.map((id) => employeeMap.get(id)?.roblox_username || `#${id}`).join(', ') || 'N/A';
    logs.push(changeLine('Crew Complement', oldCrew, nextCrew));
  }

  try {
    await env.DB
      .prepare(
        `UPDATE voyages
         SET departure_port = ?, destination_port = ?, vessel_name = ?, vessel_class = ?, vessel_callsign = ?,
             officer_of_watch_employee_id = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(departurePort, destinationPort, vesselName, vesselClass, vesselCallsign, officerOfWatchEmployeeId, voyageId)
      .run();
  } catch (error) {
    if (String(error?.message || '').toLowerCase().includes('ux_voyages_active_vessel_callsign')) {
      return json({ error: 'An ongoing voyage already exists for that vessel and callsign.' }, 400);
    }
    throw error;
  }

  await env.DB.prepare('DELETE FROM voyage_crew_members WHERE voyage_id = ?').bind(voyageId).run();
  if (crewComplementIds.length) {
    await env.DB.batch(
      crewComplementIds.map((crewId) =>
        env.DB.prepare('INSERT INTO voyage_crew_members (voyage_id, employee_id) VALUES (?, ?)').bind(voyageId, crewId)
      )
    );
  }

  if (logs.length) {
    await env.DB.batch(
      logs.map((message) =>
        env.DB
          .prepare('INSERT INTO voyage_logs (voyage_id, author_employee_id, message, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP)')
          .bind(voyageId, employee.id, message)
      )
    );
  }

  const detail = await getVoyageDetail(env, voyageId);
  return json({ ok: true, detail });
}
