import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initManageEmployees } from '../modules/manage-employees.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requireAdmin: true
}).then((session) => {
  if (!session || !session.isAdmin) return;

  initManageEmployees({
    feedbackSelector: '#manageEmployeesFeedback',
    employeeTableBodySelector: '#employeeTableBody',
    selectedEmployeeSelector: '#selectedEmployee',
    filterRankSelector: '#filterRank',
    filterGradeSelector: '#filterGrade',
    filterSerialSelector: '#filterSerialNumber',
    filterUsernameSelector: '#filterRobloxUsername',
    openCreateEmployeeBtnSelector: '#openCreateEmployeeBtn',
    createFormSelector: '#createEmployeeForm'
  });
});

initializeYear();
