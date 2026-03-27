import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260304b';
import { createConfigValue, deleteConfigValue, getEmployeeConfigBootstrap, getSiteSettings, saveSiteSettings, updateConfigValue } from '../modules/admin-api.js';
import { showMessage } from '../modules/notice.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function bindHoldToConfirm(button, onConfirm, holdMs = 1000) {
  if (!(button instanceof HTMLButtonElement) || typeof onConfirm !== 'function') return () => {};

  const duration = Math.max(300, Number(holdMs) || 1000);
  let holdFrame = null;
  let holdActive = false;
  let inFlight = false;
  let holdStartTs = 0;

  const setProgress = (value) => {
    button.style.setProperty('--hold-progress', `${Math.max(0, Math.min(100, Number(value) || 0))}%`);
  };

  const resetHold = () => {
    holdActive = false;
    holdStartTs = 0;
    if (holdFrame) {
      window.cancelAnimationFrame(holdFrame);
      holdFrame = null;
    }
    button.classList.remove('is-holding', 'is-armed');
    setProgress(0);
  };

  const tickHold = async (ts) => {
    if (!holdActive || button.disabled || inFlight) return;
    if (!holdStartTs) holdStartTs = ts;
    const elapsed = ts - holdStartTs;
    const ratio = Math.max(0, Math.min(1, elapsed / duration));
    setProgress(ratio * 100);

    if (ratio >= 1) {
      holdActive = false;
      button.classList.remove('is-holding');
      button.classList.add('is-armed');
      inFlight = true;
      try {
        await onConfirm();
      } finally {
        inFlight = false;
        window.setTimeout(() => resetHold(), 120);
      }
      return;
    }

    holdFrame = window.requestAnimationFrame(tickHold);
  };

  const startHold = (event) => {
    if (event.type === 'pointerdown' && 'button' in event && event.button !== 0) return;
    if (button.disabled || inFlight) return;
    event.preventDefault();
    resetHold();
    holdActive = true;
    holdStartTs = 0;
    button.classList.add('is-holding');
    setProgress(0);
    holdFrame = window.requestAnimationFrame(tickHold);
  };

  const cancelHold = () => {
    if (!holdActive) return;
    resetHold();
  };

  button.addEventListener('pointerdown', startHold);
  button.addEventListener('pointerup', cancelHold);
  button.addEventListener('pointerleave', cancelHold);
  button.addEventListener('pointercancel', cancelHold);
  button.addEventListener('dragstart', (event) => event.preventDefault());

  return () => {
    resetHold();
    button.removeEventListener('pointerdown', startHold);
    button.removeEventListener('pointerup', cancelHold);
    button.removeEventListener('pointerleave', cancelHold);
    button.removeEventListener('pointercancel', cancelHold);
  };
}

function normalizeGroupRow(row = {}) {
  return {
    id: String(row?.id ?? '').trim().replace(/\D+/g, ''),
    name: String(row?.name ?? '').trim(),
    shortLabel: String(row?.shortLabel ?? row?.label ?? '').trim()
  };
}

function normalizeGroupRows(rows, options = {}) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const preserveIncomplete = Boolean(options?.preserveIncomplete);
  const deduped = [];
  const seen = new Set();
  for (const row of safeRows.map(normalizeGroupRow)) {
    if (!row.id) {
      if (preserveIncomplete) deduped.push(row);
      continue;
    }
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    deduped.push(row);
  }
  return deduped;
}

function renderGroupRows(target, rows) {
  if (!target) return;
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="4">No required Roblox groups configured.</td></tr>';
    return;
  }
  target.innerHTML = rows
    .map(
      (row, index) => `<tr data-group-index="${index}">
        <td><input type="text" data-group-field="id" value="${escapeHtml(row.id)}" placeholder="5024778" inputmode="numeric" /></td>
        <td><input type="text" data-group-field="name" value="${escapeHtml(row.name)}" placeholder="Frontier Oil &amp; Gas Company" /></td>
        <td><input type="text" data-group-field="shortLabel" value="${escapeHtml(row.shortLabel)}" placeholder="FOG" maxlength="24" /></td>
        <td class="align-right"><button class="btn btn-secondary btn-compact" type="button" data-remove-group="${index}">Remove</button></td>
      </tr>`
    )
    .join('');
}

