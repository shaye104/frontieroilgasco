import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initFormsAdmin } from '../modules/forms-admin.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requireAdmin: true
}).then((session) => {
  if (!session?.isAdmin) return;

  initFormsAdmin({
    feedbackSelector: '#formsAdminFeedback',
    categoryFormSelector: '#categoryForm',
    saveCategoryBtnSelector: '#saveCategoryBtn',
    resetCategoryBtnSelector: '#resetCategoryBtn',
    categoryListSelector: '#categoryList',
    formListSelector: '#formList',
    formEditorFormSelector: '#formEditorForm',
    newFormBtnSelector: '#newFormBtn',
    deleteFormBtnSelector: '#deleteFormBtn',
    addQuestionBtnSelector: '#addQuestionBtn',
    questionBuilderSelector: '#questionBuilder',
    categoriesPanelSelector: '#categoriesPanel',
    formBuilderPanelSelector: '#formBuilderPanel'
  });
});

initializeYear();
