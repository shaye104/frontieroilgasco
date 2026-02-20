import { companyProfile } from '../modules/company-data.js';
import { renderPublicNavbar } from '../modules/nav.js';
import { renderHomeContent } from '../modules/render-company.js';
import { initializeYear } from '../modules/year.js';

async function initHomePage() {
  renderPublicNavbar();

  try {
    const response = await fetch('/api/auth/session', { method: 'GET', credentials: 'include' });
    const session = response.ok ? await response.json() : { loggedIn: false };
    if (session.loggedIn) {
      window.location.href = '/my-details.html';
      return;
    }
  } catch {
    // Keep landing page accessible when auth check fails.
  }

  renderHomeContent(companyProfile);
  initializeYear();
}

initHomePage();
