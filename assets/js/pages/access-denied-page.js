import { renderPublicNavbar } from '../modules/nav.js';
import { initializeYear } from '../modules/year.js';

const REASON_MESSAGES = {
  missing_permission: 'Your account is authenticated, but it does not have permission to access this page.',
  missing_permissions: 'Your account is missing one or more permissions required for this page.',
  admin_required: 'This page requires admin access.',
  forms_admin_required: 'This page requires forms admin access.',
  access_pending: 'Your employee access is still pending approval.',
  oauth_callback_invalid: 'OAuth callback was invalid or incomplete.',
  oauth_state_invalid: 'OAuth state validation failed. Please try signing in again.',
  oauth_token_exchange_failed: 'Could not exchange OAuth code for an access token.',
  oauth_user_fetch_failed: 'Could not fetch your Discord account details.',
  session_build_failed: 'Could not build your session. Please try again.',
  access_request_failed: 'Your access request could not be recorded. Please contact an administrator.'
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
