import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initFormsCategoriesAdmin } from '../modules/forms-categories-admin.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requireFormsAdmin: true
}).then((session) => {
  if (!session?.hasFormsAdmin) return;

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
