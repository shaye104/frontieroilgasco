import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initManageEmployees } from '../modules/manage-employees.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  navLogoutButtonSelector: '#navLogoutBtn',
  adminNavLinkSelector: '#adminNavLink',
  requireAdmin: true
}).then((session) => {
  if (!session || !session.isAdmin) return;

  initManageEmployees({
    feedbackSelector: '#manageEmployeesFeedback',
    employeeListSelector: '#employeeList',
    selectedEmployeeSelector: '#selectedEmployee',
    createFormSelector: '#createEmployeeForm',
    editFormSelector: '#editEmployeeForm',
    disciplinaryFormSelector: '#disciplinaryForm',
    noteFormSelector: '#noteForm',
    disciplinaryListSelector: '#disciplinaryList',
    notesListSelector: '#notesList'
  });
});

initializeYear();
