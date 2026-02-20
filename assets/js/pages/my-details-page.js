import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initMyDetailsPanel } from '../modules/my-details-panel.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['my_details.view']
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
      grade: '#fieldGrade',
      serialNumber: '#fieldSerialNumber',
      employeeStatus: '#fieldEmployeeStatus',
      hireDate: '#fieldHireDate',
      tenureDays: '#fieldTenureDays',
      totalVoyages: '#fieldTotalVoyages',
      monthlyVoyages: '#fieldMonthlyVoyages'
    }
  });
});

initializeYear();
