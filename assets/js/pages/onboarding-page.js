import { getOnboardingBootstrap, submitOnboarding, verifyOnboardingRoblox } from '../modules/admin-api.js?v=20260227f';
import { performLogout } from '../modules/nav.js?v=20260227a';
import { clearMessage, showMessage } from '../modules/notice.js?v=20260227a';

function text(value) {
  return String(value || '').trim();
}

function setStatusPill(node, status) {
  if (!node) return;
  const normalized = text(status).toUpperCase();
  node.textContent = normalized || 'PENDING_PROFILE';
  node.className = `badge badge-status ${
    normalized === 'ACTIVE' ? 'is-active' : normalized === 'REJECTED' || normalized === 'DISABLED' ? 'is-suspended' : 'is-inactive'
  }`;
}

function setChecklistItem(node, isDone) {
  if (!node) return;
  const rawLabel = text(node.getAttribute('data-label') || node.textContent).replace(/^Complete:\s|^Pending:\s/, '');
  node.setAttribute('data-label', rawLabel);
  node.classList.toggle('is-done', Boolean(isDone));
  node.textContent = `${isDone ? 'Complete' : 'Pending'}: ${rawLabel}`;
}

function setButtonBusy(button, isBusy, busyText, idleText) {
  if (!button) return;
  button.disabled = Boolean(isBusy);
  button.textContent = isBusy ? busyText : idleText;
}

const verifyCache = new Map();
let bootstrapPayload = null;
let verifyState = 'UNVERIFIED';
let submitState = 'READY';

function updateSubmitEnabled() {
  const submitButton = document.querySelector('#submitOnboardingBtn');
  if (!submitButton) return;
  const canSubmit = verifyState === 'VERIFIED' && submitState !== 'SUBMITTING' && bootstrapPayload?.uiFlags?.canSubmit;
  submitButton.disabled = !canSubmit;
}

function setVerifyState(nextState, message = '') {
  verifyState = nextState;
  const verifyButton = document.querySelector('#verifyRobloxBtn');
  const verifyResult = document.querySelector('#verifyRobloxResult');
  if (verifyResult) {
    verifyResult.textContent = message;
    verifyResult.classList.toggle('is-success', nextState === 'VERIFIED');
    verifyResult.classList.toggle('is-error', nextState === 'FAILED');
  }
  if (verifyButton) {
    if (nextState === 'VERIFYING') setButtonBusy(verifyButton, true, 'Verifying...', 'Verify Roblox Account');
    else setButtonBusy(verifyButton, false, 'Verifying...', 'Verify Roblox Account');
  }
  updateSubmitEnabled();
}

function setSubmitState(nextState) {
  submitState = nextState;
  const submitButton = document.querySelector('#submitOnboardingBtn');
  if (!submitButton) return;
  if (nextState === 'SUBMITTING') setButtonBusy(submitButton, true, 'Submitting...', 'Submit for Review');
  else setButtonBusy(submitButton, false, 'Submitting...', 'Submit for Review');
  updateSubmitEnabled();
}

function renderAuthAction(loggedIn) {
  const action = document.querySelector('#onboardingAuthAction');
  if (!action) return;
  if (loggedIn) {
    action.textContent = 'Logout';
    action.href = '#';
    action.classList.remove('btn-primary');
    action.classList.add('btn-secondary');
    action.addEventListener('click', (event) => {
      event.preventDefault();
      void performLogout('/login');
    });
  } else {
    action.textContent = 'Login';
    action.href = '/login';
    action.classList.remove('btn-secondary');
    action.classList.add('btn-primary');
  }
}

function renderNotPermitted() {
  document.querySelector('#onboardingMainGrid')?.classList.add('hidden');
  document.querySelector('#onboardingNotPermitted')?.classList.remove('hidden');
  const switchBtn = document.querySelector('#onboardingSwitchAccountBtn');
  switchBtn?.addEventListener('click', () => {
    void performLogout('/login');
  });
}

