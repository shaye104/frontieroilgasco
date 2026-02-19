import { initCargoAdmin } from '../modules/cargo-admin.js';
import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['admin.access', 'cargo.manage']
}).then((session) => {
  if (!session) return;
  initCargoAdmin({
    feedbackSelector: '#cargoFeedback',
    tableBodySelector: '#cargoTableBody',
    openModalButtonSelector: '#openCargoModalBtn',
    formSelector: '#cargoForm',
    modalTitleSelector: '#cargoModalTitle'
  });
});

initializeYear();
