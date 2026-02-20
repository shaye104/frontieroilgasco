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

export async function initIntranetPageGuard(config) {
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

    renderIntranetNavbar(session);

    if (requireAdmin && !hasPermission(session, 'admin.access')) {
      showMessage(feedback, 'Access denied: admin access required.', 'error');
      return null;
    }

    if (requireFormsAdmin && !hasPermission(session, 'forms.manage')) {
      showMessage(feedback, 'Access denied: forms admin access required.', 'error');
      return null;
    }

    if (requiredPermissions.length && !requiredPermissions.every((permission) => hasPermission(session, permission))) {
      showMessage(feedback, 'Access denied: missing required permissions.', 'error');
      return null;
    }

    if (requireEmployee && !session.isAdmin && session.accessPending) {
      showMessage(feedback, 'Access pending: your profile has not been approved yet.', 'error');
      return null;
    }

    protectedContent.classList.remove('hidden');
    return session;
  } catch {
    showMessage(feedback, 'Unable to verify your session.', 'error');
    return null;
  }
}
