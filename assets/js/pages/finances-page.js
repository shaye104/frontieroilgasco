import { initFinancesOverview } from '../modules/finances.js';
import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260221e';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent'
}).then((session) => {
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
    topDebtorsSelector: '#unsettledTopList',
    unsettledTotalSelector: '#unsettledOutstandingTotal'
  });
});

initializeYear();
