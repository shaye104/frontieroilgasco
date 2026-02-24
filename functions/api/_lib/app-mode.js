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
  '/finances-debts',
  '/finances-debts.html',
  '/finances-audit',
  '/finances-audit.html',
  '/finances-analytics',
  '/finances-analytics.html',
  '/personnel',
  '/personnel.html',
  '/admin',
  '/admin-panel',
  '/admin-panel.html',
  '/admin/employees',
  '/admin/user-groups',
  '/admin/user-ranks',
  '/admin/cargo'
]);

const CORE_ALLOWED_PAGE_PREFIXES = [
  '/voyages/',
  '/finances/',
  '/personnel/',
  '/admin/employees/',
  '/admin/user-groups/',
  '/admin/user-ranks/',
  '/admin/cargo/'
];

const CORE_ALLOWED_API_PREFIXES = [
  '/api/auth/session',
  '/api/auth/logout',
  '/api/auth/discord/start',
  '/api/auth/discord/callback',
  '/api/me/details',
  '/api/voyages',
  '/api/voyage-config',
  '/api/cargo-types',
  '/api/finances',
  '/api/admin/employees',
  '/api/admin/roles',
  '/api/admin/user-ranks',
  '/api/admin/rank-permissions',
  '/api/admin/voyage-config',
  '/api/admin/cargo-types',
  '/api/admin/config',
  '/api/employees/search'
];

export function normalizeAppMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return mode === 'core' ? 'core' : 'full';
}

export function isCoreOnly(env) {
  return normalizeAppMode(env?.APP_MODE) === 'core';
}

export function isCoreAllowedPagePath(pathname) {
  const path = String(pathname || '').trim();
  if (!path) return false;
  if (CORE_ALLOWED_PAGE_EXACT.has(path)) return true;
  return CORE_ALLOWED_PAGE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function isCoreAllowedApiPath(pathname) {
  const path = String(pathname || '').trim();
  if (!path.startsWith('/api/')) return false;
  return CORE_ALLOWED_API_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
