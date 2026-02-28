import { writeAdminActivityEvent } from './db.js';

function text(value) {
  return String(value || '').trim();
}

function toStatus(value, fallback = 'ACTIVE') {
  const normalized = text(value).toUpperCase();
  if (['ACTIVE', 'OPEN', 'CLOSED', 'REVOKED', 'EXPIRED'].includes(normalized)) return normalized;
  return fallback;
}

function toTypeKey(value, fallback = 'WARNING') {
  const raw = text(value);
  if (!raw) return fallback;
  return raw
    .replace(/[^A-Za-z0-9 _-]/g, '')
    .trim()
    .replace(/[\s-]+/g, '_')
    .toUpperCase();
}

function toIsoOrNull(value) {
  const raw = text(value);
  if (!raw) return null;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function isActiveStatus(status) {
  return status === 'ACTIVE' || status === 'OPEN';
}

async function getSuspendedRankValue(env) {
  const row = await env.DB.prepare(`SELECT value FROM config_settings WHERE key = 'SUSPENDED_RANK_VALUE'`).first();
  const value = text(row?.value);
  return value || 'Suspended';
}

async function getTypeConfigByKey(env, typeKey) {
  return env.DB
    .prepare(
      `SELECT id, key, label, severity, is_active, default_status, requires_end_date, default_duration_days,
              apply_suspension_rank, set_employee_status, restrict_intranet, restrict_voyages, restrict_finance
       FROM config_disciplinary_types
       WHERE UPPER(COALESCE(key, '')) = UPPER(?)
       LIMIT 1`
    )
    .bind(typeKey)
    .first();
}

async function getLatestActiveSuspension(env, employeeId) {
  const row = await env.DB
    .prepare(
      `SELECT
         dr.id,
         dr.type_key,
         dr.status,
         dr.effective_at,
         dr.ends_at,
         dr.reason_text,
         dr.internal_notes,
         dt.apply_suspension_rank,
         dt.set_employee_status
       FROM disciplinary_records dr
       LEFT JOIN config_disciplinary_types dt ON UPPER(COALESCE(dt.key, '')) = UPPER(COALESCE(dr.type_key, ''))
       WHERE dr.employee_id = ?
         AND UPPER(COALESCE(dr.status, 'ACTIVE')) IN ('ACTIVE', 'OPEN')
         AND COALESCE(dt.apply_suspension_rank, 0) = 1
       ORDER BY COALESCE(dr.effective_at, dr.created_at) DESC, dr.id DESC
       LIMIT 1`
    )
    .bind(employeeId)
    .first();
  return row || null;
}

export async function expireDisciplinaryRecordsForEmployee(env, employeeId, actor = null) {
  const nowIso = new Date().toISOString();
  const expiring = await env.DB
    .prepare(
      `SELECT id
       FROM disciplinary_records
       WHERE employee_id = ?
         AND UPPER(COALESCE(status, 'ACTIVE')) IN ('ACTIVE', 'OPEN')
         AND ends_at IS NOT NULL
         AND ends_at != ''
         AND datetime(ends_at) <= datetime(?)`
    )
    .bind(employeeId, nowIso)
    .all();
  const rows = expiring?.results || [];
  if (!rows.length) return 0;
  const ids = rows.map((row) => Number(row.id)).filter((value) => Number.isInteger(value) && value > 0);
  if (!ids.length) return 0;
  const placeholders = ids.map(() => '?').join(', ');
  await env.DB
    .prepare(
      `UPDATE disciplinary_records
       SET status = 'EXPIRED',
           closed_at = CURRENT_TIMESTAMP,
           close_note = COALESCE(NULLIF(TRIM(close_note), ''), 'Auto-expired by end date.'),
           updated_at = CURRENT_TIMESTAMP
       WHERE id IN (${placeholders})`
    )
    .bind(...ids)
    .run();
  if (actor) {
    await writeAdminActivityEvent(env, {
      actorEmployeeId: actor.actorEmployeeId || null,
      actorName: actor.actorName || 'System',
      actorDiscordUserId: actor.actorDiscordUserId || '',
      actionType: 'DISCIPLINARY_STATUS_CHANGED',
      targetEmployeeId: employeeId,
      summary: `Disciplinary records auto-expired for employee #${employeeId}.`,
      metadata: { ids, nextStatus: 'EXPIRED', reason: 'ends_at_passed' }
    });
  }
  return ids.length;
}

export async function reconcileEmployeeSuspensionState(env, employeeId, actor = null) {
  const employee = await env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(employeeId).first();
  if (!employee) return { employee: null, suspended: false };

  const suspendedRankValue = await getSuspendedRankValue(env);
  const activeSuspension = await getLatestActiveSuspension(env, employeeId);

  if (activeSuspension) {
    const currentRank = text(employee.rank);
    const suspensionBefore = text(employee.suspension_rank_before);
    const shouldSetBefore = !suspensionBefore && currentRank && currentRank.toLowerCase() !== suspendedRankValue.toLowerCase();
    const nextBeforeRank = shouldSetBefore ? currentRank : suspensionBefore || null;
    const nextEmployeeStatus = text(activeSuspension.set_employee_status) || text(employee.employee_status) || null;

    await env.DB
      .prepare(
        `UPDATE employees
         SET rank = ?,
             employee_status = ?,
             suspension_rank_before = ?,
             suspension_active_record_id = ?,
             suspension_started_at = COALESCE(NULLIF(?, ''), CURRENT_TIMESTAMP),
             suspension_ends_at = ?,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      )
      .bind(
        suspendedRankValue,
        nextEmployeeStatus,
        nextBeforeRank,
        Number(activeSuspension.id),
        text(activeSuspension.effective_at) || null,
        text(activeSuspension.ends_at) || null,
        employeeId
      )
      .run();

    const changedToSuspendedRank = currentRank.toLowerCase() !== suspendedRankValue.toLowerCase();
    if (actor && changedToSuspendedRank) {
      await writeAdminActivityEvent(env, {
        actorEmployeeId: actor.actorEmployeeId || null,
        actorName: actor.actorName || 'System',
        actorDiscordUserId: actor.actorDiscordUserId || '',
        actionType: 'SUSPENSION_APPLIED',
        targetEmployeeId: employeeId,
        summary: `Suspension applied and rank moved to ${suspendedRankValue}.`,
        metadata: {
          suspensionRecordId: Number(activeSuspension.id),
          previousRank: currentRank || null,
          suspendedRank: suspendedRankValue
        }
      });
      await writeAdminActivityEvent(env, {
        actorEmployeeId: actor.actorEmployeeId || null,
        actorName: actor.actorName || 'System',
        actorDiscordUserId: actor.actorDiscordUserId || '',
        actionType: 'RANK_CHANGED_AUTOMATED',
        targetEmployeeId: employeeId,
        summary: `Rank changed automatically to ${suspendedRankValue}.`,
        metadata: {
          fromRank: currentRank || null,
          toRank: suspendedRankValue,
          reason: 'suspension'
        }
      });
    }
  } else {
    const currentRank = text(employee.rank);
    const beforeRank = text(employee.suspension_rank_before);
    const hasSuspensionState = Boolean(employee.suspension_active_record_id || beforeRank || employee.suspension_started_at || employee.suspension_ends_at);
    if (hasSuspensionState) {
      let restoredRank = null;
      if (beforeRank && currentRank.toLowerCase() === suspendedRankValue.toLowerCase()) {
        restoredRank = beforeRank;
      }
      await env.DB
        .prepare(
          `UPDATE employees
           SET rank = COALESCE(?, rank),
               suspension_rank_before = NULL,
               suspension_active_record_id = NULL,
               suspension_started_at = NULL,
               suspension_ends_at = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`
        )
        .bind(restoredRank, employeeId)
        .run();

      if (actor) {
        await writeAdminActivityEvent(env, {
          actorEmployeeId: actor.actorEmployeeId || null,
          actorName: actor.actorName || 'System',
          actorDiscordUserId: actor.actorDiscordUserId || '',
          actionType: 'SUSPENSION_ENDED',
          targetEmployeeId: employeeId,
          summary: restoredRank
            ? `Suspension ended and rank restored to ${restoredRank}.`
            : 'Suspension ended and tracking state cleared.',
          metadata: {
            restoredRank: restoredRank || null,
            previousRank: currentRank || null
          }
        });
      }
    }
  }

  const nextEmployee = await env.DB.prepare(`SELECT * FROM employees WHERE id = ?`).bind(employeeId).first();
  return {
    employee: nextEmployee || null,
    suspended: Boolean(nextEmployee?.suspension_active_record_id),
    suspendedUntil: text(nextEmployee?.suspension_ends_at) || null
  };
}

export async function createDisciplinaryRecord(env, options = {}) {
  const employeeId = Number(options.employeeId);
  const actorEmployeeId = Number(options.actorEmployeeId || 0) || null;
  const actorName = text(options.actorName) || 'System';
  const actorDiscordUserId = text(options.actorDiscordUserId);
  const payload = options.payload || {};

  const typeKey = toTypeKey(payload.typeKey || payload.recordType || payload.key, 'WARNING');
  const typeConfig = await getTypeConfigByKey(env, typeKey);
  if (!typeConfig || Number(typeConfig.is_active || 0) !== 1) {
    throw new Error('Invalid or inactive disciplinary type.');
  }

  const effectiveAt = toIsoOrNull(payload.effectiveAt || payload.recordDate) || new Date().toISOString();
  let endsAt = toIsoOrNull(payload.endsAt || payload.effectiveTo);
  const defaultDuration = Number(typeConfig.default_duration_days);
  if (!endsAt && Number.isFinite(defaultDuration) && defaultDuration > 0) {
    endsAt = new Date(Date.now() + defaultDuration * 24 * 60 * 60 * 1000).toISOString();
  }
  if (Number(typeConfig.requires_end_date || 0) === 1 && !endsAt) {
    throw new Error('This disciplinary type requires an end date.');
  }

  const reasonText = text(payload.reasonText || payload.reason || payload.notes);
  if (!reasonText) throw new Error('Reason text is required.');
  const internalNotes = text(payload.internalNotes);
  const status = toStatus(payload.status || payload.recordStatus || typeConfig.default_status, 'ACTIVE');

  const rowResult = await env.DB
    .prepare(
      `INSERT INTO disciplinary_records
         (employee_id, type_key, status, effective_at, ends_at, reason_text, internal_notes, issued_by_employee_id, issued_by_name,
          record_type, record_date, record_status, notes, issued_by, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
    )
    .bind(
      employeeId,
      typeKey,
      status,
      effectiveAt,
      endsAt,
      reasonText,
      internalNotes || null,
      actorEmployeeId,
      actorName,
      text(typeConfig.label || typeConfig.value || typeKey),
      effectiveAt,
      status,
      reasonText,
      actorName
    )
    .run();
  const recordId = Number(rowResult?.meta?.last_row_id || 0);

  await writeAdminActivityEvent(env, {
    actorEmployeeId,
    actorName,
    actorDiscordUserId,
    actionType: 'DISCIPLINARY_CREATED',
    targetEmployeeId: employeeId,
    summary: `Disciplinary record ${typeKey} created for employee #${employeeId}.`,
    metadata: {
      recordId,
      typeKey,
      status,
      effectiveAt,
      endsAt,
      applySuspensionRank: Number(typeConfig.apply_suspension_rank || 0) === 1
    }
  });

  const state = await reconcileEmployeeSuspensionState(env, employeeId, {
    actorEmployeeId,
    actorName,
    actorDiscordUserId
  });

  const record = await env.DB
    .prepare(
      `SELECT
         dr.id, dr.employee_id, dr.type_key, dr.status, dr.effective_at, dr.ends_at, dr.reason_text, dr.internal_notes,
         dr.issued_by_employee_id, dr.issued_by_name, dr.closed_at, dr.close_note, dr.created_at, dr.updated_at,
         COALESCE(dt.label, dt.value, dr.type_key) AS type_label
       FROM disciplinary_records dr
       LEFT JOIN config_disciplinary_types dt ON UPPER(COALESCE(dt.key, '')) = UPPER(COALESCE(dr.type_key, ''))
       WHERE dr.id = ?`
    )
    .bind(recordId)
    .first();

  return { record, suspensionState: state };
}

export async function patchDisciplinaryRecord(env, options = {}) {
  const employeeId = Number(options.employeeId);
  const recordId = Number(options.recordId);
  if (!Number.isInteger(recordId) || recordId <= 0) throw new Error('Invalid disciplinary record id.');

  const actorEmployeeId = Number(options.actorEmployeeId || 0) || null;
  const actorName = text(options.actorName) || 'System';
  const actorDiscordUserId = text(options.actorDiscordUserId);
  const payload = options.payload || {};
  const action = toTypeKey(payload.action || '', '');

  const existing = await env.DB
    .prepare(`SELECT * FROM disciplinary_records WHERE id = ? AND employee_id = ? LIMIT 1`)
    .bind(recordId, employeeId)
    .first();
  if (!existing) throw new Error('Disciplinary record not found.');

  let nextStatus = toStatus(payload.status || existing.status || existing.record_status, 'ACTIVE');
  let closeNote = text(payload.closeNote || existing.close_note);
  let endsAt = toIsoOrNull(payload.endsAt ?? existing.ends_at) || null;

  if (action === 'CLOSE') nextStatus = 'CLOSED';
  if (action === 'REVOKE') nextStatus = 'REVOKED';
  if (action === 'EXTEND') {
    nextStatus = isActiveStatus(nextStatus) ? nextStatus : 'ACTIVE';
    if (!toIsoOrNull(payload.endsAt)) throw new Error('endsAt is required to extend.');
  }

  await env.DB
    .prepare(
      `UPDATE disciplinary_records
       SET status = ?,
           record_status = ?,
           ends_at = ?,
           close_note = CASE WHEN ? IN ('CLOSED','REVOKED') THEN COALESCE(NULLIF(?, ''), close_note) ELSE close_note END,
           closed_at = CASE WHEN ? IN ('CLOSED','REVOKED','EXPIRED') THEN COALESCE(closed_at, CURRENT_TIMESTAMP) ELSE NULL END,
           closed_by_employee_id = CASE WHEN ? IN ('CLOSED','REVOKED','EXPIRED') THEN ? ELSE NULL END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(
      nextStatus,
      nextStatus,
      endsAt,
      nextStatus,
      closeNote || null,
      nextStatus,
      nextStatus,
      actorEmployeeId,
      recordId
    )
    .run();

  await writeAdminActivityEvent(env, {
    actorEmployeeId,
    actorName,
    actorDiscordUserId,
    actionType: 'DISCIPLINARY_STATUS_CHANGED',
    targetEmployeeId: employeeId,
    summary: `Disciplinary record #${recordId} updated to ${nextStatus}.`,
    metadata: {
      recordId,
      action: action || 'PATCH',
      status: nextStatus,
      endsAt,
      closeNote: closeNote || null
    }
  });

  const state = await reconcileEmployeeSuspensionState(env, employeeId, {
    actorEmployeeId,
    actorName,
    actorDiscordUserId
  });
  const record = await env.DB
    .prepare(
      `SELECT
         dr.id, dr.employee_id, dr.type_key, dr.status, dr.effective_at, dr.ends_at, dr.reason_text, dr.internal_notes,
         dr.issued_by_employee_id, dr.issued_by_name, dr.closed_at, dr.close_note, dr.created_at, dr.updated_at,
         COALESCE(dt.label, dt.value, dr.type_key) AS type_label
       FROM disciplinary_records dr
       LEFT JOIN config_disciplinary_types dt ON UPPER(COALESCE(dt.key, '')) = UPPER(COALESCE(dr.type_key, ''))
       WHERE dr.id = ?`
    )
    .bind(recordId)
    .first();

  return { record, suspensionState: state };
}

export async function listDisciplinaryRecordsForEmployee(env, employeeId) {
  const result = await env.DB
    .prepare(
      `SELECT
         dr.id,
         dr.employee_id,
         dr.type_key,
         COALESCE(dt.label, dt.value, dr.type_key) AS type_label,
         dr.status,
         dr.effective_at,
         dr.ends_at,
         dr.reason_text,
         dr.internal_notes,
         dr.issued_by_employee_id,
         dr.issued_by_name,
         dr.closed_at,
         dr.close_note,
         dr.created_at,
         dr.updated_at,
         dr.record_type,
         dr.record_date,
         dr.record_status,
         dr.notes,
         dr.issued_by
       FROM disciplinary_records dr
       LEFT JOIN config_disciplinary_types dt ON UPPER(COALESCE(dt.key, '')) = UPPER(COALESCE(dr.type_key, ''))
       WHERE dr.employee_id = ?
       ORDER BY COALESCE(dr.effective_at, dr.record_date, dr.created_at) DESC, dr.id DESC`
    )
    .bind(employeeId)
    .all();
  return result?.results || [];
}
