import { initIntranetPageGuard } from '../modules/intranet-page-guard.js?v=20260304b';
import { getSiteSettings, saveSiteSettings } from '../modules/admin-api.js';
import { showMessage } from '../modules/notice.js';

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeGroupRow(row = {}) {
  return {
    id: String(row?.id ?? '').trim().replace(/\D+/g, ''),
    name: String(row?.name ?? '').trim(),
    shortLabel: String(row?.shortLabel ?? row?.label ?? '').trim()
  };
}

function normalizeGroupRows(rows) {
  const safeRows = Array.isArray(rows) ? rows : [];
  const deduped = [];
  const seen = new Set();
  for (const row of safeRows.map(normalizeGroupRow)) {
    if (!row.id || seen.has(row.id)) continue;
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
  if (!hidden) return;
  hidden.value = JSON.stringify(normalizeGroupRows(rows));
}

function syncHiddenInput(target, rows) {
  const normalized = normalizeGroupRows(rows);
  setHiddenInputValue(normalized);
  renderGroupRows(target, normalized);
}

function readRowsFromDom(target) {
  if (!target) return [];
  return [...target.querySelectorAll('tr[data-group-index]')].map((row) => ({
    id: row.querySelector('[data-group-field="id"]')?.value || '',
    name: row.querySelector('[data-group-field="name"]')?.value || '',
    shortLabel: row.querySelector('[data-group-field="shortLabel"]')?.value || ''
  }));
}

function applyForm(settings) {
  const body = document.querySelector('#settingsRequiredRobloxGroupsBody');
  const rows = normalizeGroupRows(settings.requiredRobloxGroups);
  syncHiddenInput(body, rows);
}

function collectForm() {
  const body = document.querySelector('#settingsRequiredRobloxGroupsBody');
  const rows = normalizeGroupRows(readRowsFromDom(body));
  setHiddenInputValue(rows);
  return {
    requiredRobloxGroups: rows
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
  const addGroupBtn = document.querySelector('#addRequiredRobloxGroupBtn');
  const groupsBody = document.querySelector('#settingsRequiredRobloxGroupsBody');

  let lastLoaded = null;

  try {
    lastLoaded = await loadSettings(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load site settings.', 'error');
    return;
  }

  addGroupBtn?.addEventListener('click', () => {
    const nextRows = [...readRowsFromDom(groupsBody), { id: '', name: '', shortLabel: '' }];
    syncHiddenInput(groupsBody, nextRows);
  });

  groupsBody?.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest('[data-remove-group]');
    if (!button) return;
    const index = Number(button.getAttribute('data-remove-group'));
    const rows = readRowsFromDom(groupsBody).filter((_, rowIndex) => rowIndex !== index);
    syncHiddenInput(groupsBody, rows);
  });

  groupsBody?.addEventListener('input', () => {
    const rows = readRowsFromDom(groupsBody);
    setHiddenInputValue(rows);
  });

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
