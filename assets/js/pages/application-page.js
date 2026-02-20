import { initApplicationForm } from '../modules/application-form.js';
import { renderPublicNavbar } from '../modules/nav.js';
import { initializeYear } from '../modules/year.js';

renderPublicNavbar();
initApplicationForm('#applicationForm', '#formFeedback');
initializeYear();
