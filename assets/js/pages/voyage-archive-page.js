import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260221d';
import { initVoyageArchive } from '../modules/voyage-archive.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  requiredPermissions: ['voyages.read']
}).then((session) => {
  if (!session) return;

  initVoyageArchive({
    feedbackSelector: '#archiveFeedback',
    gridSelector: '#archiveGrid',
    prevButtonSelector: '#archivePrevBtn',
    nextButtonSelector: '#archiveNextBtn',
    pageInfoSelector: '#archivePageInfo',
    paginationSelector: '#archivePagination'
  });
});

initializeYear();
