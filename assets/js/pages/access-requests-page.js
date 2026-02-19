import { initAccessRequests } from '../modules/access-requests.js';
import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['admin.access', 'employees.access_requests.review']
}).then((session) => {
  if (!session) return;

  initAccessRequests({
    feedbackSelector: '#accessRequestFeedback',
    listSelector: '#accessRequestList',
    selectedSelector: '#selectedRequest',
    approveFormSelector: '#approveRequestForm',
    denyFormSelector: '#denyRequestForm'
  });
});

initializeYear();
