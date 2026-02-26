import { clearMessage, showMessage } from './notice.js';
import { renderPublicNavbar } from './nav.js';

async function fetchSession() {
  const response = await fetch('/api/auth/session', { method: 'GET', credentials: 'include' });
  if (!response.ok) return { loggedIn: false };
  return response.json();
}

function getAuthMessageFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get('auth');
  const reason = params.get('reason');
  const error = params.get('error');

  if (error === 'not_permitted') {
    return { text: 'Access denied. You are not permitted to access this intranet.', type: 'error' };
  }

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
  if (!url.searchParams.has('auth') && !url.searchParams.has('reason') && !url.searchParams.has('error')) return;
  url.searchParams.delete('auth');
  url.searchParams.delete('reason');
  url.searchParams.delete('error');
  window.history.replaceState({}, '', url.toString());
}

export function initIntranetAuth(config) {
  const authPanel = document.querySelector(config.authPanelSelector);
  const loginButton = document.querySelector(config.loginButtonSelector);
  const feedback = document.querySelector(config.feedbackSelector);
  const checkingPanel = document.querySelector('#authCheckingPanel');
  renderPublicNavbar();

  if (!authPanel || !loginButton || !feedback) return;

  loginButton.addEventListener('click', () => {
    loginButton.disabled = true;
    loginButton.setAttribute('aria-busy', 'true');
    const label = loginButton.querySelector('[data-login-label]');
    const spinner = loginButton.querySelector('[data-login-spinner]');
    if (label) label.textContent = 'Redirecting...';
    if (spinner) spinner.classList.remove('hidden');
    window.location.href = '/api/auth/discord/start';
  });

  const hasAuthQuery = new URLSearchParams(window.location.search).has('auth');
  const urlMessage = getAuthMessageFromUrl();
  if (urlMessage) {
    showMessage(feedback, urlMessage.text, urlMessage.type);
    cleanAuthQuery();
  } else {
    clearMessage(feedback);
  }

  fetchSession()
    .then((session) => {
      if (session.loggedIn && !hasAuthQuery) {
        const activationStatus = String(session.activationStatus || '').trim().toUpperCase();
        if (!session.isAdmin && activationStatus === 'PENDING') {
          window.location.href = '/access-setup';
          return;
        }
        if (!session.isAdmin && (activationStatus === 'REJECTED' || activationStatus === 'DISABLED' || activationStatus === 'NONE')) {
          window.location.href = '/not-permitted';
          return;
        }
        window.location.href = '/dashboard';
        return;
      }

      checkingPanel?.classList.add('hidden');
      authPanel.classList.remove('hidden');
      if (!urlMessage) clearMessage(feedback);
    })
    .catch(() => {
      checkingPanel?.classList.add('hidden');
      showMessage(feedback, 'Unable to verify session.', 'error');
      authPanel.classList.remove('hidden');
    });
}
