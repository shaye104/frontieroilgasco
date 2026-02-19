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
    if (reason === 'missing_role') return { text: 'Access denied. Your account is not authorized for intranet access.', type: 'error' };
    return { text: 'Login failed.', type: 'error' };
  }

  if (auth === 'error') return { text: 'Login error. Please try again.', type: 'error' };
  return null;
}

function cleanAuthQuery() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('auth') && !url.searchParams.has('reason')) return;
  url.searchParams.delete('auth');
  url.searchParams.delete('reason');
  window.history.replaceState({}, '', url.toString());
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  window.location.href = '/intranet.html';
}

function hasPermission(session, permission) {
  const permissions = Array.isArray(session?.permissions) ? session.permissions : [];
  return permissions.includes('super.admin') || permissions.includes(permission);
}

export function initIntranetAuth(config) {
  const authPanel = document.querySelector(config.authPanelSelector);
  const loginButton = document.querySelector(config.loginButtonSelector);
  const feedback = document.querySelector(config.feedbackSelector);
  const panel = document.querySelector(config.panelSelector);
  const adminNavLink = document.querySelector(config.adminNavLinkSelector);
  const adminPanelLinkRow = document.querySelector(config.adminPanelLinkRowSelector);
  const pendingPanel = document.querySelector(config.pendingPanelSelector);
  const logoutButton = document.querySelector(config.logoutButtonSelector);
  const myDetailsLinkRow = document.querySelector('#myDetailsLinkRow');
  const voyageLinkRow = document.querySelector('#voyageLinkRow');
  const fleetLinkRow = document.querySelector('#fleetLinkRow');

  if (!authPanel || !loginButton || !feedback || !panel || !logoutButton) return;

  loginButton.addEventListener('click', () => {
    window.location.href = '/api/auth/discord/start';
  });

  logoutButton.addEventListener('click', logout);

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
        panel.classList.add('hidden');
        if (adminNavLink) adminNavLink.classList.add('hidden');
        if (adminPanelLinkRow) adminPanelLinkRow.classList.add('hidden');
        if (pendingPanel) pendingPanel.classList.add('hidden');
        return;
      }

      authPanel.classList.add('hidden');
      panel.classList.remove('hidden');
      clearMessage(feedback);

      if (myDetailsLinkRow) myDetailsLinkRow.classList.toggle('hidden', !hasPermission(session, 'my_details.view'));
      if (voyageLinkRow) voyageLinkRow.classList.toggle('hidden', !hasPermission(session, 'voyages.read'));
      if (fleetLinkRow) fleetLinkRow.classList.toggle('hidden', !hasPermission(session, 'fleet.read'));

      if (session.canAccessAdminPanel) {
        if (adminNavLink) adminNavLink.classList.remove('hidden');
        if (adminPanelLinkRow) adminPanelLinkRow.classList.remove('hidden');
        if (pendingPanel) pendingPanel.classList.add('hidden');
      } else {
        if (adminNavLink) adminNavLink.classList.add('hidden');
        if (adminPanelLinkRow) adminPanelLinkRow.classList.add('hidden');

        if (session.accessPending) {
          if (pendingPanel) pendingPanel.classList.remove('hidden');
          showMessage(feedback, 'Access Pending: your request is awaiting admin approval.', 'error');
        } else if (pendingPanel) {
          pendingPanel.classList.add('hidden');
        }
      }
    })
    .catch(() => {
      showMessage(feedback, 'Unable to verify session.', 'error');
      authPanel.classList.remove('hidden');
      panel.classList.add('hidden');
      if (adminNavLink) adminNavLink.classList.add('hidden');
      if (adminPanelLinkRow) adminPanelLinkRow.classList.add('hidden');
      if (pendingPanel) pendingPanel.classList.add('hidden');
    });
}
