import { showMessage } from './notice.js';

export function hasPermission(session, permissionKey) {
  if (!session || !permissionKey) return false;
  const permissions = Array.isArray(session.permissions) ? session.permissions : [];
  return permissions.includes('super.admin') || permissions.includes(permissionKey);
}

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
  const navLogoutButton = document.querySelector(config.navLogoutButtonSelector || '#navLogoutBtn');
  const adminNavLink = document.querySelector(config.adminNavLinkSelector || '#adminNavLink');
  const requireAdmin = Boolean(config.requireAdmin);
  const requireFormsAdmin = Boolean(config.requireFormsAdmin);
  const requireEmployee = Boolean(config.requireEmployee);
  const requiredPermissions = Array.isArray(config.requiredPermissions) ? config.requiredPermissions : [];

  if (!feedback || !protectedContent) return null;

  try {
    const session = await fetchSession();

    if (!session.loggedIn) {
      window.location.href = '/intranet.html?auth=denied&reason=login_required';
      return null;
    }

    if (requireAdmin && !hasPermission(session, 'admin.access')) {
      window.location.href = '/intranet.html?auth=denied&reason=admin_required';
      return null;
    }

    if (requireFormsAdmin && !hasPermission(session, 'forms.manage')) {
      window.location.href = '/intranet.html?auth=denied&reason=admin_required';
      return null;
    }

    if (requiredPermissions.length && !requiredPermissions.every((permission) => hasPermission(session, permission))) {
      window.location.href = '/intranet.html?auth=denied&reason=admin_required';
      return null;
    }

    if (requireEmployee && !session.isAdmin && session.accessPending) {
      window.location.href = '/intranet.html?auth=denied&reason=login_required';
      return null;
    }

    if (navLogoutButton) {
      navLogoutButton.classList.remove('hidden');
      navLogoutButton.addEventListener('click', async () => {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
        window.location.href = '/intranet.html';
      });
    }

    if (adminNavLink) {
      if (hasPermission(session, 'admin.access')) adminNavLink.classList.remove('hidden');
      else adminNavLink.classList.add('hidden');
    }

    protectedContent.classList.remove('hidden');
    return session;
  } catch {
    showMessage(feedback, 'Unable to verify your session.', 'error');
    return null;
  }
}
