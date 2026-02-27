import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260222b';
import { initVoyageSettingsAdmin } from '../modules/voyage-settings-admin.js?v=20260227a';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['admin.access', 'voyages.config.manage']
}).then((session) => {
  if (!session) return;
  initVoyageSettingsAdmin({
    feedbackSelector: '#voyageSettingsFeedback',
    gridSelector: '#voyageSettingsGrid'
  });
});

initializeYear();
