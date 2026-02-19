import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { hasPermission } from '../modules/intranet-page-guard.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['admin.access']
}).then((session) => {
  if (!session) return;

  const employeesLink = document.querySelector('#adminLinkEmployees');
  const requestsLink = document.querySelector('#adminLinkRequests');
  const configLink = document.querySelector('#adminLinkConfig');
  const rolesLink = document.querySelector('#adminLinkRoles');

  if (employeesLink && hasPermission(session, 'employees.read')) employeesLink.classList.remove('hidden');
  if (requestsLink && hasPermission(session, 'employees.access_requests.review')) requestsLink.classList.remove('hidden');
  if (configLink && hasPermission(session, 'config.manage')) configLink.classList.remove('hidden');
  if (rolesLink && hasPermission(session, 'roles.manage')) rolesLink.classList.remove('hidden');
});

initializeYear();
