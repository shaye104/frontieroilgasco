import { getMeBootstrap, resolveRobloxIdentity, submitOnboarding } from '../modules/admin-api.js?v=20260227a';
import { renderPublicNavbar } from '../modules/nav.js?v=20260227a';
import { clearMessage, showMessage } from '../modules/notice.js?v=20260227a';

function text(value) {
  return String(value || '').trim();
}

function setStatusPill(node, status) {
  if (!node) return;
  const normalized = text(status).toUpperCase();
  node.textContent = normalized || 'PENDING';
  node.className = `badge badge-status ${
    normalized === 'ACTIVE' ? 'is-active' : normalized === 'REJECTED' || normalized === 'DISABLED' ? 'is-suspended' : 'is-inactive'
  }`;
}

function setChecklistItem(node, isDone) {
  if (!node) return;
  node.classList.toggle('is-done', Boolean(isDone));
}

function setButtonBusy(button, isBusy, busyText, idleText) {
  if (!button) return;
  button.disabled = Boolean(isBusy);
  button.textContent = isBusy ? busyText : idleText;
}

const verifyCache = new Map();
let verifyDebounceTimer = null;

function verifyKey(userId, username) {
  return `${text(userId)}|${text(username).toLowerCase()}`;
}

function applyBootstrapToUi(bootstrap) {
  const discordName = document.querySelector('#onboardingDiscordName');
  const discordId = document.querySelector('#onboardingDiscordId');
  const statusPill = document.querySelector('#onboardingStatusPill');
  const statusText = document.querySelector('#onboardingStatusText');
  const robloxUserIdInput = document.querySelector('#onboardingRobloxUserId');
  const robloxUsernameInput = document.querySelector('#onboardingRobloxUsername');
  const submitBtn = document.querySelector('#submitOnboardingBtn');

  const employeeStatus = text(bootstrap?.employee?.status || 'PENDING').toUpperCase();
  const activationStatus = text(bootstrap?.employee?.activationStatus || 'PENDING').toUpperCase();
  const canEdit = Boolean(bootstrap?.uiFlags?.canEditRobloxDetails);

  if (discordName) discordName.textContent = text(bootstrap?.discord?.displayName) || 'Unknown';
  if (discordId) discordId.textContent = text(bootstrap?.discord?.userId) || 'Unknown';
  setStatusPill(statusPill, employeeStatus);

  if (statusText) {
    if (activationStatus === 'ACTIVE') {
      statusText.textContent = 'Your account is active.';
    } else if (employeeStatus === 'SUBMITTED') {
      statusText.textContent = 'Submitted for review. Waiting for manager activation.';
    } else {
      statusText.textContent = 'Complete your Roblox details and submit for manager review.';
    }
  }

  if (robloxUserIdInput) robloxUserIdInput.value = text(bootstrap?.employee?.robloxUserId);
  if (robloxUsernameInput) robloxUsernameInput.value = text(bootstrap?.employee?.robloxUsername);

  if (robloxUserIdInput) robloxUserIdInput.disabled = !canEdit;
  if (robloxUsernameInput) robloxUsernameInput.disabled = !canEdit;
  if (submitBtn) submitBtn.disabled = !canEdit;

  setChecklistItem(document.querySelector('#checkDiscordRole'), Boolean(bootstrap?.qualifies));
  setChecklistItem(
    document.querySelector('#checkRobloxProfile'),
    Boolean(text(bootstrap?.employee?.robloxUserId) && text(bootstrap?.employee?.robloxUsername))
  );
  setChecklistItem(document.querySelector('#checkSubmitted'), employeeStatus === 'SUBMITTED');
}

async function runRobloxVerify({ showSpinner = true } = {}) {
  const feedback = document.querySelector('#onboardingFeedback');
  const userId = text(document.querySelector('#onboardingRobloxUserId')?.value);
  const username = text(document.querySelector('#onboardingRobloxUsername')?.value);
  const verifyButton = document.querySelector('#verifyRobloxBtn');
  const verifyResult = document.querySelector('#verifyRobloxResult');

  if (!userId || !username) {
    if (verifyResult) verifyResult.textContent = 'Enter both Roblox fields first.';
    return { verified: false };
  }

  const cacheId = verifyKey(userId, username);
  const cached = verifyCache.get(cacheId);
  if (cached) {
    if (verifyResult) {
      verifyResult.textContent = cached.verified
        ? `Verified: ${text(cached.normalized?.username || username)} (${text(cached.normalized?.userId || userId)})`
        : 'Verification failed. ID/username mismatch.';
    }
    return cached;
  }

  if (showSpinner) setButtonBusy(verifyButton, true, 'Verifying...', 'Verify Roblox Account');
  try {
    const result = await resolveRobloxIdentity({ userId, username });
    verifyCache.set(cacheId, result);
    if (verifyResult) {
      verifyResult.textContent = result.verified
        ? `Verified: ${text(result.normalized?.username || username)} (${text(result.normalized?.userId || userId)})`
        : 'Verification failed. ID/username mismatch.';
    }
    return result;
  } catch (error) {
    showMessage(feedback, error.message || 'Roblox verification failed.', 'error');
    if (verifyResult) verifyResult.textContent = 'Verification failed.';
    return { verified: false };
  } finally {
    if (showSpinner) setButtonBusy(verifyButton, false, 'Verifying...', 'Verify Roblox Account');
  }
}

