import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260221d';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['admin.access', 'forms.manage']
});

initializeYear();
