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

export function initIntranetAuth(config) {
  const authPanel = document.querySelector(config.authPanelSelector);
  const loginButton = document.querySelector(config.loginButtonSelector);
  const feedback = document.querySelector(config.feedbackSelector);
  renderPublicNavbar();

  if (!authPanel || !loginButton || !feedback) return;

  loginButton.addEventListener('click', () => {
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
        window.location.href = '/my-details';
        return;
      }

      authPanel.classList.remove('hidden');
      clearMessage(feedback);
    })
    .catch(() => {
      showMessage(feedback, 'Unable to verify session.', 'error');
      authPanel.classList.remove('hidden');
    });
}
