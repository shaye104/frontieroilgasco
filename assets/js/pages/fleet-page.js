import { initIntranetLayout } from '../modules/intranet-layout.js?v=20260313e';
import { initFleetPage } from '../modules/fleet.js?v=20260313i';

initIntranetLayout({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['voyages.read']
}).then((session) => {
  if (!session) return;
  initFleetPage({
    feedbackSelector: '#fleetFeedback',
    totalsSelector: '#fleetTotals',
    toggleEmptySelector: '#fleetToggleEmptyShipsBtn',
    shipsSelector: '#fleetShips',
    drawerModalSelector: '#fleetDrawerModal',
    drawerFrameSelector: '#fleetDrawerFrame',
    drawerCloseSelector: '#fleetDrawerClose',
    shipModalSelector: '#fleetShipModal',
    shipModalBodySelector: '#fleetShipModalBody',
    shipModalTitleSelector: '#fleetShipModalTitle',
    shipModalCloseSelector: '#fleetShipModalClose'
  });
});
