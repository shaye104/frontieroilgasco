const VALID_LIFECYCLE_STATUSES = new Set(['ACTIVE', 'ON LEAVE', 'SUSPENDED', 'DEACTIVATED', 'REMOVED']);

function text(value) {
  return String(value || '').trim();
}

export function normalizeLifecycleStatus(value, fallback = 'ACTIVE') {
  const normalized = text(value).toUpperCase();
  if (VALID_LIFECYCLE_STATUSES.has(normalized)) return normalized;
  return VALID_LIFECYCLE_STATUSES.has(String(fallback || '').toUpperCase()) ? String(fallback).toUpperCase() : 'ACTIVE';
}

export function deriveLifecycleStatusFromEmployee(employee, fallback = 'ACTIVE') {
  const employeeStatus = normalizeLifecycleStatus(employee?.employee_status, '');
  if (employeeStatus) return employeeStatus;

  const activationStatus = text(employee?.activation_status).toUpperCase();
  if (activationStatus === 'DISABLED' || activationStatus === 'REJECTED' || activationStatus === 'PENDING') return 'DEACTIVATED';
  if (activationStatus === 'ACTIVE') return 'ACTIVE';
  return normalizeLifecycleStatus(fallback, 'ACTIVE');
}

export function toLegacyActivationStatus(lifecycleStatus) {
  const status = normalizeLifecycleStatus(lifecycleStatus, 'ACTIVE');
  return status === 'DEACTIVATED' ? 'PENDING' : 'ACTIVE';
}

export function canAccessGeneralIntranet(lifecycleStatus) {
  const status = normalizeLifecycleStatus(lifecycleStatus, 'ACTIVE');
  return status !== 'DEACTIVATED' && status !== 'REMOVED';
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
