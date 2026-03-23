import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260313e';
import { initMyDetailsPanel } from '../modules/my-details-panel.js?v=20260308a';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink'
}).then((session) => {
  if (!session) return;
  initMyDetailsPanel({
    feedbackSelector: '#guardFeedback',
    accessPendingSelector: '#accessPendingPanel',
    detailsPanelSelector: '#detailsPanel',
    activeDisciplinarySelector: '#activeDisciplinaryList',
    disciplinaryHistorySelector: '#disciplinaryHistoryList',
    fields: {
      robloxUsername: '#fieldRobloxUsername',
      robloxUserId: '#fieldRobloxUserId',
      rank: '#fieldRank',
      employeeStatus: '#fieldEmployeeStatus',
      hireDate: '#fieldHireDate',
      tenureDays: '#fieldTenureDays',
      totalVoyages: '#fieldTotalVoyages',
      monthlyVoyages: '#fieldMonthlyVoyages',
      identityUsername: '#identityUsername',
      identityRankBadge: '#identityRankBadge',
      identityStatusBadge: '#identityStatusBadge',
      profileUsername: '#profileUsername',
      profileRankText: '#profileRankText',
      profileStatusText: '#profileStatusText',
      profileTenureText: '#profileTenureText'
    }
  });
});

initializeYear();
