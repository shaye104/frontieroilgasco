import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260222b';
import { hasPermission } from '../modules/nav.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['admin.access']
}).then((session) => {
  if (!session) return;

  const employeesLink = document.querySelector('#adminLinkEmployees');
  const activityTrackerLink = document.querySelector('#adminLinkActivityTracker');

  if (employeesLink && hasPermission(session, 'employees.read')) employeesLink.classList.remove('hidden');
  if (activityTrackerLink && hasPermission(session, 'activity_tracker.view')) activityTrackerLink.classList.remove('hidden');
});

initializeYear();
