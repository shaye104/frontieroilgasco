import { renderPublicNavbar } from '../modules/nav.js';
import { initializeYear } from '../modules/year.js';

const REASON_MESSAGES = {
  missing_permission: 'Your account is authenticated, but it does not have permission to access this page.',
  missing_permissions: 'Your account is missing one or more permissions required for this page.',
  admin_required: 'This page requires admin access.',
  forms_admin_required: 'This page requires forms admin access.',
  access_pending: 'Your employee access is still pending approval.'
};

function initAccessDeniedPage() {
  renderPublicNavbar();
  const target = document.querySelector('#accessDeniedDetail');
  if (!target) return;
  const params = new URLSearchParams(window.location.search);
  const reason = String(params.get('reason') || '').trim();
  if (reason && REASON_MESSAGES[reason]) {
    target.textContent = REASON_MESSAGES[reason];
  }
}

initAccessDeniedPage();
initializeYear();