async function init() {
  const feedback = document.querySelector('#onboardingFeedback');
  const form = document.querySelector('#onboardingForm');
  const verifyButton = document.querySelector('#verifyRobloxBtn');
  const submitButton = document.querySelector('#submitOnboardingBtn');
  const userIdInput = document.querySelector('#onboardingRobloxUserId');
  const usernameInput = document.querySelector('#onboardingRobloxUsername');

  renderPublicNavbar();
  clearMessage(feedback);

  let bootstrap;
  try {
    const started = performance.now();
    bootstrap = await getMeBootstrap();
    const duration = Math.round(performance.now() - started);
    if (window?.location?.hostname === 'localhost' || window?.location?.search?.includes('debug=1')) {
      console.info('[perf] /api/me/bootstrap', { durationMs: duration });
    }
  } catch (error) {
    const message = text(error.message);
    if (message.includes('401')) {
      window.location.href = '/login?auth=denied&reason=login_required';
      return;
    }
    showMessage(feedback, 'Unable to load onboarding.', 'error');
    return;
  }

  if (!bootstrap?.qualifies) {
    window.location.href = '/not-permitted';
    return;
  }

  const activationStatus = text(bootstrap?.employee?.activationStatus || '').toUpperCase();
  if (activationStatus === 'ACTIVE') {
    window.location.href = '/dashboard';
    return;
  }
  if (activationStatus === 'REJECTED' || activationStatus === 'DISABLED') {
    window.location.href = '/not-permitted';
    return;
  }

  applyBootstrapToUi(bootstrap);

  verifyButton?.addEventListener('click', async () => {
    await runRobloxVerify({ showSpinner: true });
  });

  [userIdInput, usernameInput].forEach((input) => {
    input?.addEventListener('input', () => {
      const verifyResult = document.querySelector('#verifyRobloxResult');
      if (verifyResult) verifyResult.textContent = '';
      if (verifyDebounceTimer) clearTimeout(verifyDebounceTimer);
      verifyDebounceTimer = setTimeout(() => {
        void runRobloxVerify({ showSpinner: false });
      }, 450);
    });
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);

    const robloxUserId = text(userIdInput?.value);
    const robloxUsername = text(usernameInput?.value);
    if (!robloxUserId || !robloxUsername) {
      showMessage(feedback, 'Roblox User ID and Username are required.', 'error');
      return;
    }

    const verifyResult = await runRobloxVerify({ showSpinner: true });
    if (!verifyResult?.verified) {
      showMessage(feedback, 'Please verify your Roblox account before submitting.', 'error');
      return;
    }

    // Optimistic UI update.
    const previous = {
      status: document.querySelector('#onboardingStatusPill')?.textContent || 'PENDING',
      statusText: document.querySelector('#onboardingStatusText')?.textContent || '',
      checkSubmitted: document.querySelector('#checkSubmitted')?.classList.contains('is-done') || false
    };
    setStatusPill(document.querySelector('#onboardingStatusPill'), 'SUBMITTED');
    const statusText = document.querySelector('#onboardingStatusText');
    if (statusText) statusText.textContent = 'Submitted for review. Waiting for manager activation.';
    setChecklistItem(document.querySelector('#checkSubmitted'), true);
    setButtonBusy(submitButton, true, 'Submitting...', 'Submit for Review');

    try {
      const started = performance.now();
      const result = await submitOnboarding({ robloxUserId, robloxUsername });
      const duration = Math.round(performance.now() - started);
      if (window?.location?.hostname === 'localhost' || window?.location?.search?.includes('debug=1')) {
        console.info('[perf] /api/onboarding/submit', { durationMs: duration });
      }
      applyBootstrapToUi({
        ...bootstrap,
        employee: {
          ...(bootstrap?.employee || {}),
          ...(result?.employee || {}),
          robloxUserId,
          robloxUsername
        }
      });
      showMessage(feedback, 'Submitted for review.', 'success');
    } catch (error) {
      // Revert optimistic state on failure.
      setStatusPill(document.querySelector('#onboardingStatusPill'), previous.status);
      if (statusText) statusText.textContent = previous.statusText;
      setChecklistItem(document.querySelector('#checkSubmitted'), previous.checkSubmitted);
      showMessage(feedback, error.message || 'Unable to submit onboarding profile.', 'error');
    } finally {
      setButtonBusy(submitButton, false, 'Submitting...', 'Submit for Review');
    }
  });
}

init();

