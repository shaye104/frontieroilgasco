const VALID_LIFECYCLE_STATUSES = new Set(['ACTIVE', 'ON LEAVE', 'SUSPENDED', 'DEACTIVATED', 'REMOVED', 'LEFT']);
const VALID_ACCESS_MODES = new Set(['normal', 'my_details_only', 'removed_page', 'blocked']);

function text(value) {
  return String(value || '').trim();
}

function normalizeLabel(value) {
  return text(value).replace(/[\s_-]+/g, ' ').trim().toUpperCase();
}

export function normalizeLifecycleStatus(value, fallback = 'ACTIVE') {
  const normalized = normalizeLabel(value);
  if (VALID_LIFECYCLE_STATUSES.has(normalized)) return normalized;
  const fallbackNormalized = normalizeLabel(fallback);
  return VALID_LIFECYCLE_STATUSES.has(fallbackNormalized) ? fallbackNormalized : 'ACTIVE';
}

export function normalizeStatusAccessMode(value, fallback = 'normal') {
  const normalized = text(value).toLowerCase();
  if (VALID_ACCESS_MODES.has(normalized)) return normalized;
  const fallbackNormalized = text(fallback).toLowerCase();
  return VALID_ACCESS_MODES.has(fallbackNormalized) ? fallbackNormalized : 'normal';
}

function defaultStatusBehavior(statusValue) {
  const normalized = normalizeLabel(statusValue);
  if (normalized === 'ON LEAVE') {
    return { accessMode: 'normal', showNotice: false, removeFromGroup: false, restrictIntranet: false, excludeFromStats: false };
  }
  if (normalized === 'SUSPENDED') {
    return { accessMode: 'my_details_only', showNotice: true, removeFromGroup: false, restrictIntranet: true, excludeFromStats: false };
  }
  if (normalized === 'REMOVED') {
    return { accessMode: 'removed_page', showNotice: false, removeFromGroup: true, restrictIntranet: true, excludeFromStats: true };
  }
  if (normalized === 'LEFT') {
    return { accessMode: 'blocked', showNotice: false, removeFromGroup: true, restrictIntranet: true, excludeFromStats: true };
  }
  return { accessMode: 'normal', showNotice: false, removeFromGroup: false, restrictIntranet: false, excludeFromStats: false };
}

export function lifecycleStatusFromBehavior(statusValue, accessMode, fallback = 'ACTIVE') {
  const normalizedMode = normalizeStatusAccessMode(accessMode, 'normal');
  if (normalizedMode === 'my_details_only') return 'SUSPENDED';
  if (normalizedMode === 'removed_page') return 'REMOVED';
  if (normalizedMode === 'blocked') return 'LEFT';

  const normalizedStatus = normalizeLabel(statusValue);
  if (normalizedStatus === 'ON LEAVE') return 'ON LEAVE';
  if (normalizedStatus === 'SUSPENDED') return 'SUSPENDED';
  if (normalizedStatus === 'REMOVED') return 'REMOVED';
  if (normalizedStatus === 'LEFT') return 'LEFT';
  return normalizeLifecycleStatus(fallback, 'ACTIVE') === 'ON LEAVE' ? 'ON LEAVE' : 'ACTIVE';
}

export function deriveLifecycleStatusFromEmployee(employee, fallback = 'ACTIVE') {
  const employeeStatus = normalizeLifecycleStatus(employee?.employee_status, '');
  if (employeeStatus) return employeeStatus;

  const activationStatus = text(employee?.activation_status).toUpperCase();
  if (activationStatus === 'DISABLED') return 'LEFT';
  if (activationStatus === 'REJECTED') return 'REMOVED';
  if (activationStatus === 'PENDING') return 'DEACTIVATED';
  if (activationStatus === 'ACTIVE') return 'ACTIVE';
  return normalizeLifecycleStatus(fallback, 'ACTIVE');
}

export function toLegacyActivationStatus(lifecycleStatus) {
  const status = normalizeLifecycleStatus(lifecycleStatus, 'ACTIVE');
  if (status === 'LEFT') return 'DISABLED';
  if (status === 'REMOVED') return 'REJECTED';
  if (status === 'DEACTIVATED') return 'PENDING';
  return 'ACTIVE';
}

