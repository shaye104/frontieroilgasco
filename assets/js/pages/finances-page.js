import { initFinancesConsole } from '../modules/finances.js';
import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260221h';
import { initializeYear } from '../modules/year.js';
import { performLogout } from '../modules/nav.js?v=20260221h';

function ensureFinancesNavbarFallback() {
  const nav = document.querySelector('.site-nav');
  if (!nav) return;
  if (nav.querySelector('a[href]')) return;

  nav.innerHTML = `
    <a href="/my-details">My Details</a>
    <a href="/voyages/my">Voyages</a>
    <a href="/my-fleet">My Fleet</a>
    <a href="/forms">Forms</a>
    <a href="/finances">Finances</a>
    <a href="/admin">Admin Panel</a>
    <span class="nav-spacer"></span>
    <button id="financeFallbackLogout" class="btn btn-secondary" type="button">Logout</button>
  `;

  const logout = document.querySelector('#financeFallbackLogout');
  if (logout) {
    logout.addEventListener('click', async () => {
      await performLogout('/');
    });
  }
}

const sharedConfig = {
  session: null,
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
};

ensureFinancesNavbarFallback();
initFinancesConsole(sharedConfig);

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent'
});

initializeYear();
