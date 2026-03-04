import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260304b';
import { initUserRanksAdmin } from '../modules/user-ranks-admin.js?v=20260227b';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  requiredPermissions: ['user_ranks.manage']
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