function renderMain(bootstrap) {
  document.querySelector('#onboardingNotPermitted')?.classList.add('hidden');
  document.querySelector('#onboardingMainGrid')?.classList.remove('hidden');

  const state = text(bootstrap?.employee?.state || 'PENDING_PROFILE').toUpperCase();
  const activationStatus = text(bootstrap?.employee?.activationStatus || 'PENDING').toUpperCase();
  const canEdit = Boolean(bootstrap?.uiFlags?.canEditRobloxDetails);

  const discordName = document.querySelector('#onboardingDiscordName');
  const discordId = document.querySelector('#onboardingDiscordId');
  const discordRoleCount = document.querySelector('#onboardingDiscordRoleCount');
  const statusPill = document.querySelector('#onboardingStatusPill');
  const statusText = document.querySelector('#onboardingStatusText');
  const robloxUserIdInput = document.querySelector('#onboardingRobloxUserId');
  const robloxUsernameInput = document.querySelector('#onboardingRobloxUsername');

  if (discordName) discordName.textContent = text(bootstrap?.discord?.displayName) || 'Unknown';
  if (discordName) discordName.classList.remove('skeleton-line');
  if (discordId) discordId.textContent = text(bootstrap?.discord?.userId) || 'Unknown';
  if (discordId) discordId.classList.remove('skeleton-line');
  if (discordRoleCount) discordRoleCount.textContent = String(Number(bootstrap?.discord?.roleCount || 0));
  setStatusPill(statusPill, state);

  if (statusText) {
    if (activationStatus === 'ACTIVE') statusText.textContent = 'Your account is active.';
    else if (state === 'PENDING_REVIEW') statusText.textContent = 'Submitted for manager review. Awaiting activation.';
    else statusText.textContent = 'Verify your Roblox details before submitting for manager review.';
  }

  if (robloxUserIdInput) {
    robloxUserIdInput.value = text(bootstrap?.employee?.robloxUserId);
    robloxUserIdInput.disabled = !canEdit;
  }
  if (robloxUsernameInput) {
    robloxUsernameInput.value = text(bootstrap?.employee?.robloxUsername);
    robloxUsernameInput.disabled = !canEdit;
  }

  setChecklistItem(document.querySelector('#checkDiscordRole'), Boolean(bootstrap?.steps?.discordRoleDetected));
  setChecklistItem(document.querySelector('#checkRobloxProfile'), Boolean(bootstrap?.steps?.robloxVerifiedOrPresent));
  setChecklistItem(document.querySelector('#checkSubmitted'), Boolean(bootstrap?.steps?.submittedForReview));
  setChecklistItem(document.querySelector('#checkActivated'), Boolean(bootstrap?.steps?.activated));

  if (state === 'PENDING_REVIEW' || state === 'ACTIVE') {
    setVerifyState('VERIFIED', 'Roblox details on file.');
  } else {
    setVerifyState('UNVERIFIED', 'Verify before submitting.');
  }
  updateSubmitEnabled();
}

async function verifyRoblox() {
  const feedback = document.querySelector('#onboardingFeedback');
  const userId = text(document.querySelector('#onboardingRobloxUserId')?.value).replace(/\D+/g, '');
  const username = text(document.querySelector('#onboardingRobloxUsername')?.value);

  if (!userId || !username) {
    setVerifyState('FAILED', 'Enter both Roblox fields first.');
    return { verified: false };
  }

  const key = `${userId}|${username.toLowerCase()}`;
  if (verifyCache.has(key)) {
    const cached = verifyCache.get(key);
    setVerifyState(cached.verified ? 'VERIFIED' : 'FAILED', cached.message);
    return cached;
  }

  setVerifyState('VERIFYING', 'Verifying...');
  try {
    const result = await verifyOnboardingRoblox({ robloxUserId: userId, robloxUsername: username });
    const message = text(result?.message) || (result?.verified ? 'Roblox account matched.' : 'Verification failed: username/id mismatch.');
    const payload = { ...result, message };
    verifyCache.set(key, payload);
    setVerifyState(result?.verified ? 'VERIFIED' : 'FAILED', message);
    return payload;
  } catch (error) {
    const message = error.message || 'Verification failed.';
    showMessage(feedback, message, 'error');
    setVerifyState('FAILED', message);
    return { verified: false, message };
  }
}

