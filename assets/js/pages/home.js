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
      const collegeRestricted =
        !session.isAdmin &&
        String(session.collegeTraineeStatus || session.userStatus || '').trim().toUpperCase() === 'TRAINEE_ACTIVE' &&
        !session.collegePassedAt;
      const permissions = Array.isArray(session.permissions) ? session.permissions : [];
      const hasMyDetails = permissions.includes('my_details.view') || permissions.includes('admin.override') || Boolean(session.isAdmin);
      const shouldLandOnCollege = collegeRestricted || (!hasMyDetails && Boolean(session.canAccessCollege));
      window.location.href = shouldLandOnCollege ? '/college' : '/my-details';
      return;
    }
  } catch {
    // Keep landing page accessible when auth check fails.
  }

  renderHomeContent(companyProfile);
  initializeYear();
}

initHomePage();
