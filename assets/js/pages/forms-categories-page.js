import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260221d';
import { initFormsCategoriesAdmin } from '../modules/forms-categories-admin.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['admin.access', 'forms.manage']
}).then((session) => {
  if (!session) return;

  initFormsCategoriesAdmin({
    feedbackSelector: '#categoriesFeedback',
    listSelector: '#categoryList',
    formSelector: '#categoryForm',
    editorSelector: '#categoryEditor',
    openBtnSelector: '#openCategoryFormBtn',
    saveBtnSelector: '#saveCategoryBtn',
    cancelBtnSelector: '#cancelCategoryBtn'
  });
});

initializeYear();
