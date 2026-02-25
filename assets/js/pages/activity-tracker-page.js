import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260222b';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  requiredPermissions: ['activity_tracker.view']
}).then((session) => {
  if (!session) return;

  import('../modules/activity-tracker.js?v=20260225a').then(({ initActivityTracker }) =>
    initActivityTracker({
    feedbackSelector: '#activityTrackerFeedback',
    tableBodySelector: '#activityTrackerBody',
    searchSelector: '#activitySearch',
    actionTypeSelector: '#activityActionType',
    actorSelector: '#activityActor',
    targetEmployeeSelector: '#activityTargetEmployeeId',
    dateFromSelector: '#activityDateFrom',
    dateToSelector: '#activityDateTo',
    exportCsvBtnSelector: '#activityExportCsvBtn',
    prevPageBtnSelector: '#activityPrevPageBtn',
    nextPageBtnSelector: '#activityNextPageBtn',
    pageInfoSelector: '#activityPaginationInfo'
  })
  );
});

initializeYear();
