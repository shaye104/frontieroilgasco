import { initFinancesDebts } from '../modules/finances.js';
import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260221f';
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
      tableBodySelector: '#financeDebtsBody',
      searchSelector: '#debtSearch',
      minOutstandingSelector: '#debtMinOutstanding',
      totalsSelector: '#debtTotals',
      pageInfoSelector: '#financeDebtsPageInfo',
      prevButtonSelector: '#financeDebtsPrev',
      nextButtonSelector: '#financeDebtsNext',
      pageSize: 6
    },
    session
  );
});

initializeYear();
