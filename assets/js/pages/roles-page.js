import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initRolesAdmin } from '../modules/roles-admin.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['admin.access', 'user_groups.manage']
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
    deleteRoleBtnSelector: '#deleteRoleBtn'
  });
});

initializeYear();
