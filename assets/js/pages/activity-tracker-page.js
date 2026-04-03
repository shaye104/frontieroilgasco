import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260313e';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  requiredPermissions: ['activity_tracker.view']
}).then((session) => {
  if (!session) return;

  import('../modules/activity-tracker.js?v=20260227d').then(({ initActivityTracker }) =>
    initActivityTracker({
    feedbackSelector: '#activityTrackerFeedback',
    tableBodySelector: '#activityTrackerBody',
    searchSelector: '#activitySearch',
    dateFromSelector: '#activityDateFrom',
    dateToSelector: '#activityDateTo',
    minVoyagesSelector: '#activityMinVoyages',
    quotaTargetSelector: '#activityQuotaTarget',
    quotaFilterSelector: '#activityQuotaFilter',
    activeOnlySelector: '#activityActiveOnly',
    summaryGridSelector: '#activitySummaryGrid',
    presetButtonSelector: '[data-activity-preset]',
    exportCsvBtnSelector: '#activityExportCsvBtn',
    prevPageBtnSelector: '#activityPrevPageBtn',
    nextPageBtnSelector: '#activityNextPageBtn',
    pageInfoSelector: '#activityPaginationInfo'
  })
  );
});

initializeYear();
