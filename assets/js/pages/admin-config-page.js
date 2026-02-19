import { initAdminConfigMenu } from '../modules/admin-config-menu.js';
import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  navLogoutButtonSelector: '#navLogoutBtn',
  adminNavLinkSelector: '#adminNavLink',
  requireAdmin: true
}).then((session) => {
  if (!session || !session.isAdmin) return;

  initAdminConfigMenu({
    feedbackSelector: '#configFeedback'
  });
});

initializeYear();
