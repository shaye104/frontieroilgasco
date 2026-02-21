import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260221d';
import { initEmployeeProfilePage } from '../modules/employee-profile.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['admin.access', 'employees.read']
}).then((session) => {
  if (!session) return;

  initEmployeeProfilePage({
    feedbackSelector: '#employeeProfileFeedback',
    employeeHeadingSelector: '#selectedEmployee',
    editFormSelector: '#editEmployeeForm',
    disciplinaryFormSelector: '#disciplinaryForm',
    noteFormSelector: '#noteForm',
    activeDisciplinaryListSelector: '#activeDisciplinaryList',
    activityListSelector: '#activityList',
    openDisciplinaryModalBtnSelector: '#openDisciplinaryModalBtn',
    openNoteModalBtnSelector: '#openNoteModalBtn',
    resetButtonSelector: '#resetEmployeeFormBtn',
    tenureDaysSelector: '#tenureDays'
  }, session);
});

initializeYear();
