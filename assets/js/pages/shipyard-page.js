import { initIntranetLayout } from '../modules/intranet-layout.js?v=20260313e';
import { initShipyardPage } from '../modules/shipyard.js?v=20260313a';

initIntranetLayout({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  requiredPermissions: ['voyages.config.manage']
}).then((session) => {
  if (!session) return;
  initShipyardPage({
    feedbackSelector: '#shipyardFeedback',
    formSelector: '#shipyardCreateForm',
    listSelector: '#shipyardList'
  });
});
