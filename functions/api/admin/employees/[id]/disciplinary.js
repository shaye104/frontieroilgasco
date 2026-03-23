import { json } from '../../../auth/_lib/auth.js';
import { requirePermission } from '../../_lib/admin-auth.js';
import { canEditEmployeeByRank, getEmployeeByDiscordUserId } from '../../../_lib/db.js';
import {
  createDisciplinaryRecord,
  expireDisciplinaryRecordsForEmployee,
  listDisciplinaryRecordsForEmployee,
  patchDisciplinaryRecord,
  reconcileEmployeeSuspensionState
} from '../../../_lib/disciplinary.js';
import { hasHierarchyBypass } from '../../_lib/access-scope.js';

async function assertEditableTarget(env, session, employeeId) {
  const targetEmployee = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  if (!targetEmployee) return { error: json({ error: 'Employee not found.' }, 404), targetEmployee: null, actorEmployee: null };
  const actorEmployee = await getEmployeeByDiscordUserId(env, session.userId);
  const canEditByRank = actorEmployee
    ? await canEditEmployeeByRank(env, actorEmployee, targetEmployee, { allowSelf: false, allowEqual: false })
    : false;
  if (!hasHierarchyBypass(env, session) && !canEditByRank) {
    return {
      error: json({ error: 'You can only manage disciplinary records for profiles beneath your hierarchy.' }, 403),
      targetEmployee,
      actorEmployee
    };
  }
  return { error: null, targetEmployee, actorEmployee };
}

function parseEmployeeId(params) {
  const employeeId = Number(params.id);
  if (!Number.isInteger(employeeId) || employeeId <= 0) return null;
  return employeeId;
}

export async function onRequestGet(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.read']);
  if (errorResponse) return errorResponse;

  const employeeId = parseEmployeeId(params);
  if (!employeeId) return json({ error: 'Invalid employee id.' }, 400);
  const editable = await assertEditableTarget(env, session, employeeId);
  if (editable.error) return editable.error;

  await expireDisciplinaryRecordsForEmployee(env, employeeId);
  const suspensionState = await reconcileEmployeeSuspensionState(env, employeeId);
  const records = await listDisciplinaryRecordsForEmployee(env, employeeId);
  return json({
    records,
    suspensionState: {
      isSuspended: Boolean(suspensionState?.suspended),
      suspendedUntil: suspensionState?.suspendedUntil || null
    }
  });
}

export async function onRequestPost(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.discipline']);
  if (errorResponse) return errorResponse;

  const employeeId = parseEmployeeId(params);
  if (!employeeId) return json({ error: 'Invalid employee id.' }, 400);
  const editable = await assertEditableTarget(env, session, employeeId);
  if (editable.error) return editable.error;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  try {
    await expireDisciplinaryRecordsForEmployee(env, employeeId);
    const created = await createDisciplinaryRecord(env, {
      employeeId,
      actorEmployeeId: editable.actorEmployee?.id || null,
      actorName: session.displayName || session.userId,
      actorDiscordUserId: session.userId,
      payload
    });
    const records = await listDisciplinaryRecordsForEmployee(env, employeeId);
    return json(
      {
        record: created.record,
        records,
        suspensionState: {
          isSuspended: Boolean(created?.suspensionState?.suspended),
          suspendedUntil: created?.suspensionState?.suspendedUntil || null
        }
      },
      201
    );
  } catch (error) {
    return json({ error: error.message || 'Unable to create disciplinary record.' }, 400);
  }
}

export async function onRequestPatch(context) {
  const { env, params } = context;
  const { errorResponse, session } = await requirePermission(context, ['employees.discipline']);
  if (errorResponse) return errorResponse;

  const employeeId = parseEmployeeId(params);
  if (!employeeId) return json({ error: 'Invalid employee id.' }, 400);
  const editable = await assertEditableTarget(env, session, employeeId);
  if (editable.error) return editable.error;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }
  const recordId = Number(payload?.recordId || payload?.id);
  if (!Number.isInteger(recordId) || recordId <= 0) return json({ error: 'recordId is required.' }, 400);

  try {
    await expireDisciplinaryRecordsForEmployee(env, employeeId);
    const patched = await patchDisciplinaryRecord(env, {
      employeeId,
      recordId,
      actorEmployeeId: editable.actorEmployee?.id || null,
      actorName: session.displayName || session.userId,
      actorDiscordUserId: session.userId,
      payload
    });
    const records = await listDisciplinaryRecordsForEmployee(env, employeeId);
    return json({
      record: patched.record,
      records,
      suspensionState: {
        isSuspended: Boolean(patched?.suspensionState?.suspended),
        suspendedUntil: patched?.suspensionState?.suspendedUntil || null
      }
    });
  } catch (error) {
    return json({ error: error.message || 'Unable to update disciplinary record.' }, 400);
  }
}
