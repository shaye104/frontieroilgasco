import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260313e';
import { initVoyageDetails } from '../modules/voyage-details.js?v=20260313e';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['voyages.read']
}).then((session) => {
  if (!session) return;
  initVoyageDetails({
    feedbackSelector: '#voyageDetailFeedback',
    headingSelector: '#voyageHeading',
    fieldListSelector: '#voyageFieldList',
    toteBodySelector: '#toteTableBody',
    toteFeedbackSelector: '#toteFeedback',
    toteAutosaveStateSelector: '#toteAutosaveState',
    addToteButtonSelector: '#addToteBtn',
    addLogFormSelector: '#addLogForm',
    logListSelector: '#shipLogList',
    settlementSectionSelector: '#settlementSection',
    settlementSummarySelector: '#settlementSummary',
    openEndVoyageButtonSelector: '#openEndVoyageBtn',
    endFormSelector: '#endVoyageForm',
    endFeedbackSelector: '#endVoyageFeedback',
    sellLocationSelector: '#sellLocationSelect',
    sellMultiplierInputSelector: '#sellMultiplierInput',
    ownerSettlementBodySelector: '#ownerSettlementBody',
    voyageTotalEarningsSelector: '#voyageTotalEarnings'
  });
});

initializeYear();
