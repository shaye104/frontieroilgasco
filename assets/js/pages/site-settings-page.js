import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260222b';
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
  setValue('#settingsBrandName', settings.brandName);
  setValue('#settingsSiteTagline', settings.siteTagline);
  setValue('#settingsThemeColor', settings.themeColor);
  setValue('#settingsHeaderLogoUrl', settings.headerLogoUrl);
  setValue('#settingsTwitterCard', settings.twitterCard);
  setValue('#settingsFaviconUrl', settings.faviconUrl);
  setValue('#settingsAppleTouchIconUrl', settings.appleTouchIconUrl);
  setValue('#settingsOgTitle', settings.ogTitle);
  setValue('#settingsOgDescription', settings.ogDescription);
  setValue('#settingsOgImageUrl', settings.ogImageUrl);
}

function collectForm() {
  return {
    brandName: readValue('#settingsBrandName'),
    siteTagline: readValue('#settingsSiteTagline'),
    themeColor: readValue('#settingsThemeColor'),
    headerLogoUrl: readValue('#settingsHeaderLogoUrl'),
    twitterCard: readValue('#settingsTwitterCard'),
    faviconUrl: readValue('#settingsFaviconUrl'),
    appleTouchIconUrl: readValue('#settingsAppleTouchIconUrl'),
    ogTitle: readValue('#settingsOgTitle'),
    ogDescription: readValue('#settingsOgDescription'),
    ogImageUrl: readValue('#settingsOgImageUrl')
  };
}

function updatePreview(settings) {
  const title = document.querySelector('#previewTitle');
  const description = document.querySelector('#previewDescription');
  const image = document.querySelector('#previewImage');
  const headerLogo = document.querySelector('#previewHeaderLogo');
  const favicon = document.querySelector('#previewFavicon');
  const theme = document.querySelector('#previewTheme');
  if (title) title.textContent = settings.ogTitle || '-';
  if (description) description.textContent = settings.ogDescription || '-';
  if (image) image.textContent = settings.ogImageUrl || '-';
  if (headerLogo) headerLogo.textContent = settings.headerLogoUrl || '(default FOG badge)';
  if (favicon) favicon.textContent = settings.faviconUrl || '-';
  if (theme) theme.textContent = settings.themeColor || '-';
}

async function loadSettings(feedback) {
  const payload = await getSiteSettings();
  const settings = payload?.settings || {};
  applyForm(settings);
  updatePreview(settings);
  const content = document.querySelector('#siteSettingsContent');
  const preview = document.querySelector('#siteSettingsPreview');
  content?.classList.remove('hidden');
  preview?.classList.remove('hidden');
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
  const preview = document.querySelector('#siteSettingsPreview');
  preview?.classList.remove('hidden');

  let lastLoaded = null;
  try {
    lastLoaded = await loadSettings(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load site settings.', 'error');
    return;
  }

  form?.addEventListener('input', () => {
    updatePreview(collectForm());
  });

  resetBtn?.addEventListener('click', () => {
    if (!lastLoaded) return;
    applyForm(lastLoaded);
    updatePreview(lastLoaded);
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!saveBtn) return;
    const payload = collectForm();
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';
    try {
      const result = await saveSiteSettings(payload);
      lastLoaded = result?.settings || payload;
      applyForm(lastLoaded);
      updatePreview(lastLoaded);
      showMessage(feedback, 'Site settings saved.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to save site settings.', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Settings';
    }
  });
});
