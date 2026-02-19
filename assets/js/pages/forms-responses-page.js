import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initFormsResponses } from '../modules/forms-responses.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink'
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
