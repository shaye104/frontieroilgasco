import { initFinancesAudit } from '../modules/finances.js';
import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260221e';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  requiredPermissions: ['finances.audit.view']
}).then((session) => {
  if (!session) return;

  initFinancesAudit({
    feedbackSelector: '#auditFeedback',
    tableBodySelector: '#financeAuditBody',
    pageInfoSelector: '#financeAuditPageInfo',
    prevButtonSelector: '#financeAuditPrev',
    nextButtonSelector: '#financeAuditNext'
  });
});

initializeYear();
