import { initIntranetPageGuard } from '../modules/intranet-page-guard.js';
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
      startButtonSelector: '#openStartVoyageBtn',
      startFormSelector: '#startVoyageForm',
      officerSelector: '#voyageOowSelect',
      crewSelector: '#voyageCrewSelect'
    },
    session
  );
});

initializeYear();
