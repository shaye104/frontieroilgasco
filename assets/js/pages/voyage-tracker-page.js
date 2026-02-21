import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260221d';
import { initVoyageTracker } from '../modules/voyage-tracker.js';
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
      crewErrorSelector: '#voyageCrewError'
    },
    session
  );
});

initializeYear();
