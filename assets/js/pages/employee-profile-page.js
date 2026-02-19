import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initEmployeeProfilePage } from '../modules/employee-profile.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requireAdmin: true
}).then((session) => {
  if (!session || !session.isAdmin) return;

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
  });
});

initializeYear();
