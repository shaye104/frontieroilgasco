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
    endButtonSelector: '#endVoyageBtn',
    addLogFormSelector: '#addLogForm',
    logListSelector: '#shipLogList',
    endFormSelector: '#endVoyageForm',
    cargoLostEditorSelector: '#cargoLostEditor',
    addCargoButtonSelector: '#openAddCargoBtn',
    addCargoFormSelector: '#addCargoForm',
    addCargoTypeSelector: '#addCargoTypeSelect',
    shipStatusControlsSelector: '#shipStatusControls',
    shipInPortSelector: '#shipInPortBtn',
    shipUnderwaySelector: '#shipUnderwayBtn',
    updateFieldFormSelector: '#updateFieldForm',
    updateFieldTitleSelector: '#updateFieldTitle',
    updateFieldKeySelector: '#updateFieldKey',
    updateFieldControlsSelector: '#updateFieldControls',
    cancelVoyageWrapSelector: '#cancelVoyageWrap',
    cancelVoyageHoldButtonSelector: '#cancelVoyageHoldBtn',
    cancelVoyageProgressSelector: '#cancelVoyageProgress'
  });
});

initializeYear();
