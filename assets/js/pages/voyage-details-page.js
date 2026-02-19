import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
import { initVoyageDetails } from '../modules/voyage-details.js';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['voyages.read']
}).then((session) => {
  if (!session) return;
  initVoyageDetails({
    feedbackSelector: '#voyageDetailFeedback',
    headingSelector: '#voyageHeading',
    metaSelector: '#voyageMeta',
    manifestBodySelector: '#manifestTableBody',
    buyTotalSelector: '#buyTotalText',
    saveManifestButtonSelector: '#saveManifestBtn',
    endButtonSelector: '#endVoyageBtn',
    addLogFormSelector: '#addLogForm',
    logListSelector: '#shipLogList',
    endFormSelector: '#endVoyageForm',
    cargoLostEditorSelector: '#cargoLostEditor',
    detailsFormSelector: '#voyageDetailsForm',
    addCargoButtonSelector: '#openAddCargoBtn',
    addCargoFormSelector: '#addCargoForm',
    addCargoTypeSelector: '#addCargoTypeSelect',
    editDepartureSelector: '#editDeparturePort',
    editDestinationSelector: '#editDestinationPort',
    editVesselNameSelector: '#editVesselName',
    editVesselClassSelector: '#editVesselClass',
    editVesselCallsignSelector: '#editVesselCallsign',
    editOowSearchSelector: '#editOowSerialSearch',
    editOowResultsSelector: '#editOowResults',
    editOowHiddenSelector: '#editOowHidden',
    editOowSelectedSelector: '#editOowSelected',
    editCrewSearchSelector: '#editCrewSerialSearch',
    editCrewResultsSelector: '#editCrewResults',
    editCrewSelectedSelector: '#editCrewSelected'
  });
});

initializeYear();
