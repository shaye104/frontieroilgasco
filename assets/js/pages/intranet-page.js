import { initIntranetAuth } from '../modules/intranet-auth.js';
import { initializeYear } from '../modules/year.js';

initIntranetAuth({
  loginButtonSelector: '#discordLoginBtn',
  logoutButtonSelector: '#logoutBtn',
  feedbackSelector: '#loginFeedback',
  panelSelector: '#intranetPanel',
  welcomeSelector: '#welcomeText'
});

initializeYear();
