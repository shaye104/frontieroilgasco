import { initIntranetLogin } from '../modules/intranet-login.js';
import { initializeYear } from '../modules/year.js';

initIntranetLogin({
  formSelector: '#intranetLoginForm',
  feedbackSelector: '#loginFeedback',
  panelSelector: '#intranetPanel',
  welcomeSelector: '#welcomeText'
});

initializeYear();
