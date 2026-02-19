import { clearMessage, showMessage } from './notice.js';

async function fetchSession() {
  const response = await fetch('/api/auth/session', { method: 'GET', credentials: 'include' });
  if (!response.ok) return { loggedIn: false };
  return response.json();
}

function getAuthMessageFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get('auth');
  const reason = params.get('reason');

  if (auth === 'denied') {
    if (reason === 'login_required') return { text: 'Please sign in to access the intranet.', type: 'error' };
    if (reason === 'admin_required') return { text: 'Admin access is required for that section.', type: 'error' };

    return {
      text: reason === 'missing_role' ? 'Access denied. Your Discord role is not authorized for intranet access.' : 'Login failed.',
      type: 'error'
    };
  }

  if (auth === 'error') return { text: 'Login error. Please try again.', type: 'error' };
  if (auth === 'ok') return { text: 'Discord login successful.', type: 'success' };
  return null;
}

function cleanAuthQuery() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('auth') && !url.searchParams.has('reason')) return;
  url.searchParams.delete('auth');
  url.searchParams.delete('reason');
  window.history.replaceState({}, '', url.toString());
}

async function handleLogout(authPanel, loginButton, panel, feedback, navLogoutButton, adminNavLink, adminPanelLinkRow) {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  authPanel.classList.remove('hidden');
  loginButton.classList.remove('hidden');
  panel.classList.add('hidden');
  navLogoutButton.classList.add('hidden');
  if (adminNavLink) adminNavLink.classList.add('hidden');
  if (adminPanelLinkRow) adminPanelLinkRow.classList.add('hidden');
  showMessage(feedback, 'Logged out.', 'success');
}

export function initIntranetAuth(config) {
  const authPanel = document.querySelector(config.authPanelSelector);
  const loginButton = document.querySelector(config.loginButtonSelector);
  const feedback = document.querySelector(config.feedbackSelector);
  const panel = document.querySelector(config.panelSelector);
  const welcomeText = document.querySelector(config.welcomeSelector);
  const navLogoutButton = document.querySelector(config.navLogoutButtonSelector);
  const adminNavLink = document.querySelector(config.adminNavLinkSelector);
  const adminPanelLinkRow = document.querySelector(config.adminPanelLinkRowSelector);

  if (!authPanel || !loginButton || !feedback || !panel || !welcomeText || !navLogoutButton) return;

  loginButton.addEventListener('click', () => {
    window.location.href = '/api/auth/discord/start';
  });

  navLogoutButton.addEventListener('click', () =>
    handleLogout(authPanel, loginButton, panel, feedback, navLogoutButton, adminNavLink, adminPanelLinkRow)
  );

  const urlMessage = getAuthMessageFromUrl();
  if (urlMessage) {
    showMessage(feedback, urlMessage.text, urlMessage.type);
    cleanAuthQuery();
  } else {
    clearMessage(feedback);
  }

  fetchSession()
    .then((session) => {
      if (!session.loggedIn) {
        authPanel.classList.remove('hidden');
        loginButton.classList.remove('hidden');
        panel.classList.add('hidden');
        navLogoutButton.classList.add('hidden');
        if (adminNavLink) adminNavLink.classList.add('hidden');
        if (adminPanelLinkRow) adminPanelLinkRow.classList.add('hidden');
        return;
      }

      authPanel.classList.add('hidden');
      loginButton.classList.add('hidden');
      panel.classList.remove('hidden');
      navLogoutButton.classList.remove('hidden');
      welcomeText.textContent = `Welcome, ${session.displayName}.`;

      if (session.isAdmin) {
        if (adminNavLink) adminNavLink.classList.remove('hidden');
        if (adminPanelLinkRow) adminPanelLinkRow.classList.remove('hidden');
      } else {
        if (adminNavLink) adminNavLink.classList.add('hidden');
        if (adminPanelLinkRow) adminPanelLinkRow.classList.add('hidden');
      }

      if (!urlMessage) showMessage(feedback, 'Authenticated via Discord.', 'success');
    })
    .catch(() => {
      showMessage(feedback, 'Unable to verify session.', 'error');
      authPanel.classList.remove('hidden');
      panel.classList.add('hidden');
      navLogoutButton.classList.add('hidden');
      if (adminNavLink) adminNavLink.classList.add('hidden');
      if (adminPanelLinkRow) adminPanelLinkRow.classList.add('hidden');
    });
}
