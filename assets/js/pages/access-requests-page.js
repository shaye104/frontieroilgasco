import { initAccessRequests } from '../modules/access-requests.js';
import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requireAdmin: true
}).then((session) => {
  if (!session || !session.isAdmin) return;

  initAccessRequests({
    feedbackSelector: '#accessRequestFeedback',
    listSelector: '#accessRequestList',
    selectedSelector: '#selectedRequest',
    approveFormSelector: '#approveRequestForm',
    denyFormSelector: '#denyRequestForm'
  });
});

initializeYear();
