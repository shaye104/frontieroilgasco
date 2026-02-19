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

  if (!feedback || !protectedContent || !welcome) return;

  try {
    const session = await fetchSession();

    if (!session.loggedIn) {
      window.location.href = '/intranet.html?auth=denied&reason=login_required';
      return;
    }

    welcome.textContent = `Signed in as ${session.displayName}.`;
    protectedContent.classList.remove('hidden');
    showMessage(feedback, 'Intranet access verified.', 'success');
  } catch {
    showMessage(feedback, 'Unable to verify your session.', 'error');
  }
}
