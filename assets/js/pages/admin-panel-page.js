import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  navLogoutButtonSelector: '#navLogoutBtn',
  requireAdmin: true
});

initializeYear();
