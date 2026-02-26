import { getOnboardingMe, getSession, submitOnboardingRobloxProfile } from '../modules/admin-api.js?v=20260226d';
import { renderIntranetNavbar } from '../modules/nav.js?v=20260226d';
import { showMessage } from '../modules/notice.js?v=20260226d';

function text(value) {
  return String(value || '').trim();
}

function setStatus(node, status) {
  if (!node) return;
  const normalized = text(status).toUpperCase();
  node.textContent = normalized || 'PENDING';
  node.className = `badge badge-status ${normalized === 'ACTIVE' ? 'is-active' : normalized === 'PENDING' ? 'is-inactive' : 'is-suspended'}`;
}

async function init() {
  const feedback = document.querySelector('#onboardingFeedback');
  const shell = document.querySelector('#onboardingShell');
  const form = document.querySelector('#onboardingForm');
  const waitPanel = document.querySelector('#onboardingWaitPanel');
  const discordName = document.querySelector('#onboardingDiscordName');
  const discordId = document.querySelector('#onboardingDiscordId');
  const statusPill = document.querySelector('#onboardingStatusPill');

  try {
    const session = await getSession();
    if (!session.loggedIn) {
      window.location.href = '/login?auth=denied&reason=login_required';
      return;
    }
    renderIntranetNavbar(session);

    const me = await getOnboardingMe();
    const activationStatus = text(me.activationStatus).toUpperCase() || 'PENDING';
    setStatus(statusPill, activationStatus);
    if (discordName) discordName.textContent = text(me?.employee?.discordDisplayName) || 'Unknown';
    if (discordId) discordId.textContent = text(me?.employee?.discordUserId) || 'Unknown';

    if (activationStatus === 'ACTIVE') {
      window.location.href = '/dashboard';
      return;
    }

    if (activationStatus === 'REJECTED' || activationStatus === 'DISABLED') {
      window.location.href = '/not-permitted';
      return;
    }

    const hasProfile = Boolean(text(me?.employee?.robloxUserId) && text(me?.employee?.robloxUsername));
    if (hasProfile) {
      form?.classList.add('hidden');
      waitPanel?.classList.remove('hidden');
    } else {
      form?.classList.remove('hidden');
      waitPanel?.classList.add('hidden');
      const userIdInput = form?.querySelector('[name="robloxUserId"]');
      const usernameInput = form?.querySelector('[name="robloxUsername"]');
      if (userIdInput) userIdInput.value = text(me?.employee?.robloxUserId);
      if (usernameInput) usernameInput.value = text(me?.employee?.robloxUsername);
    }

    shell?.classList.remove('hidden');
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load onboarding.', 'error');
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const fd = new FormData(form);
    const robloxUserId = text(fd.get('robloxUserId'));
    const robloxUsername = text(fd.get('robloxUsername'));
    try {
      await submitOnboardingRobloxProfile({ robloxUserId, robloxUsername });
      showMessage(feedback, 'Submitted. Waiting for activation by staff.', 'success');
      form.classList.add('hidden');
      waitPanel?.classList.remove('hidden');
      setStatus(statusPill, 'PENDING');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to submit onboarding profile.', 'error');
    }
  });
}

init();
