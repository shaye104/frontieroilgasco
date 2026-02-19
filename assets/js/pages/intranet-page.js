import { initIntranetAuth } from '../modules/intranet-auth.js';
import { initializeYear } from '../modules/year.js';

initIntranetAuth({
  authPanelSelector: '#authPanel',
  loginButtonSelector: '#discordLoginBtn',
  feedbackSelector: '#loginFeedback',
  panelSelector: '#intranetPanel',
  navLogoutButtonSelector: '#navLogoutBtn',
  adminNavLinkSelector: '#adminNavLink',
  navVoyageLinkSelector: '#navVoyageLink',
  navFleetLinkSelector: '#navFleetLink',
  adminPanelLinkRowSelector: '#adminPanelLinkRow',
  voyageLinkRowSelector: '#voyageLinkRow',
  fleetLinkRowSelector: '#fleetLinkRow',
  pendingPanelSelector: '#pendingPanel'
});

initializeYear();
