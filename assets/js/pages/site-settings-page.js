import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260304b';
import {
  createConfigValue,
  deleteConfigValue,
  getConfig,
  getConfigSettings,
  getSiteSettings,
  saveSiteSettings,
  setConfigSetting,
  updateConfigValue
} from '../modules/admin-api.js';
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
  setValue('#settingsNotificationSoundStandardUrl', settings.notificationSoundStandardUrl);
  setValue('#settingsNotificationSoundUrgentUrl', settings.notificationSoundUrgentUrl);
  setValue('#settingsRequiredDiscordRoleIds', settings.requiredDiscordRoleIds);
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
    ogImageUrl: readValue('#settingsOgImageUrl'),
    notificationSoundStandardUrl: readValue('#settingsNotificationSoundStandardUrl'),
    notificationSoundUrgentUrl: readValue('#settingsNotificationSoundUrgentUrl'),
    requiredDiscordRoleIds: readValue('#settingsRequiredDiscordRoleIds')
  };
}

function updatePreview(settings) {
  const title = document.querySelector('#previewTitle');
  const description = document.querySelector('#previewDescription');
  const image = document.querySelector('#previewImage');
  const headerLogo = document.querySelector('#previewHeaderLogo');
  const favicon = document.querySelector('#previewFavicon');
  const theme = document.querySelector('#previewTheme');
  const soundStandard = document.querySelector('#previewSoundStandard');
  const soundUrgent = document.querySelector('#previewSoundUrgent');
  if (title) title.textContent = settings.ogTitle || '-';
  if (description) description.textContent = settings.ogDescription || '-';
  if (image) image.textContent = settings.ogImageUrl || '-';
  if (headerLogo) headerLogo.textContent = settings.headerLogoUrl || '(default FOG badge)';
  if (favicon) favicon.textContent = settings.faviconUrl || '-';
  if (theme) theme.textContent = settings.themeColor || '-';
  if (soundStandard) soundStandard.textContent = settings.notificationSoundStandardUrl || '-';
  if (soundUrgent) soundUrgent.textContent = settings.notificationSoundUrgentUrl || '-';
}


