function normalizePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  return String(pathname).replace(/\/+$/, '') || '/';
}

export function normalizeAppMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return mode === 'core' ? 'core' : 'full';
}

export function isCoreOnlyMode(session) {
  return normalizeAppMode(session?.appMode) === 'core' || Boolean(session?.isCoreMode);
}

const CORE_ALLOWED_PAGE_EXACT = new Set([
  '/my-details',
  '/my-details.html',
  '/voyages',
  '/voyage-tracker',
  '/voyage-tracker.html',
  '/voyage-archive',
  '/voyage-archive.html',
  '/voyage-details',
  '/voyage-details.html',
  '/finances',
  '/finances.html',
  '/admin',
  '/admin-panel',
  '/admin-panel.html',
  '/admin/employees',
  '/admin/activity',
  '/admin/voyages',
  '/admin/user-groups',
  '/admin/user-ranks',
  '/roles',
  '/roles.html',
  '/user-ranks',
  '/user-ranks.html',
  '/activity-tracker',
  '/activity-tracker.html',
  '/voyage-settings',
  '/voyage-settings.html',
  '/access-setup',
  '/access-setup.html',
  '/not-permitted',
  '/not-permitted.html',
  '/onboarding',
  '/onboarding.html',
  '/onboarding/status'
]);

const CORE_ALLOWED_PAGE_PREFIXES = [
  '/voyages/',
  '/finances/',
  '/admin/employees/',
  '/admin/activity/',
  '/admin/voyages/',
  '/admin/user-groups/',
  '/admin/user-ranks/',
  '/activity-tracker/',
  '/roles/',
  '/user-ranks/',
  '/access-setup/',
  '/onboarding/'
];

export function isCoreAllowedPagePath(pathname) {
  const path = normalizePath(pathname);
  if (CORE_ALLOWED_PAGE_EXACT.has(path)) return true;
  return CORE_ALLOWED_PAGE_PREFIXES.some((prefix) => path.startsWith(prefix));
}
