import { showMessage } from './notice.js';
import { canAccessAdminPanel, getPreferredUserLabel, hasPermission, renderIntranetNavbar } from './nav.js?v=20260313e';
import { clearRankPreviewState, getRankPreviewState } from './rank-preview.js?v=20260313b';

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

function lifecycleStatus(session) {
  return String(session?.lifecycleStatus || session?.userStatus || '').trim().toUpperCase() || 'ACTIVE';
}

const CORE_ALLOWED_PAGE_EXACT = new Set([
  '/my-details',
  '/my-details.html',
  '/voyages',
  '/voyage-tracker',
  '/voyage-tracker.html',
  '/fleet',
  '/fleet.html',
  '/shipyard',
  '/shipyard.html',
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
  '/roles',
  '/roles.html',
  '/user-ranks',
  '/user-ranks.html',
  '/activity-tracker',
  '/activity-tracker.html',
  '/audit-log',
  '/audit-log.html',
  '/site-settings',
  '/site-settings.html',
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
  '/fleet/',
  '/shipyard/',
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

function isOnboardingPath(pathname) {
  const path = normalizePathname(pathname);
  return path === '/onboarding' || path === '/onboarding.html' || path === '/onboarding/status' || path === '/access-setup' || path === '/access-setup.html';
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
  const status = lifecycleStatus(session);
  const isPendingActivation = !session?.isAdmin && status === 'DEACTIVATED';
  const isSuspended = !session?.isAdmin && status === 'SUSPENDED';

  if (((isPendingActivation || isSuspended) && hasAnyLink) || (hasAnyLink && hasFinances)) return;

  nav.innerHTML = '';
  if (isPendingActivation) {
    nav.append(buildLink('/onboarding', 'Access Setup'));
  } else if (isSuspended) {
    nav.append(buildLink('/my-details', 'My Details'));
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
    '/manage-employees',
    '/site-settings'
  ]);
  return legacyAdminPages.has(path);
}

export async function initIntranetLayout(config) {
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) window.location.reload();
  });

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

    const status = lifecycleStatus(session);
    const currentPath = normalizePathname(window.location.pathname);
    if (!session?.isAdmin && status === 'LEFT') {
      window.location.href = '/login?auth=denied&reason=left';
      return null;
    }
    if (!session?.isAdmin && status === 'DEACTIVATED' && !isOnboardingPath(currentPath)) {
      window.location.href = '/onboarding';
      return null;
    }
    if (!session?.isAdmin && status === 'REMOVED') {
      window.location.href = toAccessDeniedUrl('removed');
      return null;
    }
    if (!session?.isAdmin && status === 'SUSPENDED' && currentPath !== '/my-details' && currentPath !== '/my-details.html') {
      window.location.href = '/my-details?auth=denied&reason=suspended';
      return null;
    }

    if (isCoreOnlyMode(session) && !isCoreAllowedPagePath(window.location.pathname)) {
      window.location.href = isAdminLikePath(window.location.pathname) ? '/admin/employees' : '/voyages/my';
      return null;
    }

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

    const preview = getRankPreviewState();
    if (preview && hasPermission(session, 'user_ranks.manage')) {
      session.previewMode = {
        rankId: preview.rankId,
        rankName: preview.rankName,
        appliedAt: preview.appliedAt
      };
      session.previewSourcePermissions = Array.isArray(session.permissions) ? [...session.permissions] : [];
      session.permissions = [...preview.permissionKeys];
    } else if (preview) {
      clearRankPreviewState();
    }

    // Shared intranet layout: single navbar rendered once per page.
    renderIntranetNavbar(session);
    ensureNavbarFallback(session);

    if (session.previewMode) {
      const previewBar = document.createElement('section');
      previewBar.className = 'feedback is-visible is-warning';
      previewBar.innerHTML = `
        <strong>Preview Mode:</strong> Viewing as rank "${session.previewMode.rankName}".
        <button type="button" class="btn btn-secondary btn-compact" data-clear-rank-preview>Exit Preview</button>
      `;
      const container = document.querySelector('main.section .container.intranet-layout');
      if (container) container.prepend(previewBar);
      const clearButton = previewBar.querySelector('[data-clear-rank-preview]');
      clearButton?.addEventListener('click', () => {
        clearRankPreviewState();
        window.location.reload();
      });
    }

    if (!session?.isAdmin && status === 'SUSPENDED') {
      document.body.classList.add('is-suspended-view');
      const suspendedContainer = document.querySelector('main.section .container.intranet-layout');
      if (suspendedContainer && !suspendedContainer.querySelector('[data-suspended-banner]')) {
        const suspendedBar = document.createElement('section');
        suspendedBar.className = 'feedback is-visible is-warning suspended-status-banner';
        suspendedBar.setAttribute('data-suspended-banner', 'true');
        suspendedBar.innerHTML = '<strong>Account Suspended:</strong> Your access is restricted to My Details only until this status is changed.';
        suspendedContainer.prepend(suspendedBar);
      }
    } else {
      document.body.classList.remove('is-suspended-view');
    }
    protectedContent.classList.remove('hidden');
    return session;
  } catch {
    showMessage(feedback, 'Unable to verify your session.', 'error');
    return null;
  }
}

