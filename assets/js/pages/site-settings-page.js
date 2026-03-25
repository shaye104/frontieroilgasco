import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260304b';
import { getSiteSettings, saveSiteSettings } from '../modules/admin-api.js';
import { showMessage } from '../modules/notice.js';

function setValue(selector, value) {
  const node = document.querySelector(selector);
  if (!node) return;
  node.value = String(value ?? '');
}

function readValue(selector) {
  const node = document.querySelector(selector);
  return String(node?.value ?? '').trim();
}

function applyForm(settings) {
  setValue('#settingsRequiredRobloxGroupIds', settings.requiredRobloxGroupIds);
}

function collectForm() {
  return {
    requiredRobloxGroupIds: readValue('#settingsRequiredRobloxGroupIds')
  };
}

async function loadSettings(feedback) {
  const payload = await getSiteSettings();
  const settings = payload?.settings || {};
  applyForm(settings);
  document.querySelector('#siteSettingsContent')?.classList.remove('hidden');
  if (feedback) feedback.innerHTML = '';
  return settings;
}

initIntranetPageGuard({
  feedbackSelector: '#siteSettingsFeedback',
  protectedContentSelector: '#siteSettingsContent',
  requiredPermissions: ['config.manage']
}).then(async (session) => {
  if (!session) return;

  const feedback = document.querySelector('#siteSettingsFeedback');
  const form = document.querySelector('#siteSettingsForm');
  const resetBtn = document.querySelector('#siteSettingsResetBtn');
  const saveBtn = document.querySelector('#siteSettingsSaveBtn');

  let lastLoaded = null;

  try {
    lastLoaded = await loadSettings(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load site settings.', 'error');
    return;
  }

  resetBtn?.addEventListener('click', () => {
    if (!lastLoaded) return;
    applyForm(lastLoaded);
    showMessage(feedback, 'Form reset.', 'info');
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!saveBtn) return;
    saveBtn.disabled = true;
    showMessage(feedback, 'Saving settings...', 'info');
    try {
      const payload = collectForm();
      const response = await saveSiteSettings(payload);
      lastLoaded = response?.settings || payload;
      applyForm(lastLoaded);
      showMessage(feedback, 'Roblox group scan settings saved.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to save site settings.', 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });
});
