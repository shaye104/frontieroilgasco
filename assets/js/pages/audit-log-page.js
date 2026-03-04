import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260304b';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  requiredPermissions: ['activity_tracker.view']
}).then((session) => {
  if (!session) return;

  import('../modules/audit-log.js?v=20260227a').then(({ initAuditLog }) =>
    initAuditLog({
      feedbackSelector: '#auditLogFeedback',
      tableBodySelector: '#auditLogBody',
      searchSelector: '#auditSearch',
      actionTypeSelector: '#auditActionType',
      actorSelector: '#auditActor',
      targetEmployeeSelector: '#auditTargetEmployeeId',
      dateFromSelector: '#auditDateFrom',
      dateToSelector: '#auditDateTo',
      exportCsvBtnSelector: '#auditExportCsvBtn',
      prevPageBtnSelector: '#auditPrevPageBtn',
      nextPageBtnSelector: '#auditNextPageBtn',
      pageInfoSelector: '#auditPaginationInfo'
    })
  );
});

initializeYear();