function bindInputValidation() {
  const userIdInput = document.querySelector('#onboardingRobloxUserId');
  const usernameInput = document.querySelector('#onboardingRobloxUsername');

  userIdInput?.addEventListener('input', () => {
    userIdInput.value = userIdInput.value.replace(/\D+/g, '');
    if (userIdInput.value.length > 0 && userIdInput.value.length < 3) {
      setVerifyState('FAILED', 'Roblox User ID looks too short.');
    } else {
      setVerifyState('UNVERIFIED', 'Verify before submitting.');
    }
  });

  usernameInput?.addEventListener('input', () => {
    setVerifyState('UNVERIFIED', 'Verify before submitting.');
  });
}

async function init() {
  const feedback = document.querySelector('#onboardingFeedback');
  clearMessage(feedback);

  renderAuthAction(false);
  let bootstrap;
  try {
    const started = performance.now();
    bootstrap = await getOnboardingBootstrap();
    const duration = Math.round(performance.now() - started);
    if (window?.location?.hostname === 'localhost' || window?.location?.search?.includes('debug=1')) {
      console.info('[perf] /api/onboarding/bootstrap', { durationMs: duration });
    }
  } catch (error) {
    const message = text(error.message);
    if (message.includes('401') || message.toLowerCase().includes('authentication required') || message.toLowerCase().includes('login')) {
      window.location.href = '/login?auth=denied&reason=login_required';
      return;
    }
    showMessage(feedback, message || 'Unable to load onboarding.', 'error');
    return;
  }

  bootstrapPayload = bootstrap;
  renderAuthAction(Boolean(bootstrap?.loggedIn));

  const activationStatus = text(bootstrap?.employee?.activationStatus).toUpperCase();
  if (activationStatus === 'ACTIVE') {
    window.location.href = '/dashboard';
    return;
  }
  if (activationStatus === 'REJECTED' || activationStatus === 'DISABLED') {
    renderNotPermitted();
    return;
  }
  if (!bootstrap?.qualifies) {
    renderNotPermitted();
    return;
  }

  renderMain(bootstrap);
  bindInputValidation();

  document.querySelector('#verifyRobloxBtn')?.addEventListener('click', async () => {
    await verifyRoblox();
  });

  document.querySelector('#onboardingForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);
    if (verifyState !== 'VERIFIED') {
      showMessage(feedback, 'Please verify your Roblox account before submitting.', 'error');
      return;
    }

    const userId = text(document.querySelector('#onboardingRobloxUserId')?.value).replace(/\D+/g, '');
    const username = text(document.querySelector('#onboardingRobloxUsername')?.value);
    if (!userId || !username) {
      showMessage(feedback, 'Roblox User ID and Username are required.', 'error');
      return;
    }

    const previousState = text(bootstrapPayload?.employee?.state || 'PENDING_PROFILE').toUpperCase();
    setSubmitState('SUBMITTING');
    setStatusPill(document.querySelector('#onboardingStatusPill'), 'PENDING_REVIEW');
    const statusText = document.querySelector('#onboardingStatusText');
    if (statusText) statusText.textContent = 'Submitted for manager review. Awaiting activation.';
    setChecklistItem(document.querySelector('#checkSubmitted'), true);

    try {
      await submitOnboarding({ robloxUserId: userId, robloxUsername: username });
      bootstrapPayload = {
        ...bootstrapPayload,
        employee: {
          ...(bootstrapPayload.employee || {}),
          state: 'PENDING_REVIEW',
          activationStatus: 'PENDING',
          robloxUserId: userId,
          robloxUsername: username
        },
        uiFlags: {
          ...(bootstrapPayload.uiFlags || {}),
          canEditRobloxDetails: false,
          canSubmit: false
        },
        steps: {
          ...(bootstrapPayload.steps || {}),
          robloxVerifiedOrPresent: true,
          submittedForReview: true
        }
      };
      renderMain(bootstrapPayload);
      showMessage(feedback, 'Submitted. Awaiting activation.', 'success');
    } catch (error) {
      setStatusPill(document.querySelector('#onboardingStatusPill'), previousState);
      if (statusText) statusText.textContent = previousState === 'PENDING_REVIEW'
        ? 'Submitted for manager review. Awaiting activation.'
        : 'Verify your Roblox details before submitting for manager review.';
      setChecklistItem(document.querySelector('#checkSubmitted'), previousState === 'PENDING_REVIEW');
      showMessage(feedback, error.message || 'Unable to submit onboarding profile.', 'error');
    } finally {
      setSubmitState('READY');
    }
  });
}

init();
