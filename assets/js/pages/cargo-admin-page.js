import { initCargoAdmin } from '../modules/cargo-admin.js';
import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260221d';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['admin.access']
}).then((session) => {
  if (!session) return;
  initCargoAdmin({
    feedbackSelector: '#cargoFeedback',
    tableBodySelector: '#cargoTableBody',
    openModalButtonSelector: '#openCargoModalBtn',
    formSelector: '#cargoForm',
    modalTitleSelector: '#cargoModalTitle',
    voyageConfigSectionSelector: '#voyageConfigLists',
    cargoSectionSelector: '#cargoTypeSection',
    listPortsSelector: '#listPorts',
    listVesselNamesSelector: '#listVesselNames',
    listVesselClassesSelector: '#listVesselClasses',
    listVesselCallsignsSelector: '#listVesselCallsigns'
  }, session);
});

initializeYear();
