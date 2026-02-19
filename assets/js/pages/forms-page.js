import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initFormsList } from '../modules/forms-list.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink'
}).then((session) => {
  if (!session) return;

  initFormsList(
    {
      feedbackSelector: '#formsFeedback',
      categoriesSelector: '#formsCategories',
      uncategorizedSelector: '#formsUncategorized',
      adminActionsSelector: '#formsAdminActions'
    },
    session
  );
});

initializeYear();
