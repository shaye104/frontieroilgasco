import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
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
  const configLink = document.querySelector('#adminLinkConfig');
  const cargoLink = document.querySelector('#adminLinkCargo');
  const rolesLink = document.querySelector('#adminLinkRoles');
  const activityTrackerLink = document.querySelector('#adminLinkActivityTracker');

  if (employeesLink && hasPermission(session, 'employees.read')) employeesLink.classList.remove('hidden');
  if (configLink && hasPermission(session, 'config.manage')) configLink.classList.remove('hidden');
  if (cargoLink && (hasPermission(session, 'cargo.manage') || hasPermission(session, 'voyages.config.manage'))) {
    cargoLink.classList.remove('hidden');
  }
  if (rolesLink && hasPermission(session, 'roles.manage')) rolesLink.classList.remove('hidden');
  if (activityTrackerLink && hasPermission(session, 'activity_tracker.view')) activityTrackerLink.classList.remove('hidden');
});

initializeYear();
