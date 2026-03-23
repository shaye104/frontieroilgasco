import { initIntranetAuth } from '../modules/intranet-auth.js?v=20260226a';
import { initializeYear } from '../modules/year.js';

initIntranetAuth({
  authPanelSelector: '#authPanel',
  loginButtonSelector: '#discordLoginBtn',
  feedbackSelector: '#loginFeedback'
});

initializeYear();
