import { initIntranetAuth } from '../modules/intranet-auth.js';
import { initializeYear } from '../modules/year.js';

initIntranetAuth({
  authPanelSelector: '#authPanel',
  loginButtonSelector: '#discordLoginBtn',
  feedbackSelector: '#loginFeedback',
  panelSelector: '#intranetPanel',
  logoutButtonSelector: '#dashboardLogoutBtn',
  adminNavLinkSelector: '#adminNavLink',
  adminPanelLinkRowSelector: '#adminPanelLinkRow',
  pendingPanelSelector: '#pendingPanel'
});

initializeYear();