export async function ensureEmployeeStatusConfigSchema(env) {
  if (!env?.DB) return;
  await env.DB
    .prepare(
      `CREATE TABLE IF NOT EXISTS config_employee_statuses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        value TEXT NOT NULL UNIQUE,
        restrict_intranet INTEGER NOT NULL DEFAULT 0,
        exclude_from_stats INTEGER NOT NULL DEFAULT 0,
        access_mode TEXT NOT NULL DEFAULT 'normal',
        show_notice INTEGER NOT NULL DEFAULT 0,
        remove_from_group INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )`
    )
    .run();

  const columns = await env.DB.prepare(`PRAGMA table_info(config_employee_statuses)`).all();
  const columnNames = new Set((columns?.results || []).map((row) => String(row.name || '').toLowerCase()));
  if (!columnNames.has('restrict_intranet')) {
    await env.DB.prepare(`ALTER TABLE config_employee_statuses ADD COLUMN restrict_intranet INTEGER NOT NULL DEFAULT 0`).run();
  }
  if (!columnNames.has('exclude_from_stats')) {
    await env.DB.prepare(`ALTER TABLE config_employee_statuses ADD COLUMN exclude_from_stats INTEGER NOT NULL DEFAULT 0`).run();
  }
  if (!columnNames.has('access_mode')) {
    await env.DB.prepare(`ALTER TABLE config_employee_statuses ADD COLUMN access_mode TEXT NOT NULL DEFAULT 'normal'`).run();
  }
  if (!columnNames.has('show_notice')) {
    await env.DB.prepare(`ALTER TABLE config_employee_statuses ADD COLUMN show_notice INTEGER NOT NULL DEFAULT 0`).run();
  }
  if (!columnNames.has('remove_from_group')) {
    await env.DB.prepare(`ALTER TABLE config_employee_statuses ADD COLUMN remove_from_group INTEGER NOT NULL DEFAULT 0`).run();
  }

  await env.DB.batch([
    env.DB.prepare(`INSERT OR IGNORE INTO config_employee_statuses (value, access_mode, show_notice, remove_from_group, restrict_intranet, exclude_from_stats) VALUES ('Active', 'normal', 0, 0, 0, 0)`),
    env.DB.prepare(`INSERT OR IGNORE INTO config_employee_statuses (value, access_mode, show_notice, remove_from_group, restrict_intranet, exclude_from_stats) VALUES ('On Leave', 'normal', 0, 0, 0, 0)`),
    env.DB.prepare(`INSERT OR IGNORE INTO config_employee_statuses (value, access_mode, show_notice, remove_from_group, restrict_intranet, exclude_from_stats) VALUES ('Suspended', 'my_details_only', 1, 0, 1, 0)`),
    env.DB.prepare(`INSERT OR IGNORE INTO config_employee_statuses (value, access_mode, show_notice, remove_from_group, restrict_intranet, exclude_from_stats) VALUES ('Removed', 'removed_page', 0, 1, 1, 1)`),
    env.DB.prepare(`INSERT OR IGNORE INTO config_employee_statuses (value, access_mode, show_notice, remove_from_group, restrict_intranet, exclude_from_stats) VALUES ('Left', 'blocked', 0, 1, 1, 1)`)
  ]);
}

export async function getEmployeeStatusBehavior(env, statusValue) {
  const defaults = defaultStatusBehavior(statusValue);
  const normalizedValue = text(statusValue);
  if (!normalizedValue || !env?.DB) {
    return {
      value: normalizedValue,
      accessMode: defaults.accessMode,
      showNotice: defaults.showNotice,
      removeFromGroup: defaults.removeFromGroup,
      restrictIntranet: defaults.restrictIntranet,
      excludeFromStats: defaults.excludeFromStats
    };
  }

  try {
    await ensureEmployeeStatusConfigSchema(env);
    const row = await env.DB
      .prepare(
        `SELECT value, restrict_intranet, exclude_from_stats, access_mode, show_notice, remove_from_group
         FROM config_employee_statuses
         WHERE LOWER(value) = LOWER(?)
         LIMIT 1`
      )
      .bind(normalizedValue)
      .first();

    if (!row) {
      return {
        value: normalizedValue,
        accessMode: defaults.accessMode,
        showNotice: defaults.showNotice,
        removeFromGroup: defaults.removeFromGroup,
        restrictIntranet: defaults.restrictIntranet,
        excludeFromStats: defaults.excludeFromStats
      };
    }

    return {
      value: text(row.value) || normalizedValue,
      accessMode: normalizeStatusAccessMode(row.access_mode, defaults.accessMode),
      showNotice: Number(row.show_notice ?? (defaults.showNotice ? 1 : 0)) === 1,
      removeFromGroup: Number(row.remove_from_group ?? (defaults.removeFromGroup ? 1 : 0)) === 1,
      restrictIntranet: Number(row.restrict_intranet ?? (defaults.restrictIntranet ? 1 : 0)) === 1,
      excludeFromStats: Number(row.exclude_from_stats ?? (defaults.excludeFromStats ? 1 : 0)) === 1
    };
  } catch {
    return {
      value: normalizedValue,
      accessMode: defaults.accessMode,
      showNotice: defaults.showNotice,
      removeFromGroup: defaults.removeFromGroup,
      restrictIntranet: defaults.restrictIntranet,
      excludeFromStats: defaults.excludeFromStats
    };
  }
}

export async function deriveConfiguredLifecycleStatus(env, employee, fallback = 'ACTIVE') {
  const normalizedStatus = text(employee?.employee_status);
  if (normalizedStatus) {
    const behavior = await getEmployeeStatusBehavior(env, normalizedStatus);
    return lifecycleStatusFromBehavior(normalizedStatus, behavior.accessMode, fallback);
  }
  return deriveLifecycleStatusFromEmployee(employee, fallback);
}

export async function deriveConfiguredActivationStatus(env, employee, fallback = 'ACTIVE') {
  const lifecycleStatus = await deriveConfiguredLifecycleStatus(env, employee, fallback);
  return toLegacyActivationStatus(lifecycleStatus);
}

export function canAccessGeneralIntranet(lifecycleStatus) {
  const status = normalizeLifecycleStatus(lifecycleStatus, 'ACTIVE');
  return status !== 'DEACTIVATED' && status !== 'REMOVED' && status !== 'LEFT';
}

export function isSuspendedLifecycle(lifecycleStatus) {
  return normalizeLifecycleStatus(lifecycleStatus, 'ACTIVE') === 'SUSPENDED';
}

export function canUseVoyageAndFinance(lifecycleStatus) {
  const status = normalizeLifecycleStatus(lifecycleStatus, 'ACTIVE');
  return status === 'ACTIVE' || status === 'ON LEAVE';
}

export function isPendingLifecycle(lifecycleStatus) {
  return normalizeLifecycleStatus(lifecycleStatus, 'ACTIVE') === 'DEACTIVATED';
}

export function isRemovedLifecycle(lifecycleStatus) {
  return normalizeLifecycleStatus(lifecycleStatus, 'ACTIVE') === 'REMOVED';
}

export function isLeftLifecycle(lifecycleStatus) {
  return normalizeLifecycleStatus(lifecycleStatus, 'ACTIVE') === 'LEFT';
}
