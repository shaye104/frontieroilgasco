import { initIntranetAuth } from '../modules/intranet-auth.js';
import { initializeYear } from '../modules/year.js';

initIntranetAuth({
  authPanelSelector: '#authPanel',
  loginButtonSelector: '#discordLoginBtn',
  feedbackSelector: '#loginFeedback',
  panelSelector: '#intranetPanel',
  welcomeSelector: '#welcomeText',
  navLogoutButtonSelector: '#navLogoutBtn',
  adminNavLinkSelector: '#adminNavLink',
  adminPanelLinkRowSelector: '#adminPanelLinkRow'
});

initializeYear();
