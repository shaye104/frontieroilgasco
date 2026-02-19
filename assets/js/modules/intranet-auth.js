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
    if (reason === 'missing_role') return { text: 'Access denied. Your Discord role is not authorized for intranet access.', type: 'error' };
    return { text: 'Login failed.', type: 'error' };
  }

  if (auth === 'error') return { text: 'Login error. Please try again.', type: 'error' };
  if (auth === 'ok') return null;
  return null;
}

function cleanAuthQuery() {
  const url = new URL(window.location.href);
  if (!url.searchParams.has('auth') && !url.searchParams.has('reason')) return;
  url.searchParams.delete('auth');
  url.searchParams.delete('reason');
  window.history.replaceState({}, '', url.toString());
}

async function handleLogout(config) {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  config.authPanel.classList.remove('hidden');
  config.loginButton.classList.remove('hidden');
  config.panel.classList.add('hidden');
  config.navLogoutButton.classList.add('hidden');
  if (config.adminNavLink) config.adminNavLink.classList.add('hidden');
  if (config.navVoyageLink) config.navVoyageLink.classList.add('hidden');
  if (config.navFleetLink) config.navFleetLink.classList.add('hidden');
  if (config.adminPanelLinkRow) config.adminPanelLinkRow.classList.add('hidden');
  if (config.voyageLinkRow) config.voyageLinkRow.classList.add('hidden');
  if (config.fleetLinkRow) config.fleetLinkRow.classList.add('hidden');
  if (config.pendingPanel) config.pendingPanel.classList.add('hidden');
  clearMessage(config.feedback);
}

export function initIntranetAuth(config) {
  const authPanel = document.querySelector(config.authPanelSelector);
  const loginButton = document.querySelector(config.loginButtonSelector);
  const feedback = document.querySelector(config.feedbackSelector);
  const panel = document.querySelector(config.panelSelector);
  const navLogoutButton = document.querySelector(config.navLogoutButtonSelector);
  const adminNavLink = document.querySelector(config.adminNavLinkSelector);
  const navVoyageLink = document.querySelector(config.navVoyageLinkSelector);
  const navFleetLink = document.querySelector(config.navFleetLinkSelector);
  const adminPanelLinkRow = document.querySelector(config.adminPanelLinkRowSelector);
  const voyageLinkRow = document.querySelector(config.voyageLinkRowSelector);
  const fleetLinkRow = document.querySelector(config.fleetLinkRowSelector);
  const pendingPanel = document.querySelector(config.pendingPanelSelector);

  if (!authPanel || !loginButton || !feedback || !panel || !navLogoutButton) return;

  loginButton.addEventListener('click', () => {
    window.location.href = '/api/auth/discord/start';
  });

  navLogoutButton.addEventListener('click', () =>
    handleLogout({
      authPanel,
      loginButton,
      feedback,
      panel,
      navLogoutButton,
      adminNavLink,
      navVoyageLink,
      navFleetLink,
      adminPanelLinkRow,
      voyageLinkRow,
      fleetLinkRow,
      pendingPanel
    })
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
        if (navVoyageLink) navVoyageLink.classList.add('hidden');
        if (navFleetLink) navFleetLink.classList.add('hidden');
        if (adminPanelLinkRow) adminPanelLinkRow.classList.add('hidden');
        if (voyageLinkRow) voyageLinkRow.classList.add('hidden');
        if (fleetLinkRow) fleetLinkRow.classList.add('hidden');
        if (pendingPanel) pendingPanel.classList.add('hidden');
        return;
      }

      authPanel.classList.add('hidden');
      panel.classList.remove('hidden');
      navLogoutButton.classList.remove('hidden');
      clearMessage(feedback);

      if (session.isAdmin) {
        if (adminNavLink) adminNavLink.classList.remove('hidden');
        if (navVoyageLink) navVoyageLink.classList.remove('hidden');
        if (navFleetLink) navFleetLink.classList.remove('hidden');
        if (adminPanelLinkRow) adminPanelLinkRow.classList.remove('hidden');
        if (voyageLinkRow) voyageLinkRow.classList.remove('hidden');
        if (fleetLinkRow) fleetLinkRow.classList.remove('hidden');
        if (pendingPanel) pendingPanel.classList.add('hidden');
      } else {
        if (adminNavLink) adminNavLink.classList.add('hidden');
        if (navVoyageLink) navVoyageLink.classList.add('hidden');
        if (navFleetLink) navFleetLink.classList.add('hidden');
        if (adminPanelLinkRow) adminPanelLinkRow.classList.add('hidden');
        if (voyageLinkRow) voyageLinkRow.classList.add('hidden');
        if (fleetLinkRow) fleetLinkRow.classList.add('hidden');

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
      navLogoutButton.classList.add('hidden');
      if (adminNavLink) adminNavLink.classList.add('hidden');
      if (navVoyageLink) navVoyageLink.classList.add('hidden');
      if (navFleetLink) navFleetLink.classList.add('hidden');
      if (adminPanelLinkRow) adminPanelLinkRow.classList.add('hidden');
      if (voyageLinkRow) voyageLinkRow.classList.add('hidden');
      if (fleetLinkRow) fleetLinkRow.classList.add('hidden');
      if (pendingPanel) pendingPanel.classList.add('hidden');
    });
}
