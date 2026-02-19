import { clearMessage, showMessage } from './notice.js';

async function fetchSession() {
  const response = await fetch('/api/auth/session', {
    method: 'GET',
    credentials: 'include'
  });

  if (!response.ok) return { loggedIn: false };
  return response.json();
}

function getAuthMessageFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const auth = params.get('auth');
  const reason = params.get('reason');

  if (auth === 'denied') {
    return {
      text: reason === 'missing_role' ? 'Access denied. Your Discord role is not authorized for intranet access.' : 'Login failed.',
      type: 'error'
    };
  }

  if (auth === 'error') {
    return { text: 'Login error. Please try again.', type: 'error' };
  }

  if (auth === 'ok') {
    return { text: 'Discord login successful.', type: 'success' };
  }

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
  const loginButton = document.querySelector(config.loginButtonSelector);
  const logoutButton = document.querySelector(config.logoutButtonSelector);
  const feedback = document.querySelector(config.feedbackSelector);
  const panel = document.querySelector(config.panelSelector);
  const welcomeText = document.querySelector(config.welcomeSelector);

  if (!loginButton || !logoutButton || !feedback || !panel || !welcomeText) return;

  loginButton.addEventListener('click', () => {
    window.location.href = '/api/auth/discord/start';
  });

  logoutButton.addEventListener('click', async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    panel.classList.add('hidden');
    showMessage(feedback, 'Logged out.', 'success');
  });

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
        panel.classList.add('hidden');
        return;
      }

      welcomeText.textContent = `Welcome, ${session.displayName}.`;
      panel.classList.remove('hidden');
      if (!urlMessage) showMessage(feedback, 'Authenticated via Discord.', 'success');
    })
    .catch(() => {
      showMessage(feedback, 'Unable to verify session.', 'error');
      panel.classList.add('hidden');
    });
}
