import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260221d';
import { initActivityTracker } from '../modules/activity-tracker.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  requiredPermissions: ['activity_tracker.view']
}).then((session) => {
  if (!session) return;

  initActivityTracker({
    feedbackSelector: '#activityTrackerFeedback',
    tableBodySelector: '#activityTrackerBody',
    searchSelector: '#activitySearch',
    lessThanSelector: '#activityLessThan',
    scopeSelector: '#activityScope'
  });
});

initializeYear();
