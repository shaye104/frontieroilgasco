import { initFinancesOverview } from '../modules/finances.js';
import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260221d';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  requiredAnyPermissions: ['finances.view', 'admin.override']
}).then((session) => {
  if (!session) return;

  initFinancesOverview({
    feedbackSelector: '#financesFeedback',
    rangeButtonsSelector: '[data-finance-range]',
    unsettledScopeSelector: '#unsettledScopeSelect',
    netProfitSelector: '#kpiNetProfit',
    companyShareSelector: '#kpiCompanyShare',
    crewShareSelector: '#kpiCrewShare',
    lossesSelector: '#kpiLossValue',
    unsettledSelector: '#kpiUnsettled',
    completedSelector: '#kpiCompletedVoyages',
    netProfitChartSelector: '#chartNetProfit',
    shareChartSelector: '#chartCompanyCrew',
    lossesChartSelector: '#chartLossTrend',
    avgChartSelector: '#chartAvgProfit',
    topDebtorsSelector: '#unsettledTopList'
  });
});

initializeYear();
