import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260222b';
import { createConfigValue, deleteConfigValue, getConfig, getSiteSettings, saveSiteSettings, updateConfigValue } from '../modules/admin-api.js';
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

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'N/A';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const yyyy = date.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
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
  const gradePanel = document.querySelector('#gradePresetsPanel');
  const gradeFeedback = document.querySelector('#gradePresetsFeedback');
  const gradeForm = document.querySelector('#gradePresetForm');
  const gradeAddBtn = document.querySelector('#gradePresetAddBtn');
  const gradeTableBody = document.querySelector('#gradePresetsTableBody');
  preview?.classList.remove('hidden');
  gradePanel?.classList.remove('hidden');

  let lastLoaded = null;
  let gradeItems = [];

  const renderGrades = () => {
    if (!gradeTableBody) return;
    if (!gradeItems.length) {
      gradeTableBody.innerHTML = '<tr><td colspan="3">No grade presets configured.</td></tr>';
      return;
    }
    gradeTableBody.innerHTML = gradeItems
      .map(
        (item) => `
          <tr data-grade-id="${Number(item.id)}">
            <td>${escapeHtml(String(item.value || '').trim())}</td>
            <td>${escapeHtml(formatDate(item.created_at))}</td>
            <td class="align-right">
              <button class="btn btn-secondary btn-compact" type="button" data-grade-edit="${Number(item.id)}">Edit</button>
              <button class="btn btn-danger btn-compact" type="button" data-grade-delete="${Number(item.id)}">Delete</button>
            </td>
          </tr>
        `
      )
      .join('');
  };

  const loadGrades = async () => {
    const payload = await getConfig('grades');
    gradeItems = Array.isArray(payload?.items) ? payload.items : [];
    renderGrades();
  };

  try {
    lastLoaded = await loadSettings(feedback);
    await loadGrades();
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

  gradeForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!gradeAddBtn) return;
    const valueNode = gradeForm.querySelector('[name="value"]');
    const value = String(valueNode?.value || '').trim();
    if (!value) {
      showMessage(gradeFeedback, 'Grade value is required.', 'error');
      return;
    }
    gradeAddBtn.disabled = true;
    gradeAddBtn.textContent = 'Adding...';
    try {
      await createConfigValue('grades', value);
      gradeForm.reset();
      await loadGrades();
      showMessage(gradeFeedback, 'Grade preset added.', 'success');
    } catch (error) {
      showMessage(gradeFeedback, error.message || 'Unable to add grade preset.', 'error');
    } finally {
      gradeAddBtn.disabled = false;
      gradeAddBtn.textContent = 'Add Grade';
    }
  });

  gradeTableBody?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const editBtn = target.closest('[data-grade-edit]');
    if (editBtn) {
      const id = Number(editBtn.getAttribute('data-grade-edit'));
      if (!Number.isInteger(id) || id <= 0) return;
      const current = gradeItems.find((item) => Number(item.id) === id);
      const next = window.prompt('Update grade value', String(current?.value || '').trim());
      if (next === null) return;
      const value = String(next).trim();
      if (!value) {
        showMessage(gradeFeedback, 'Grade value is required.', 'error');
        return;
      }
      void (async () => {
        try {
          await updateConfigValue('grades', id, value);
          await loadGrades();
          showMessage(gradeFeedback, 'Grade preset updated.', 'success');
        } catch (error) {
          showMessage(gradeFeedback, error.message || 'Unable to update grade preset.', 'error');
        }
      })();
      return;
    }

    const deleteBtn = target.closest('[data-grade-delete]');
    if (!deleteBtn) return;
    const id = Number(deleteBtn.getAttribute('data-grade-delete'));
    if (!Number.isInteger(id) || id <= 0) return;
    if (!window.confirm('Delete this grade preset?')) return;
    void (async () => {
      try {
        await deleteConfigValue('grades', id);
        await loadGrades();
        showMessage(gradeFeedback, 'Grade preset deleted.', 'success');
      } catch (error) {
        showMessage(gradeFeedback, error.message || 'Unable to delete grade preset.', 'error');
      }
    })();
  });
});