function wireAudioUpload(uploadSelector, targetSelector) {
  const uploadInput = document.querySelector(uploadSelector);
  const targetInput = document.querySelector(targetSelector);
  if (!uploadInput || !targetInput) return;
  uploadInput.addEventListener('change', () => {
    const file = uploadInput.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      targetInput.value = String(reader.result || '');
      targetInput.dispatchEvent(new Event('input', { bubbles: true }));
    };
    reader.readAsDataURL(file);
  });
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
  const disciplinaryPanel = document.querySelector('#disciplinaryConfigPanel');
  const disciplinaryFeedback = document.querySelector('#disciplinaryConfigFeedback');
  const suspendedRankForm = document.querySelector('#suspendedRankForm');
  const suspendedRankValue = document.querySelector('#suspendedRankValue');
  const saveSuspendedRankBtn = document.querySelector('#saveSuspendedRankBtn');
  const disciplinaryTypeForm = document.querySelector('#disciplinaryTypeForm');
  const disciplinaryTypeAddBtn = document.querySelector('#disciplinaryTypeAddBtn');
  const disciplinaryTypesTableBody = document.querySelector('#disciplinaryTypesTableBody');
  preview?.classList.remove('hidden');
  gradePanel?.classList.remove('hidden');
  disciplinaryPanel?.classList.remove('hidden');

  let lastLoaded = null;
  let gradeItems = [];
  let rankItems = [];
  let disciplinaryTypeItems = [];
  let suspendedRankSetting = 'Suspended';

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

  const renderSuspendedRankOptions = () => {
    if (!suspendedRankValue) return;
    suspendedRankValue.innerHTML = rankItems
      .map((row) => `<option value="${escapeHtml(String(row.value || '').trim())}">${escapeHtml(String(row.value || '').trim())}</option>`)
      .join('');
    if (suspendedRankSetting) suspendedRankValue.value = suspendedRankSetting;
  };

  const renderDisciplinaryTypes = () => {
    if (!disciplinaryTypesTableBody) return;
    if (!disciplinaryTypeItems.length) {
      disciplinaryTypesTableBody.innerHTML = '<tr><td colspan="4">No disciplinary types configured.</td></tr>';
      return;
    }
    disciplinaryTypesTableBody.innerHTML = disciplinaryTypeItems
      .map((row) => {
        const key = String(row.key || '').trim();
        const label = String(row.label || row.value || key || '').trim();
        const behavior = [
          Number(row.apply_suspension_rank || 0) ? 'Suspends rank' : null,
          Number(row.requires_end_date || 0) ? 'End date required' : null,
          row.set_employee_status ? `Status: ${row.set_employee_status}` : null
        ]
          .filter(Boolean)
          .join(' • ');
        return `<tr data-discipline-id="${Number(row.id)}">
          <td><strong>${escapeHtml(label)}</strong><br><small>${escapeHtml(key)}</small></td>
          <td>${escapeHtml(behavior || 'No automatic effects')}</td>
          <td>${Number(row.is_active || 0) ? 'Active' : 'Inactive'}</td>
          <td class="align-right">
            <button class="btn btn-secondary btn-compact" type="button" data-discipline-edit="${Number(row.id)}">Edit</button>
            <button class="btn btn-danger btn-compact" type="button" data-discipline-delete="${Number(row.id)}">Delete</button>
          </td>
        </tr>`;
      })
      .join('');
  };

  const loadDisciplinaryConfig = async () => {
    const [ranksPayload, typesPayload, settingsPayload] = await Promise.all([
      getConfig('ranks'),
      getConfig('disciplinary_types'),
      getConfigSettings('SUSPENDED_RANK_VALUE')
    ]);
    rankItems = Array.isArray(ranksPayload?.items) ? ranksPayload.items : [];
    disciplinaryTypeItems = Array.isArray(typesPayload?.items) ? typesPayload.items : [];
    suspendedRankSetting = String(settingsPayload?.item?.value || 'Suspended').trim() || 'Suspended';
    renderSuspendedRankOptions();
    renderDisciplinaryTypes();
  };

  try {
    wireAudioUpload('#settingsNotificationSoundStandardUpload', '#settingsNotificationSoundStandardUrl');
    wireAudioUpload('#settingsNotificationSoundUrgentUpload', '#settingsNotificationSoundUrgentUrl');
    lastLoaded = await loadSettings(feedback);
    await loadGrades();
    await loadDisciplinaryConfig();
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

  suspendedRankForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const nextRank = String(suspendedRankValue?.value || '').trim();
    if (!nextRank) {
      showMessage(disciplinaryFeedback, 'Choose a suspended rank.', 'error');
      return;
    }
    void (async () => {
      try {
        if (saveSuspendedRankBtn) {
          saveSuspendedRankBtn.disabled = true;
          saveSuspendedRankBtn.textContent = 'Saving...';
        }
        await setConfigSetting('SUSPENDED_RANK_VALUE', nextRank);
        suspendedRankSetting = nextRank;
        showMessage(disciplinaryFeedback, 'Suspended rank setting saved.', 'success');
      } catch (error) {
        showMessage(disciplinaryFeedback, error.message || 'Unable to save suspended rank setting.', 'error');
      } finally {
        if (saveSuspendedRankBtn) {
          saveSuspendedRankBtn.disabled = false;
          saveSuspendedRankBtn.textContent = 'Save Suspended Rank';
        }
      }
    })();
  });

  disciplinaryTypeForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const fd = new FormData(disciplinaryTypeForm);
    const payload = {
      key: String(fd.get('key') || '').trim().toUpperCase(),
      label: String(fd.get('label') || '').trim(),
      value: String(fd.get('label') || '').trim(),
      severity: Number(fd.get('severity') || 1),
      default_status: String(fd.get('default_status') || 'ACTIVE').trim().toUpperCase(),
      default_duration_days: String(fd.get('default_duration_days') || '').trim(),
      is_active: fd.get('is_active') ? 1 : 0,
      requires_end_date: fd.get('requires_end_date') ? 1 : 0,
      apply_suspension_rank: fd.get('apply_suspension_rank') ? 1 : 0,
      set_employee_status: String(fd.get('set_employee_status') || '').trim()
    };
    if (!payload.key || !payload.label) {
      showMessage(disciplinaryFeedback, 'Type key and label are required.', 'error');
      return;
    }
    void (async () => {
      try {
        if (disciplinaryTypeAddBtn) {
          disciplinaryTypeAddBtn.disabled = true;
          disciplinaryTypeAddBtn.textContent = 'Adding...';
        }
        await createConfigValue('disciplinary_types', payload);
        disciplinaryTypeForm.reset();
        await loadDisciplinaryConfig();
        showMessage(disciplinaryFeedback, 'Disciplinary type added.', 'success');
      } catch (error) {
        showMessage(disciplinaryFeedback, error.message || 'Unable to add disciplinary type.', 'error');
      } finally {
        if (disciplinaryTypeAddBtn) {
          disciplinaryTypeAddBtn.disabled = false;
          disciplinaryTypeAddBtn.textContent = 'Add Type';
        }
      }
    })();
  });

  disciplinaryTypesTableBody?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const editBtn = target.closest('[data-discipline-edit]');
    if (editBtn) {
      const id = Number(editBtn.getAttribute('data-discipline-edit'));
      const current = disciplinaryTypeItems.find((row) => Number(row.id) === id);
      if (!current) return;
      const nextLabel = window.prompt('Type label', String(current.label || current.value || '').trim());
      if (nextLabel === null) return;
      const nextKeyInput = window.prompt('Type key', String(current.key || '').trim());
      if (nextKeyInput === null) return;
      const nextSeverityInput = window.prompt('Severity (number)', String(current.severity || 1));
      if (nextSeverityInput === null) return;
      const payload = {
        key: String(nextKeyInput || '').trim().toUpperCase(),
        label: String(nextLabel || '').trim(),
        value: String(nextLabel || '').trim(),
        severity: Number(nextSeverityInput || 1),
        default_status: String(current.default_status || 'ACTIVE').trim().toUpperCase(),
        default_duration_days: current.default_duration_days ?? '',
        is_active: Number(current.is_active || 0) ? 1 : 0,
        requires_end_date: Number(current.requires_end_date || 0) ? 1 : 0,
        apply_suspension_rank: Number(current.apply_suspension_rank || 0) ? 1 : 0,
        set_employee_status: String(current.set_employee_status || '').trim()
      };
      if (!payload.key || !payload.label) {
        showMessage(disciplinaryFeedback, 'Type key and label are required.', 'error');
        return;
      }
      void (async () => {
        try {
          await updateConfigValue('disciplinary_types', id, payload);
          await loadDisciplinaryConfig();
          showMessage(disciplinaryFeedback, 'Disciplinary type updated.', 'success');
        } catch (error) {
          showMessage(disciplinaryFeedback, error.message || 'Unable to update disciplinary type.', 'error');
        }
      })();
      return;
    }

    const deleteBtn = target.closest('[data-discipline-delete]');
    if (!deleteBtn) return;
    const id = Number(deleteBtn.getAttribute('data-discipline-delete'));
    if (!Number.isInteger(id) || id <= 0) return;
    if (!window.confirm('Delete this disciplinary type?')) return;
    void (async () => {
      try {
        await deleteConfigValue('disciplinary_types', id);
        await loadDisciplinaryConfig();
        showMessage(disciplinaryFeedback, 'Disciplinary type deleted.', 'success');
      } catch (error) {
        showMessage(disciplinaryFeedback, error.message || 'Unable to delete disciplinary type.', 'error');
      }
    })();
  });
});
