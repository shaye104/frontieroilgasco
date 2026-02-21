import { showMessage } from './notice.js';
import { hasPermission, renderIntranetNavbar } from './nav.js?v=20260221g';

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

  if (hasAnyLink && hasFinances) return;

  nav.innerHTML = '';
  nav.append(buildLink('/my-details', 'My Details'));
  nav.append(buildLink('/voyages/my', 'Voyages'));
  nav.append(buildLink('/my-fleet', 'My Fleet'));
  nav.append(buildLink('/forms', 'Forms'));
  nav.append(buildLink('/finances', 'Finances'));
  if (hasPermission(session, 'admin.access')) nav.append(buildLink('/admin', 'Admin Panel'));

  const spacer = document.createElement('span');
  spacer.className = 'nav-spacer';
  nav.append(spacer);

  if (session?.displayName) {
    const user = document.createElement('span');
    user.className = 'nav-user';
    user.textContent = session.displayName;
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

export async function initIntranetLayout(config) {
  document.documentElement.classList.add('intranet-no-scroll');
  document.body.classList.add('intranet-no-scroll');

  const feedback = document.querySelector(config.feedbackSelector);
  const protectedContent = document.querySelector(config.protectedContentSelector);
  const requireAdmin = Boolean(config.requireAdmin);
  const requireFormsAdmin = Boolean(config.requireFormsAdmin);
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

    // Shared intranet layout: single navbar rendered once per page.
    renderIntranetNavbar(session);
    ensureNavbarFallback(session);

    if (requireAdmin && !hasPermission(session, 'admin.access')) {
      window.location.href = toAccessDeniedUrl('admin_required');
      return null;
    }

    if (requireFormsAdmin && !hasPermission(session, 'forms.manage')) {
      window.location.href = toAccessDeniedUrl('forms_admin_required');
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
      window.location.href = toAccessDeniedUrl('access_pending');
      return null;
    }

    protectedContent.classList.remove('hidden');
    return session;
  } catch {
    showMessage(feedback, 'Unable to verify your session.', 'error');
    return null;
  }
}
