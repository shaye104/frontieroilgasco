import { companyProfile } from '../modules/company-data.js';
import { renderHomeContent } from '../modules/render-company.js';
import { initializeYear } from '../modules/year.js';

renderHomeContent(companyProfile);
initializeYear();
