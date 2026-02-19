import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initFormsManageAdmin } from '../modules/forms-manage-admin.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requireFormsAdmin: true
}).then((session) => {
  if (!session?.hasFormsAdmin) return;

  initFormsManageAdmin({
    feedbackSelector: '#formsManageFeedback',
    listSelector: '#formsList'
  });
});

initializeYear();
