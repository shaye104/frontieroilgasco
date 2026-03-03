import { showMessage } from './notice.js';
import { canAccessAdminPanel, getPreferredUserLabel, hasPermission, renderIntranetNavbar } from './nav.js?v=20260227b';
import { initLiveNotifications } from './notifications-live.js?v=20260303h';

function normalizePath(pathname) {
  if (!pathname || pathname === '/') return '/';
  return String(pathname).replace(/\/+$/, '') || '/';
}

function normalizeAppMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return mode === 'core' ? 'core' : 'full';
}

function isCoreOnlyMode(session) {
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
  '/admin/audit',
  '/admin/voyages',
  '/admin/user-groups',
  '/admin/user-ranks',
  '/admin/site-settings',
  '/roles',
  '/roles.html',
  '/user-ranks',
  '/user-ranks.html',
  '/site-settings',
  '/site-settings.html',
  '/activity-tracker',
  '/activity-tracker.html',
  '/audit-log',
  '/audit-log.html',
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
  '/admin/audit/',
  '/admin/voyages/',
  '/admin/user-groups/',
  '/admin/user-ranks/',
  '/admin/site-settings/',
  '/activity-tracker/',
  '/audit-log/',
  '/roles/',
  '/user-ranks/',
  '/site-settings/',
  '/access-setup/',
  '/onboarding/'
];

function isCoreAllowedPagePath(pathname) {
  const path = normalizePath(pathname);
  if (CORE_ALLOWED_PAGE_EXACT.has(path)) return true;
  return CORE_ALLOWED_PAGE_PREFIXES.some((prefix) => path.startsWith(prefix));
}

async function fetchSession() {
  const response = await fetch('/api/auth/session', {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) return { loggedIn: false };
  return response.json();
}

function toAccessDeniedUrl(reason) {
  const url = new URL('/access-denied', window.location.origin);
  if (reason) url.searchParams.set('reason', reason);
  url.searchParams.set('from', window.location.pathname);
  return url.toString();
}

function normalizePathname(path) {
  return String(path || '').replace(/\/+$/, '') || '/';
}

function buildLink(href, label) {
  const link = document.createElement('a');
  link.href = href;
  link.textContent = label;
  return link;
}

function ensureNavbarFallback(session) {
  const nav = document.querySelector('.site-nav');
  if (!nav) return;

  const links = [...nav.querySelectorAll('a[href]')];
  const hasAnyLink = links.length > 0;
  const hasFinances = links.some(
    (link) => normalizePathname(new URL(link.getAttribute('href') || '', window.location.origin).pathname) === '/finances'
  );
  const activationStatus = String(session?.activationStatus || '').trim().toUpperCase();
  const isPendingActivation = !session?.isAdmin && activationStatus && activationStatus !== 'ACTIVE';

  if ((isPendingActivation && hasAnyLink) || (hasAnyLink && hasFinances)) return;

  nav.innerHTML = '';
  if (isPendingActivation) {
    nav.append(buildLink('/onboarding', 'Access Setup'));
  } else if (isCoreOnlyMode(session)) {
    nav.append(buildLink('/my-details', 'My Details'));
    nav.append(buildLink('/voyages/my', 'Voyages'));
    if (hasPermission(session, 'finances.view')) nav.append(buildLink('/finances', 'Finances'));
    if (canAccessAdminPanel(session)) nav.append(buildLink('/admin', 'Admin Panel'));
  } else {
    nav.append(buildLink('/my-details', 'My Details'));
    nav.append(buildLink('/voyages/my', 'Voyages'));
    if (hasPermission(session, 'finances.view')) nav.append(buildLink('/finances', 'Finances'));
    if (canAccessAdminPanel(session)) nav.append(buildLink('/admin', 'Admin Panel'));
  }

  const spacer = document.createElement('span');
  spacer.className = 'nav-spacer';
  nav.append(spacer);

  const preferredLabel = getPreferredUserLabel(session);
  if (preferredLabel) {
    const user = document.createElement('span');
    user.className = 'nav-user';
    user.textContent = preferredLabel;
    nav.append(user);
  }

  const logoutButton = document.createElement('button');
  logoutButton.type = 'button';
  logoutButton.className = 'btn btn-secondary';
  logoutButton.textContent = 'Logout';
  logoutButton.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      window.location.href = '/';
    }
  });
  nav.append(logoutButton);
}

function isAdminLikePath(pathname) {
  const path = normalizePathname(pathname);
  if (path.startsWith('/admin/')) return true;
  const legacyAdminPages = new Set([
    '/admin',
    '/admin-panel',
    '/activity-tracker',
    '/audit-log',
    '/roles',
    '/user-ranks',
    '/manage-employees'
  ]);
  return legacyAdminPages.has(path);
}

export async function initIntranetLayout(config) {
  document.documentElement.classList.add('intranet-no-scroll');
  document.body.classList.add('intranet-no-scroll');

  const feedback = document.querySelector(config.feedbackSelector);
  const protectedContent = document.querySelector(config.protectedContentSelector);
  const requireAdmin = Boolean(config.requireAdmin);
  const requireEmployee = Boolean(config.requireEmployee);
  const requiredPermissions = Array.isArray(config.requiredPermissions) ? config.requiredPermissions : [];
  const requiredAnyPermissions = Array.isArray(config.requiredAnyPermissions) ? config.requiredAnyPermissions : [];

  if (!feedback || !protectedContent) return null;

  try {
    const session = await fetchSession();

    if (!session.loggedIn) {
      window.location.href = '/login?auth=denied&reason=login_required';
      return null;
    }

    if (isCoreOnlyMode(session) && !isCoreAllowedPagePath(window.location.pathname)) {
      window.location.href = isAdminLikePath(window.location.pathname) ? '/admin/employees' : '/voyages/my';
      return null;
    }

    // Shared intranet layout: single navbar rendered once per page.
    renderIntranetNavbar(session);
    ensureNavbarFallback(session);
    initLiveNotifications();

    if (requireAdmin && !canAccessAdminPanel(session)) {
      window.location.href = toAccessDeniedUrl('admin_required');
      return null;
    }

    if (requiredPermissions.length && !requiredPermissions.every((permission) => hasPermission(session, permission))) {
      window.location.href = toAccessDeniedUrl('missing_permissions');
      return null;
    }

    if (requiredAnyPermissions.length && !requiredAnyPermissions.some((permission) => hasPermission(session, permission))) {
      window.location.href = toAccessDeniedUrl('missing_permissions');
      return null;
    }

    if (requireEmployee && !session.isAdmin && session.accessPending) {
      window.location.href = '/onboarding';
      return null;
    }

    protectedContent.classList.remove('hidden');
    return session;
  } catch {
    showMessage(feedback, 'Unable to verify your session.', 'error');
    return null;
  }
}
