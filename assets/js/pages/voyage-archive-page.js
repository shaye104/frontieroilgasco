import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260222b';
import { initVoyageArchive } from '../modules/voyage-archive.js?v=20260227a';
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
    paginationSelector: '#archivePagination',
    deleteModalSelector: '#deleteVoyageModal',
    deleteFormSelector: '#deleteVoyageForm',
    deleteVoyageIdSelector: '#deleteVoyageId',
    deleteReasonSelector: '#deleteVoyageReason',
    deleteConfirmSelector: '#deleteVoyageConfirm',
    deleteAcknowledgeSelector: '#deleteVoyageAcknowledge',
    deleteConfirmButtonSelector: '#deleteVoyageConfirmBtn',
    deleteSummarySelector: '#deleteVoyageSummary',
    deleteModalFeedbackSelector: '#deleteVoyageModalFeedback'
  });
});

initializeYear();