function setHiddenInputValue(rows) {
  const hidden = document.querySelector('#settingsRequiredRobloxGroupsJson');
  if (hidden) hidden.value = JSON.stringify(normalizeGroupRows(rows));
}

function syncHiddenInput(target, rows) {
  const draftRows = normalizeGroupRows(rows, { preserveIncomplete: true });
  setHiddenInputValue(draftRows);
  renderGroupRows(target, draftRows);
}

function readRowsFromDom(target) {
  if (!target) return [];
  return [...target.querySelectorAll('tr[data-group-index]')].map((row) => ({
    id: row.querySelector('[data-group-field="id"]')?.value || '',
    name: row.querySelector('[data-group-field="name"]')?.value || '',
    shortLabel: row.querySelector('[data-group-field="shortLabel"]')?.value || ''
  }));
}

function boolLabel(enabled, label) {
  return enabled ? label : '';
}

function ruleSummary(row) {
  const items = [
    `Severity ${Number(row?.severity || 1)}`,
    String(row?.default_status || 'ACTIVE').trim().toUpperCase() || 'ACTIVE',
    Number(row?.requires_end_date || 0) ? 'End date required' : '',
    Number(row?.default_duration_days || 0) > 0 ? `${Number(row.default_duration_days)} days` : '',
    String(row?.set_employee_status || '').trim() ? `Status: ${String(row.set_employee_status).trim()}` : '',
    Number(row?.apply_suspension_rank || 0) ? 'Applies suspension rank' : ''
  ].filter(Boolean);
  return items.join(' - ');
}

function restrictionSummary(row) {
  const items = [
    boolLabel(Number(row?.restrict_intranet || 0), 'Intranet'),
    boolLabel(Number(row?.restrict_voyages || 0), 'Voyages'),
    boolLabel(Number(row?.restrict_finance || 0), 'Finance')
  ].filter(Boolean);
  return items.length ? items.join(', ') : 'None';
}

function renderDisciplinaryTypes(target, rows = []) {
  if (!target) return;
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="4">No disciplinary types configured.</td></tr>';
    return;
  }
  target.innerHTML = rows
    .map(
      (row) => `<tr>
        <td>
          <strong>${escapeHtml(String(row?.label || row?.value || row?.key || 'Unnamed').trim())}</strong>
          <small class="finance-inline-caption">${escapeHtml(String(row?.key || '').trim() || 'No key')}</small>
        </td>
        <td>${escapeHtml(ruleSummary(row))}</td>
        <td>${escapeHtml(restrictionSummary(row))}</td>
        <td class="align-right">
          <button class="btn btn-secondary btn-compact" type="button" data-edit-disciplinary-type="${Number(row?.id || 0)}">Edit</button>
          <button class="btn btn-danger btn-compact" type="button" data-delete-disciplinary-type="${Number(row?.id || 0)}">Delete</button>
        </td>
      </tr>`
    )
    .join('');
}

function summarizeStatusBehavior(row) {
  const rawValue = String(row?.value || '').trim();
  const normalizedValue = rawValue.toLowerCase();
  const explicitAccessMode = String(row?.access_mode || '').trim();
  const accessMode = explicitAccessMode || (
    normalizedValue === 'suspended'
      ? 'my_details_only'
      : normalizedValue === 'removed'
        ? 'removed_page'
        : normalizedValue === 'left'
          ? 'blocked'
          : 'normal'
  );
  const shouldShowNotice = Number(row?.show_notice || 0) || normalizedValue === 'suspended';
  const excludeFromStats = Number(row?.exclude_from_stats || 0) || normalizedValue === 'left';
  const removeFromGroup = Number(row?.remove_from_group || 0) || normalizedValue === 'left';
  const items = [
    accessMode === 'my_details_only' ? 'My Details only' : '',
    accessMode === 'removed_page' ? 'Redirects to removed page' : '',
    accessMode === 'blocked' ? 'Blocks login' : '',
    shouldShowNotice ? 'Shows notice' : '',
    excludeFromStats ? 'Excluded from stats' : '',
    removeFromGroup ? 'Removes from Roblox group' : ''
  ].filter(Boolean);
  return items.join(' - ') || 'Normal access';
}

