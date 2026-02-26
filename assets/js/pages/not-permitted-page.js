import { performLogout, renderPublicNavbar } from '../modules/nav.js?v=20260226a';

async function getSession() {
  try {
    const response = await fetch('/api/auth/session', { method: 'GET', credentials: 'include' });
    if (!response.ok) return { loggedIn: false };
    return response.json();
  } catch {
    return { loggedIn: false };
  }
}

async function init() {
  renderPublicNavbar();
  const accountNode = document.querySelector('#notPermittedAccount');
  const switchButton = document.querySelector('#switchDiscordAccountBtn');
  const session = await getSession();
  if (!session?.loggedIn) return;

  if (accountNode) {
    accountNode.textContent = `Signed in as ${session.displayName || session.userId || 'Unknown user'}.`;
    accountNode.classList.remove('hidden');
  }
  if (switchButton) {
    switchButton.classList.remove('hidden');
    switchButton.addEventListener('click', () => performLogout('/login'));
  }
}

init();
