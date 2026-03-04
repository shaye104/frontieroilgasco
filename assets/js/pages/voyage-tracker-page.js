import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260304b';
import { initVoyageTracker } from '../modules/voyage-tracker.js?v=20260304a';
import { initializeYear } from '../modules/year.js';

initIntranetPageGuard({
  feedbackSelector: '#guardFeedback',
  protectedContentSelector: '#protectedContent',
  adminNavLinkSelector: '#adminNavLink',
  requiredPermissions: ['voyages.read']
}).then((session) => {
  if (!session) return;
  initVoyageTracker(
    {
      feedbackSelector: '#voyageFeedback',
      ongoingSelector: '#ongoingVoyages',
      archivedSelector: '#archivedVoyages',
      archivedCtaSelector: '#viewAllArchivedLink',
      ongoingCountSelector: '#ongoingCountChip',
      archivedCountSelector: '#archivedCountChip',
      startButtonSelector: '#openStartVoyageBtn',
      startFormSelector: '#startVoyageForm',
      departureSelector: '#voyageDepartureSelect',
      destinationSelector: '#voyageDestinationSelect',
      vesselNameSelector: '#voyageVesselNameSelect',
      vesselClassSelector: '#voyageVesselClassSelect',
      vesselCallsignSelector: '#voyageVesselCallsignSelect',
      officerSearchSelector: '#voyageOowSerialSearch',
      officerResultsSelector: '#voyageOowResults',
      officerHiddenSelector: '#voyageOowHidden',
      officerSelectedSelector: '#voyageOowSelected',
      officerErrorSelector: '#voyageOowError',
      crewSearchSelector: '#voyageCrewSerialSearch',
      crewResultsSelector: '#voyageCrewResults',
      crewSelectedSelector: '#voyageCrewSelected',
      crewInfoSelector: '#voyageCrewInfo',
      crewErrorSelector: '#voyageCrewError',
      notifyOpenSelector: '#openNotifyModalBtn',
      notifyFormSelector: '#notifyForm',
      notifyTargetModeSelector: '#notifyTargetMode',
      notifySpecificPanelSelector: '#notifySpecificPanel',
      notifyUserSearchSelector: '#notifyUserSearch',
      notifyUserResultsSelector: '#notifyUserResults',
      notifySelectedUsersSelector: '#notifySelectedUsers',
      notifyFeedbackSelector: '#notifyFeedback',
      notifySendButtonSelector: '#notifySendBtn'
    },
    session
  );
});

initializeYear();
