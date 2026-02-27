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
  const voyageSettingsLink = document.querySelector('#adminLinkVoyageSettings');
  const rolesLink = document.querySelector('#adminLinkRoles');
  const userRanksLink = document.querySelector('#adminLinkUserRanks');
  const siteSettingsLink = document.querySelector('#adminLinkSiteSettings');
  const activityTrackerLink = document.querySelector('#adminLinkActivityTracker');
  const auditLogLink = document.querySelector('#adminLinkAuditLog');

  if (employeesLink && hasPermission(session, 'employees.read')) employeesLink.classList.remove('hidden');
  if (voyageSettingsLink && hasPermission(session, 'voyages.config.manage')) voyageSettingsLink.classList.remove('hidden');
  if (rolesLink && hasPermission(session, 'user_groups.manage')) rolesLink.classList.remove('hidden');
  if (userRanksLink && hasPermission(session, 'user_ranks.manage')) userRanksLink.classList.remove('hidden');
  if (siteSettingsLink && hasPermission(session, 'config.manage')) siteSettingsLink.classList.remove('hidden');
  if (activityTrackerLink && hasPermission(session, 'activity_tracker.view')) activityTrackerLink.classList.remove('hidden');
  if (auditLogLink && hasPermission(session, 'activity_tracker.view')) auditLogLink.classList.remove('hidden');
});

initializeYear();