function renderStatuses(target, rows = []) {
  if (!target) return;
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="3">No employee statuses configured.</td></tr>';
    return;
  }
  target.innerHTML = rows
    .map(
      (row) => `<tr>
        <td><strong>${escapeHtml(String(row?.value || '').trim() || 'Unnamed')}</strong></td>
        <td>${escapeHtml(summarizeStatusBehavior(row))}</td>
        <td class="align-right">
          <button class="btn btn-secondary btn-compact" type="button" data-edit-status="${Number(row?.id || 0)}">Edit</button>
          <button class="btn btn-danger btn-compact" type="button" data-delete-status="${Number(row?.id || 0)}">Delete</button>
        </td>
      </tr>`
    )
    .join('');
}

function readCheckbox(selector) {
  return Boolean(document.querySelector(selector)?.checked);
}

function setCheckbox(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.checked = Boolean(value);
}

function readInput(selector) {
  return String(document.querySelector(selector)?.value ?? '').trim();
}

function setInput(selector, value) {
  const node = document.querySelector(selector);
  if (node) node.value = String(value ?? '');
}

function normalizeTypePayload(payload = {}) {
  const key = String(payload?.key || '').trim().replace(/[^A-Za-z0-9 _-]/g, '').replace(/[\s-]+/g, '_').toUpperCase();
  const label = String(payload?.label || '').trim();
  const severity = Number(payload?.severity || 1);
  const defaultDurationDays = Number(payload?.defaultDurationDays || 0);
  return {
    key,
    label,
    value: label,
    severity: Number.isFinite(severity) && severity > 0 ? Math.floor(severity) : 1,
    defaultStatus: String(payload?.defaultStatus || 'ACTIVE').trim().toUpperCase() || 'ACTIVE',
    defaultDurationDays: Number.isFinite(defaultDurationDays) && defaultDurationDays > 0 ? Math.floor(defaultDurationDays) : null,
    setEmployeeStatus: String(payload?.setEmployeeStatus || '').trim(),
    isActive: Boolean(payload?.isActive),
    requiresEndDate: Boolean(payload?.requiresEndDate),
    applySuspensionRank: Boolean(payload?.applySuspensionRank),
    restrictIntranet: Boolean(payload?.restrictIntranet),
    restrictVoyages: Boolean(payload?.restrictVoyages),
    restrictFinance: Boolean(payload?.restrictFinance)
  };
}

function collectDisciplinaryForm() {
  return normalizeTypePayload({
    key: readInput('#disciplinaryTypeKey'),
    label: readInput('#disciplinaryTypeLabel'),
    severity: readInput('#disciplinaryTypeSeverity'),
    defaultStatus: readInput('#disciplinaryTypeDefaultStatus'),
    defaultDurationDays: readInput('#disciplinaryTypeDuration'),
    setEmployeeStatus: readInput('#disciplinaryTypeSetStatus'),
    isActive: readCheckbox('#disciplinaryTypeActive'),
    requiresEndDate: readCheckbox('#disciplinaryTypeRequiresEnd'),
    applySuspensionRank: readCheckbox('#disciplinaryTypeSuspension'),
    restrictIntranet: readCheckbox('#disciplinaryTypeRestrictIntranet'),
    restrictVoyages: readCheckbox('#disciplinaryTypeRestrictVoyages'),
    restrictFinance: readCheckbox('#disciplinaryTypeRestrictFinance')
  });
}

function fillDisciplinaryForm(row = null) {
  setInput('#disciplinaryTypeKey', row?.key || '');
  setInput('#disciplinaryTypeLabel', row?.label || row?.value || '');
  setInput('#disciplinaryTypeSeverity', Number(row?.severity || 1));
  setInput('#disciplinaryTypeDefaultStatus', row?.default_status || 'ACTIVE');
  setInput('#disciplinaryTypeDuration', row?.default_duration_days || '');
  setInput('#disciplinaryTypeSetStatus', row?.set_employee_status || '');
  setCheckbox('#disciplinaryTypeActive', Number(row?.is_active ?? 1));
  setCheckbox('#disciplinaryTypeRequiresEnd', Number(row?.requires_end_date || 0));
  setCheckbox('#disciplinaryTypeSuspension', Number(row?.apply_suspension_rank || 0));
  setCheckbox('#disciplinaryTypeRestrictIntranet', Number(row?.restrict_intranet || 0));
  setCheckbox('#disciplinaryTypeRestrictVoyages', Number(row?.restrict_voyages || 0));
  setCheckbox('#disciplinaryTypeRestrictFinance', Number(row?.restrict_finance || 0));
}

