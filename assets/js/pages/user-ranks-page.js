import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initUserRanksAdmin } from '../modules/user-ranks-admin.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  requiredPermissions: ['admin.access', 'user_ranks.manage']
}).then((session) => {
  if (!session) return;
  initUserRanksAdmin(
    {
      feedbackSelector: '#userRanksFeedback',
      listSelector: '#userRanksList',
      hintSelector: '#userRanksHint',
      formSelector: '#userRanksDetailsForm',
      permissionsEditorSelector: '#userRanksPermissionsEditor',
      openCreateRankBtnSelector: '#openCreateRankBtn',
      createFormSelector: '#createUserRankForm',
      deleteButtonSelector: '#deleteUserRankBtn'
    },
    session
  );
});

initializeYear();
