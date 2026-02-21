import { initFinancesConsole } from '../modules/finances.js';
import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260221g';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent'
}).then((session) => {
  if (!session) return;

  initFinancesConsole({
    session,
    feedbackSelector: '#financesFeedback',
    tabButtonsSelector: '[data-finance-tab]',
    panelSelector: '[data-finance-panel]',
    openTabLinkSelector: '[data-finance-open-tab]',
    rangeButtonsSelector: '[data-finance-range]',
    unsettledScopeSelector: '#unsettledScopeSelect',
    overviewPanelSelector: '#financeTabOverview',
    analyticsPanelSelector: '#financeTabAnalytics',
    debtsPanelSelector: '#financeTabDebts',
    auditPanelSelector: '#financeTabAudit',
    netProfitSelector: '#kpiNetProfit',
    companyShareSelector: '#kpiCompanyShare',
    crewShareSelector: '#kpiCrewShare',
    lossesSelector: '#kpiLossValue',
    unsettledSelector: '#kpiUnsettled',
    completedSelector: '#kpiCompletedVoyages',
    netProfitChartSelector: '#chartNetProfit',
    shareChartSelector: '#chartCompanyCrew',
    avgChartSelector: '#chartAvgProfit',
    miniMetricValueSelector: '#avgMiniValue',
    topDebtorsSelector: '#unsettledTopList',
    unsettledTotalSelector: '#unsettledOutstandingTotal',
    analyticsNetProfitChartSelector: '#analyticsChartNetProfit',
    analyticsShareChartSelector: '#analyticsChartCompanyCrew',
    analyticsLossesChartSelector: '#analyticsChartLossTrend',
    analyticsAvgChartSelector: '#analyticsChartAvgProfit',
    debtGroupsSelector: '#financeDebtsGroups',
    debtSearchSelector: '#debtSearch',
    debtMinOutstandingSelector: '#debtMinOutstanding',
    debtTotalsSelector: '#debtTotals',
    debtPrevSelector: '#financeDebtsPrev',
    debtNextSelector: '#financeDebtsNext',
    debtPageInfoSelector: '#financeDebtsPageInfo',
    auditTableBodySelector: '#financeAuditBody',
    auditPrevSelector: '#financeAuditPrev',
    auditNextSelector: '#financeAuditNext',
    auditPageInfoSelector: '#financeAuditPageInfo'
  });
});

initializeYear();
