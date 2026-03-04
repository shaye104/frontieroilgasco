import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260304b';
import { initRolesAdmin } from '../modules/roles-admin.js?v=20260227c';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['user_groups.manage']
}).then((session) => {
  if (!session) return;

  initRolesAdmin({
    feedbackSelector: '#rolesFeedback',
    listSelector: '#rolesList',
    formSelector: '#roleDetailsForm',
    hintSelector: '#selectedRoleHint',
    permissionsEditorSelector: '#permissionsEditor',
    openCreateRoleBtnSelector: '#openCreateRoleBtn',
    createRoleFormSelector: '#createRoleForm',
    cloneRoleBtnSelector: '#cloneRoleBtn',
    deleteRoleBtnSelector: '#deleteRoleBtn',
    roleMemberSearchInputSelector: '#roleMemberSearchInput',
    roleMemberSearchBtnSelector: '#roleMemberSearchBtn',
    roleMemberCandidatesSelector: '#roleMemberCandidates',
    roleMembersListSelector: '#roleMembersList'
  });
});

initializeYear();
