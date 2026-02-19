import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initFormsBuilderAdmin } from '../modules/forms-builder-admin.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['admin.access', 'forms.manage']
}).then((session) => {
  if (!session) return;

  initFormsBuilderAdmin({
    feedbackSelector: '#formsBuilderFeedback',
    titleSelector: '#builderTitle',
    formSelector: '#formEditorForm',
    questionBuilderSelector: '#questionBuilder',
    addQuestionBtnSelector: '#addQuestionBtn',
    deleteBtnSelector: '#deleteFormBtn'
  });
});

initializeYear();
