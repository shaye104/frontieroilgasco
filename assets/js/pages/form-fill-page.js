import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initFormFill } from '../modules/form-fill.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink'
}).then((session) => {
  if (!session) return;

  initFormFill({
    feedbackSelector: '#formFillFeedback',
    formTitleSelector: '#formTitle',
    formDescriptionSelector: '#formDescription',
    formSelector: '#formFillForm'
  });
});

initializeYear();
