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
    manifestBodySelector: '#manifestTableBody',
    buyTotalSelector: '#buyTotalText',
    saveManifestButtonSelector: '#saveManifestBtn',
    addLogFormSelector: '#addLogForm',
    logListSelector: '#shipLogList',
    endVoyageSectionSelector: '#endVoyageSection',
    endFormSelector: '#endVoyageForm',
    cargoLostEditorSelector: '#cargoLostEditor',
    addCargoButtonSelector: '#openAddCargoBtn',
    addCargoFormSelector: '#addCargoForm',
    addCargoTypeSelector: '#addCargoTypeSelect',
    shipStatusControlsSelector: '#shipStatusControls',
    shipUnderwaySelector: '#shipUnderwayBtn',
    shipInPortSelector: '#shipInPortBtn',
    finaliseHoldButtonSelector: '#finaliseVoyageHoldBtn',
    cancelVoyageHoldButtonSelector: '#cancelVoyageHoldBtn',
    sellMultiplierSelector: '#sellMultiplierInput',
    baseSellPriceSelector: '#baseSellPriceInput',
    breakdownBuyTotalSelector: '#breakdownBuyTotal',
    breakdownProfitSelector: '#breakdownProfit',
    breakdownCompanyShareSelector: '#breakdownCompanyShare',
    breakdownHintSelector: '#breakdownHint',
    updateFieldFormSelector: '#updateFieldForm',
    updateFieldTitleSelector: '#updateFieldTitle',
    updateFieldKeySelector: '#updateFieldKey',
    updateFieldControlsSelector: '#updateFieldControls'
  });
});

initializeYear();