function setDisciplinaryEditingState(editingId = null) {
  const form = document.querySelector('#disciplinaryTypeForm');
  if (form) form.dataset.editingId = editingId ? String(editingId) : '';
  const saveBtn = document.querySelector('#disciplinaryTypeSaveBtn');
  if (saveBtn) saveBtn.textContent = editingId ? 'Save Changes' : 'Add Type';
}

function resetDisciplinaryForm() {
  fillDisciplinaryForm(null);
  setDisciplinaryEditingState(null);
}

function setStatusEditingState(editingId = null) {
  const form = document.querySelector('#statusConfigForm');
  if (form) form.dataset.editingId = editingId ? String(editingId) : '';
  const saveBtn = document.querySelector('#statusConfigSaveBtn');
  if (saveBtn) saveBtn.textContent = editingId ? 'Save Changes' : 'Add Status';
}

function resetStatusForm() {
  setInput('#statusConfigValue', '');
  setInput('#statusConfigAccessMode', 'normal');
  setCheckbox('#statusConfigShowNotice', false);
  setCheckbox('#statusConfigExcludeFromStats', false);
  setCheckbox('#statusConfigRemoveFromGroup', false);
  setStatusEditingState(null);
}

function updateMaintenanceUi(settings = {}) {
  const enabled = Boolean(settings?.maintenanceMode);
  const toggle = document.querySelector('#toggleMaintenanceModeBtn');
  const badge = document.querySelector('#maintenanceModeStateBadge');
  const hint = document.querySelector('#maintenanceModeHint');
  const title = document.querySelector('#maintenanceModeTitle');
  if (toggle) {
    toggle.textContent = enabled ? 'Hold To Disable Maintenance' : 'Hold To Enable Maintenance';
    toggle.setAttribute('aria-label', toggle.textContent);
    toggle.title = enabled ? 'Press and hold for 1.2 seconds to disable maintenance mode' : 'Press and hold for 1.2 seconds to enable maintenance mode';
  }
  if (badge) {
    badge.textContent = enabled ? 'Active' : 'Inactive';
    badge.classList.toggle('is-live', enabled);
  }
  if (title) {
    title.textContent = enabled ? 'Maintenance mode is currently enabled.' : 'Maintenance mode is currently disabled.';
  }
  if (hint) {
    hint.textContent = enabled
      ? 'Public visitors are currently redirected to the maintenance page until you hold to disable it.'
      : 'Public visitors stay on the normal website until this is enabled.';
  }
}

function applyForm(settings) {
  const body = document.querySelector('#settingsRequiredRobloxGroupsBody');
  syncHiddenInput(body, normalizeGroupRows(settings.requiredRobloxGroups));
  updateMaintenanceUi(settings);
}

function collectSiteSettingsForm() {
  const body = document.querySelector('#settingsRequiredRobloxGroupsBody');
  const rows = normalizeGroupRows(readRowsFromDom(body));
  setHiddenInputValue(rows);
  return {
    requiredRobloxGroups: rows
  };
}

