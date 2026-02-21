import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260221d';
import { initFormsResponses } from '../modules/forms-responses.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['forms.responses.read']
}).then((session) => {
  if (!session) return;

  initFormsResponses({
    feedbackSelector: '#formsResponsesFeedback',
    formFilterSelector: '#filterResponseForm',
    categoryFilterSelector: '#filterResponseCategory',
    employeeFilterSelector: '#filterResponseEmployee',
    dateFromSelector: '#filterDateFrom',
    dateToSelector: '#filterDateTo',
    applyFiltersBtnSelector: '#applyResponseFiltersBtn',
    tableBodySelector: '#responsesTableBody',
    detailSelector: '#responseDetail'
  }, session);
});

initializeYear();
