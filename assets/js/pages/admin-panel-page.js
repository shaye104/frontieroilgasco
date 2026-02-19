import { initAdminRoleConfig } from '../modules/admin-role-config.js';
import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  welcomeSelector: '#intranetIdentity',
  navLogoutButtonSelector: '#navLogoutBtn',
  adminNavLinkSelector: '#adminNavLink',
  requireAdmin: true
}).then((session) => {
  if (!session || !session.isAdmin) return;

  initAdminRoleConfig({
    roleInputSelector: '#roleIdInput',
    addRoleButtonSelector: '#addRoleBtn',
    saveRolesButtonSelector: '#saveRolesBtn',
    roleListSelector: '#roleList',
    feedbackSelector: '#adminFeedback'
  });
});

initializeYear();
