import { showMessage } from './notice.js';

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
  const welcome = document.querySelector(config.welcomeSelector);
  const navLogoutButton = document.querySelector(config.navLogoutButtonSelector || '#navLogoutBtn');
  const adminNavLink = document.querySelector(config.adminNavLinkSelector || '#adminNavLink');
  const requireAdmin = Boolean(config.requireAdmin);

  if (!feedback || !protectedContent || !welcome) return null;

  try {
    const session = await fetchSession();

    if (!session.loggedIn) {
      window.location.href = '/intranet.html?auth=denied&reason=login_required';
      return null;
    }

    if (requireAdmin && !session.isAdmin) {
      window.location.href = '/intranet.html?auth=denied&reason=admin_required';
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
      if (session.isAdmin) adminNavLink.classList.remove('hidden');
      else adminNavLink.classList.add('hidden');
    }

    welcome.textContent = `Signed in as ${session.displayName}.`;
    protectedContent.classList.remove('hidden');
    showMessage(feedback, 'Intranet access verified.', 'success');
    return session;
  } catch {
    showMessage(feedback, 'Unable to verify your session.', 'error');
    return null;
  }
}
