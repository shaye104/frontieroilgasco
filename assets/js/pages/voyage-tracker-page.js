import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260313e';
import { initVoyageTracker } from '../modules/voyage-tracker.js?v=20260313d';
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
      vesselNameSelector: '#voyageVesselNameInput',
      vesselClassSelector: '#voyageVesselClassInput',
      vesselCallsignSelector: '#voyageVesselCallsignInput',
      reservationTokenSelector: '#voyageShipReservationToken',
      assignedVesselInfoSelector: '#voyageAssignedVesselInfo',
      startSubmitSelector: '#startVoyageSubmitBtn',
      startHintSelector: '#voyageStartHint',
      officerHiddenSelector: '#voyageOowHidden',
      officerSelectedSelector: '#voyageOowSelected',
      crewSearchSelector: '#voyageCrewSerialSearch',
      crewResultsSelector: '#voyageCrewResults',
      crewSelectedSelector: '#voyageCrewSelected',
      crewInfoSelector: '#voyageCrewInfo',
      crewErrorSelector: '#voyageCrewError',
      notifyOpenSelector: '#openNotifyModalBtn',
      notifyFormSelector: '#notifyForm',
      notifyTargetModeSelector: '#notifyTargetMode',
      notifySpecificPanelSelector: '#notifySpecificPanel',
      notifyUserSelectSelector: '#notifyUserSelect',
      notifySelectedUsersSelector: '#notifySelectedUsers',
      notifyFeedbackSelector: '#notifyFeedback',
      notifySendButtonSelector: '#notifySendBtn'
    },
    session
  );
});

initializeYear();
