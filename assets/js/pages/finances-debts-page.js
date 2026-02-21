import { initFinancesDebts } from '../modules/finances.js';
import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260221d';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  requiredPermissions: ['finances.view']
}).then((session) => {
  if (!session) return;

  initFinancesDebts(
    {
      feedbackSelector: '#debtsFeedback',
      groupsSelector: '#debtGroups',
      searchSelector: '#debtSearch',
      minOutstandingSelector: '#debtMinOutstanding',
      totalsSelector: '#debtTotals',
      auditLinkSelector: '#financeAuditLink'
    },
    session
  );
});

initializeYear();
