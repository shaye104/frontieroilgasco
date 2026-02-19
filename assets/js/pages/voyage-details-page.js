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
    fieldListSelector: '#voyageFieldList',
    profileFeedbackSelector: '#profileFeedback',
    profileEditToggleSelector: '#profileEditToggleBtn',
    manifestBodySelector: '#manifestTableBody',
    buyTotalSelector: '#buyTotalText',
    manifestSaveStateSelector: '#manifestSaveState',
    manifestFeedbackSelector: '#manifestFeedback',
    openEndVoyageButtonSelector: '#openEndVoyageBtn',
    addLogFormSelector: '#addLogForm',
    logListSelector: '#shipLogList',
    endFormSelector: '#endVoyageForm',
    endFeedbackSelector: '#endVoyageFeedback',
    cargoLostEditorSelector: '#cargoLostEditor',
    addCargoButtonSelector: '#openAddCargoBtn',
    addCargoFormSelector: '#addCargoForm',
    addCargoTypeSelector: '#addCargoTypeSelect',
    shipStatusControlsSelector: '#shipStatusControls',
    shipStatusToggleSelector: '#shipStatusToggle',
    editVoyageModalSelector: '#editVoyageModal',
    editVoyageFormSelector: '#editVoyageForm',
    editVoyageFeedbackSelector: '#editVoyageFeedback',
    editDepartureSelector: '#editDeparturePort',
    editDestinationSelector: '#editDestinationPort',
    editVesselNameSelector: '#editVesselName',
    editVesselClassSelector: '#editVesselClass',
    editVesselCallsignSelector: '#editVesselCallsign',
    editOowSearchSelector: '#editOowSearch',
    editOowResultsSelector: '#editOowResults',
    editOowSelectedSelector: '#editOowSelected',
    editOowErrorSelector: '#editOowError',
    editCrewSearchSelector: '#editCrewSearch',
    editCrewResultsSelector: '#editCrewResults',
    editCrewSelectedSelector: '#editCrewSelected',
    editCrewInfoSelector: '#editCrewInfo',
    editCrewErrorSelector: '#editCrewError',
    saveEditVoyageButtonSelector: '#saveEditVoyageBtn',
    finaliseHoldButtonSelector: '#finaliseVoyageHoldBtn',
    cancelVoyageHoldButtonSelector: '#cancelVoyageHoldBtn',
    sellMultiplierSelector: '#sellMultiplierInput',
    baseSellPriceSelector: '#baseSellPriceInput',
    breakdownTrueSellUnitPriceSelector: '#breakdownTrueSellUnitPrice',
    breakdownRevenueSelector: '#breakdownRevenue',
    breakdownCostSelector: '#breakdownCost',
    breakdownProfitSelector: '#breakdownProfit',
    breakdownCompanyShareSelector: '#breakdownCompanyShare',
    breakdownContainerSelector: '#financialBreakdown'
  });
});

initializeYear();