async function loadPageData(feedback) {
  const [sitePayload, configPayload] = await Promise.all([getSiteSettings(), getEmployeeConfigBootstrap()]);
  const settings = sitePayload?.settings || {};
  const disciplinaryTypes = Array.isArray(configPayload?.disciplinaryTypes) ? configPayload.disciplinaryTypes : [];
  const statuses = Array.isArray(configPayload?.statuses) ? configPayload.statuses : [];
  applyForm(settings);
  renderDisciplinaryTypes(document.querySelector('#disciplinaryTypesTableBody'), disciplinaryTypes);
  renderStatuses(document.querySelector('#statusConfigTableBody'), statuses);
  document.querySelector('#siteSettingsContent')?.classList.remove('hidden');
  document.querySelector('#disciplinaryConfigSection')?.classList.remove('hidden');
  document.querySelector('#statusConfigSection')?.classList.remove('hidden');
  if (feedback) feedback.innerHTML = '';
  return { settings, disciplinaryTypes, statuses };
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
  const toggleMaintenanceModeBtn = document.querySelector('#toggleMaintenanceModeBtn');
  const addGroupBtn = document.querySelector('#addRequiredRobloxGroupBtn');
  const groupsBody = document.querySelector('#settingsRequiredRobloxGroupsBody');
  const disciplinaryFeedback = document.querySelector('#disciplinaryTypesFeedback');
  const disciplinaryForm = document.querySelector('#disciplinaryTypeForm');
  const disciplinaryTableBody = document.querySelector('#disciplinaryTypesTableBody');
  const statusFeedback = document.querySelector('#statusConfigFeedback');
  const statusForm = document.querySelector('#statusConfigForm');
  const statusTableBody = document.querySelector('#statusConfigTableBody');

  const state = {
    siteSettings: null,
    disciplinaryTypes: [],
    statuses: []
  };

  try {
    const loaded = await loadPageData(feedback);
    state.siteSettings = loaded.settings;
    state.disciplinaryTypes = loaded.disciplinaryTypes;
    state.statuses = loaded.statuses;
    resetDisciplinaryForm();
    resetStatusForm();
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load site settings.', 'error');
    return;
  }

  addGroupBtn?.addEventListener('click', () => {
    syncHiddenInput(groupsBody, [...readRowsFromDom(groupsBody), { id: '', name: '', shortLabel: '' }]);
  });

  groupsBody?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest('[data-remove-group]');
    if (!button) return;
    const index = Number(button.getAttribute('data-remove-group'));
    syncHiddenInput(groupsBody, readRowsFromDom(groupsBody).filter((_, rowIndex) => rowIndex !== index));
  });

  groupsBody?.addEventListener('input', () => {
    setHiddenInputValue(readRowsFromDom(groupsBody));
  });



  resetBtn?.addEventListener('click', () => {
    if (!state.siteSettings) return;
    applyForm(state.siteSettings);
    showMessage(feedback, 'Form reset.', 'info');
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!saveBtn) return;
    saveBtn.disabled = true;
    showMessage(feedback, 'Saving settings...', 'info');
    try {
      const response = await saveSiteSettings(collectSiteSettingsForm());
      state.siteSettings = response?.settings || state.siteSettings;
      applyForm(state.siteSettings);
      showMessage(feedback, 'Site settings saved.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to save site settings.', 'error');
    } finally {
      saveBtn.disabled = false;
    }
  });

  disciplinaryForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const saveTypeBtn = document.querySelector('#disciplinaryTypeSaveBtn');
    if (!saveTypeBtn) return;
    saveTypeBtn.disabled = true;
    showMessage(disciplinaryFeedback, 'Saving disciplinary type...', 'info');
    try {
      const payload = collectDisciplinaryForm();
      if (!payload.key || !payload.label) throw new Error('Key and label are required.');
      const editingId = Number(disciplinaryForm.dataset.editingId || 0);
      const response = editingId
        ? await updateConfigValue('disciplinary_types', editingId, payload)
        : await createConfigValue('disciplinary_types', payload);
      state.disciplinaryTypes = Array.isArray(response?.items) ? response.items : [];
      renderDisciplinaryTypes(disciplinaryTableBody, state.disciplinaryTypes);
      resetDisciplinaryForm();
      showMessage(disciplinaryFeedback, editingId ? 'Disciplinary type updated.' : 'Disciplinary type added.', 'success');
    } catch (error) {
      showMessage(disciplinaryFeedback, error.message || 'Unable to save disciplinary type.', 'error');
    } finally {
      saveTypeBtn.disabled = false;
    }
  });

  disciplinaryTableBody?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const editButton = target.closest('[data-edit-disciplinary-type]');
    if (editButton) {
      const id = Number(editButton.getAttribute('data-edit-disciplinary-type'));
      const row = state.disciplinaryTypes.find((item) => Number(item?.id) === id);
      if (!row) return;
      setDisciplinaryEditingState(id);
      fillDisciplinaryForm(row);
      showMessage(disciplinaryFeedback, `Editing ${String(row?.label || row?.value || row?.key).trim()}.`, 'info');
      return;
    }

    const deleteButton = target.closest('[data-delete-disciplinary-type]');
    if (!deleteButton) return;
    const id = Number(deleteButton.getAttribute('data-delete-disciplinary-type'));
    if (!Number.isInteger(id) || id <= 0 || !window.confirm('Delete this disciplinary type?')) return;

    void (async () => {
      try {
        const response = await deleteConfigValue('disciplinary_types', id);
        state.disciplinaryTypes = Array.isArray(response?.items) ? response.items : [];
        renderDisciplinaryTypes(disciplinaryTableBody, state.disciplinaryTypes);
        resetDisciplinaryForm();
        showMessage(disciplinaryFeedback, 'Disciplinary type deleted.', 'success');
      } catch (error) {
        showMessage(disciplinaryFeedback, error.message || 'Unable to delete disciplinary type.', 'error');
      }
    })();
  });

  statusForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const saveStatusBtn = document.querySelector('#statusConfigSaveBtn');
    if (!saveStatusBtn) return;
    saveStatusBtn.disabled = true;
    showMessage(statusFeedback, 'Saving status...', 'info');
    try {
      const payload = {
        value: readInput('#statusConfigValue'),
        accessMode: readInput('#statusConfigAccessMode') || 'normal',
        showNotice: readCheckbox('#statusConfigShowNotice'),
        excludeFromStats: readCheckbox('#statusConfigExcludeFromStats'),
        removeFromGroup: readCheckbox('#statusConfigRemoveFromGroup')
      };
      if (!payload.value) throw new Error('Status value is required.');
      const editingId = Number(statusForm.dataset.editingId || 0);
      const response = editingId
        ? await updateConfigValue('statuses', editingId, payload)
        : await createConfigValue('statuses', payload);
      state.statuses = Array.isArray(response?.items) ? response.items : [];
      renderStatuses(statusTableBody, state.statuses);
      resetStatusForm();
      showMessage(statusFeedback, editingId ? 'Status updated.' : 'Status added.', 'success');
    } catch (error) {
      showMessage(statusFeedback, error.message || 'Unable to save status.', 'error');
    } finally {
      saveStatusBtn.disabled = false;
    }
  });

  if (toggleMaintenanceModeBtn instanceof HTMLButtonElement) {
    bindHoldToConfirm(
      toggleMaintenanceModeBtn,
      async () => {
        const nextValue = !Boolean(state.siteSettings?.maintenanceMode);
        toggleMaintenanceModeBtn.disabled = true;
        showMessage(feedback, nextValue ? 'Enabling maintenance mode...' : 'Disabling maintenance mode...', 'info');
        try {
          const response = await saveSiteSettings({ maintenanceMode: nextValue });
          state.siteSettings = response?.settings || { ...state.siteSettings, maintenanceMode: nextValue };
          applyForm(state.siteSettings);
          showMessage(feedback, nextValue ? 'Maintenance mode enabled.' : 'Maintenance mode disabled.', 'success');
          if (nextValue) window.location.href = '/maintenance';
        } catch (error) {
          applyForm(state.siteSettings || {});
          showMessage(feedback, error.message || 'Unable to update maintenance mode.', 'error');
        } finally {
          toggleMaintenanceModeBtn.disabled = false;
        }
      },
      Number(toggleMaintenanceModeBtn.dataset.holdConfirmMs || 1200)
    );
  }

  statusTableBody?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const editButton = target.closest('[data-edit-status]');
    if (editButton) {
      const id = Number(editButton.getAttribute('data-edit-status'));
      const row = state.statuses.find((item) => Number(item?.id) === id);
      if (!row) return;
      setStatusEditingState(id);
      setInput('#statusConfigValue', row?.value || '');
      setInput('#statusConfigAccessMode', row?.access_mode || 'normal');
      setCheckbox('#statusConfigShowNotice', Number(row?.show_notice || 0));
      setCheckbox('#statusConfigExcludeFromStats', Number(row?.exclude_from_stats || 0));
      setCheckbox('#statusConfigRemoveFromGroup', Number(row?.remove_from_group || 0));
      showMessage(statusFeedback, `Editing ${String(row?.value || '').trim()}.`, 'info');
      return;
    }

    const deleteButton = target.closest('[data-delete-status]');
    if (!deleteButton) return;
    const id = Number(deleteButton.getAttribute('data-delete-status'));
    if (!Number.isInteger(id) || id <= 0 || !window.confirm('Delete this status?')) return;

    void (async () => {
      try {
        const response = await deleteConfigValue('statuses', id);
        state.statuses = Array.isArray(response?.items) ? response.items : [];
        renderStatuses(statusTableBody, state.statuses);
        resetStatusForm();
        showMessage(statusFeedback, 'Status deleted.', 'success');
      } catch (error) {
        showMessage(statusFeedback, error.message || 'Unable to delete status.', 'error');
      }
    })();
  });
});



