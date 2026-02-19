import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initFormsBuilderAdmin } from '../modules/forms-builder-admin.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requireFormsAdmin: true
}).then((session) => {
  if (!session?.hasFormsAdmin) return;

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
