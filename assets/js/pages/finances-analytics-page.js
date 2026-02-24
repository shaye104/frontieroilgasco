import { initFinancesAnalytics } from '../modules/finances.js';
import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260222b';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  requiredPermissions: ['finances.view']
}).then((session) => {
  if (!session) return;

  initFinancesAnalytics({
    feedbackSelector: '#analyticsFeedback',
    rangeButtonsSelector: '[data-finance-range]',
    netProfitChartSelector: '#analyticsChartNetProfit',
    shareChartSelector: '#analyticsChartCompanyCrew',
    lossesChartSelector: '#analyticsChartLossTrend',
    avgChartSelector: '#analyticsChartAvgProfit'
  });
});

initializeYear();
