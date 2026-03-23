import { json } from '../../../auth/_lib/auth.js';
import { requirePermission } from '../../_lib/admin-auth.js';
import {
  assignEmployeeVessel,
  canEditEmployeeByRank,
  clearEmployeeVesselAssignment,
  getEmployeeActiveVesselAssignment,
  getEmployeeById,
  getShipyardShipById,
  writeAdminActivityEvent
} from '../../../_lib/db.js';
import { getActorAccessScope, hasHierarchyBypass } from '../../_lib/access-scope.js';

function text(value) {
  return String(value || '').trim();
}

async function requireHierarchyEdit(env, session, targetEmployee) {
  if (hasHierarchyBypass(env, session)) return { ok: true, actorEmployee: null };
  const scope = await getActorAccessScope(env, session);
  if (!scope.actorEmployee) return { ok: false, error: 'You do not have an employee profile to manage users.' };
  const canEdit = await canEditEmployeeByRank(env, scope.actorEmployee, targetEmployee, { allowSelf: false, allowEqual: false });
  if (!canEdit) return { ok: false, error: 'You can only edit profiles beneath your hierarchy.' };
  return { ok: true, actorEmployee: scope.actorEmployee };
}

export async function onRequestPut(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.edit']);
  if (errorResponse) return errorResponse;

  const employeeId = Number(params.id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return json({ error: 'Invalid employee id.' }, 400);

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const employee = await getEmployeeById(env, employeeId);
  if (!employee) return json({ error: 'Employee not found.' }, 404);

  const hierarchy = await requireHierarchyEdit(env, session, employee);
  if (!hierarchy.ok) return json({ error: hierarchy.error }, 403);

  const shipId = Number(payload?.shipId);
  let vesselName = text(payload?.vesselName);
  let vesselClass = text(payload?.vesselClass);
  let vesselCallsign = text(payload?.vesselCallsign);
  const note = text(payload?.note);
  if (Number.isInteger(shipId) && shipId > 0) {
    const ship = await getShipyardShipById(env, shipId);
    if (!ship || Number(ship.is_active || 0) !== 1) {
      return json({ error: 'Selected ship is not active.' }, 400);
    }
    vesselName = text(ship.ship_name);
    vesselClass = text(ship.vessel_class);
    vesselCallsign = text(ship.vessel_callsign) || vesselName;
  }
  if (!vesselName || !vesselClass) {
    return json({ error: 'Ship selection is required.' }, 400);
  }

  const previous = await getEmployeeActiveVesselAssignment(env, employeeId);
  const assignment = await assignEmployeeVessel(env, {
    employeeId,
    shipId,
    vesselName,
    vesselClass,
    vesselCallsign,
    note,
    assignedByEmployeeId: hierarchy.actorEmployee?.id || null
  });

  await writeAdminActivityEvent(env, {
    actorEmployeeId: hierarchy.actorEmployee?.id || null,
    actorName: session.displayName || session.userId,
    actorDiscordUserId: session.userId,
    actionType: 'EMPLOYEE_VESSEL_ASSIGNED',
    targetEmployeeId: employeeId,
    summary: `Assigned vessel ${vesselName} (${vesselClass}) to ${employee.roblox_username || `#${employeeId}`}.`,
    metadata: {
      previous: previous
        ? {
            shipId: previous.ship_id,
            vesselName: previous.vessel_name,
            vesselClass: previous.vessel_class
          }
        : null,
      current: {
        shipId: Number.isInteger(shipId) && shipId > 0 ? shipId : null,
        vesselName,
        vesselClass
      },
      note: note || null
    }
  });

  return json({ assignment });
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.edit']);
  if (errorResponse) return errorResponse;

  const employeeId = Number(params.id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return json({ error: 'Invalid employee id.' }, 400);

  const employee = await getEmployeeById(env, employeeId);
  if (!employee) return json({ error: 'Employee not found.' }, 404);

  const hierarchy = await requireHierarchyEdit(env, session, employee);
  if (!hierarchy.ok) return json({ error: hierarchy.error }, 403);

  const previous = await getEmployeeActiveVesselAssignment(env, employeeId);
  if (!previous) return json({ ok: true, cleared: 0 });
  const cleared = await clearEmployeeVesselAssignment(env, { employeeId });

  await writeAdminActivityEvent(env, {
    actorEmployeeId: hierarchy.actorEmployee?.id || null,
    actorName: session.displayName || session.userId,
    actorDiscordUserId: session.userId,
    actionType: 'EMPLOYEE_VESSEL_UNASSIGNED',
    targetEmployeeId: employeeId,
    summary: `Cleared active vessel assignment for ${employee.roblox_username || `#${employeeId}`}.`,
    metadata: {
      previous: {
        shipId: previous.ship_id,
        vesselName: previous.vessel_name,
        vesselClass: previous.vessel_class
      }
    }
  });

  return json({ ok: true, cleared });
}
