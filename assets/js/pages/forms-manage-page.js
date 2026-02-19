import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initFormsManageAdmin } from '../modules/forms-manage-admin.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['admin.access', 'forms.manage']
}).then((session) => {
  if (!session) return;

  initFormsManageAdmin({
    feedbackSelector: '#formsManageFeedback',
    listSelector: '#formsList'
  });
});

initializeYear();
