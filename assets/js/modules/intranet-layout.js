import { showMessage } from './notice.js';
import { hasPermission, renderIntranetNavbar } from './nav.js';

async function fetchSession() {
  const response = await fetch('/api/auth/session', {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) return { loggedIn: false };
  return response.json();
}

function toAccessDeniedUrl(reason) {
  const url = new URL('/access-denied.html', window.location.origin);
  if (reason) url.searchParams.set('reason', reason);
  url.searchParams.set('from', window.location.pathname);
  return url.toString();
}

export async function initIntranetLayout(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const protectedContent = document.querySelector(config.protectedContentSelector);
  const requireAdmin = Boolean(config.requireAdmin);
  const requireFormsAdmin = Boolean(config.requireFormsAdmin);
  const requireEmployee = Boolean(config.requireEmployee);
  const requiredPermissions = Array.isArray(config.requiredPermissions) ? config.requiredPermissions : [];

  if (!feedback || !protectedContent) return null;

  try {
    const session = await fetchSession();

    if (!session.loggedIn) {
      window.location.href = '/login?auth=denied&reason=login_required';
      return null;
    }

    // Shared intranet layout: single navbar rendered once per page.
    renderIntranetNavbar(session);

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
