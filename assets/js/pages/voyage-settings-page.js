import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260304a';
import { initVoyageSettingsAdmin } from '../modules/voyage-settings-admin.js?v=20260227c';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['voyages.config.manage']
}).then((session) => {
  if (!session) return;
  initVoyageSettingsAdmin({
    feedbackSelector: '#voyageSettingsFeedback',
    gridSelector: '#voyageSettingsGrid'
  });
});

initializeYear();
