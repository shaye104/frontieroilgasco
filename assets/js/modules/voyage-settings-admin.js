import {
  createVoyageConfigValue,
  deleteVoyageConfigValue,
  listVoyageConfigAdmin,
  updateVoyageConfigValue
} from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

const CONFIG_TYPES = [
  { key: 'ports', label: 'Ports', placeholder: 'Add port name' },
  { key: 'vessel_names', label: 'Vessel Names', placeholder: 'Add vessel name' },
  { key: 'vessel_classes', label: 'Vessel Classes', placeholder: 'Add vessel class' },
  { key: 'vessel_callsigns', label: 'Vessel Callsigns', placeholder: 'Add vessel callsign' }
];

function text(value) {
  return String(value ?? '').trim();
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
  const raw = text(value);
  if (!raw) return 'N/A';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  const hh = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function sectionMarkup(type) {
  return `
    <article class="panel section-surface voyage-settings-card" data-voyage-config-section="${type.key}">
      <div class="modal-header">
        <h2>${escapeHtml(type.label)}</h2>
      </div>
      <form class="voyage-settings-add-row" data-voyage-config-add-form="${type.key}">
        <label for="voyageConfigInput_${type.key}" class="hidden">Value</label>
        <input id="voyageConfigInput_${type.key}" name="value" type="text" required placeholder="${escapeHtml(type.placeholder)}" />
        <div class="voyage-settings-add-actions">
          <button class="btn btn-primary" type="submit">Add</button>
        </div>
      </form>
      <div class="voyage-settings-list" data-voyage-config-rows="${type.key}">
        <div class="voyage-settings-row voyage-settings-row-header">
          <span>Value</span>
          <span>Updated</span>
          <span class="align-right">Actions</span>
        </div>
        <div class="voyage-settings-row">
          <span class="voyage-settings-empty">Loading...</span>
          <span></span>
          <span></span>
        </div>
      </div>
      <div class="feedback voyage-settings-feedback" data-voyage-config-feedback="${type.key}" role="status" aria-live="polite"></div>
    </article>
  `;
}

export async function initVoyageSettingsAdmin(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const grid = document.querySelector(config.gridSelector);
  if (!feedback || !grid) return;

  const state = {
    itemsByType: new Map(),
    feedbackTimers: new Map()
  };

  grid.innerHTML = CONFIG_TYPES.map(sectionMarkup).join('');

  function sectionNodes(typeKey) {
    return {
      rows: grid.querySelector(`[data-voyage-config-rows="${typeKey}"]`),
      feedbackNode: grid.querySelector(`[data-voyage-config-feedback="${typeKey}"]`),
      form: grid.querySelector(`[data-voyage-config-add-form="${typeKey}"]`)
    };
  }

  function showCardFeedback(typeKey, message, tone) {
    const { feedbackNode } = sectionNodes(typeKey);
    if (!feedbackNode) return;
    showMessage(feedbackNode, message, tone);
    const existing = state.feedbackTimers.get(typeKey);
    if (existing) window.clearTimeout(existing);
    const timer = window.setTimeout(() => {
      clearMessage(feedbackNode);
      state.feedbackTimers.delete(typeKey);
    }, 2600);
    state.feedbackTimers.set(typeKey, timer);
  }

  function renderRows(typeKey) {
    const { rows } = sectionNodes(typeKey);
    if (!rows) return;
    const items = state.itemsByType.get(typeKey) || [];
    if (!items.length) {
      rows.innerHTML = `
        <div class="voyage-settings-row voyage-settings-row-header">
          <span>Value</span><span>Updated</span><span class="align-right">Actions</span>
        </div>
        <div class="voyage-settings-row">
          <span class="voyage-settings-empty">No values configured.</span>
          <span></span>
          <span></span>
        </div>`;
      return;
    }
    const bodyRows = items
      .map(
        (item) => `
      <div class="voyage-settings-row" data-voyage-config-row-id="${Number(item.id)}" data-voyage-config-type="${typeKey}">
        <span class="voyage-settings-value" title="${escapeHtml(text(item.value))}">${escapeHtml(text(item.value))}</span>
        <span class="voyage-settings-updated" title="${escapeHtml(formatDate(item.updated_at || item.created_at))}">${escapeHtml(
          formatDate(item.updated_at || item.created_at).replace(',', '')
        )}</span>
        <span class="voyage-settings-actions">
          <button class="btn btn-secondary" type="button" data-voyage-config-edit="${typeKey}" data-id="${Number(item.id)}">Edit</button>
          <button class="btn btn-danger" type="button" data-voyage-config-delete="${typeKey}" data-id="${Number(item.id)}">Delete</button>
        </span>
      </div>
    `
      )
      .join('');
    rows.innerHTML = `
      <div class="voyage-settings-row voyage-settings-row-header">
        <span>Value</span><span>Updated</span><span class="align-right">Actions</span>
      </div>
      ${bodyRows}
    `;
  }

  async function loadType(typeKey) {
    const payload = await listVoyageConfigAdmin(typeKey);
    state.itemsByType.set(typeKey, Array.isArray(payload?.items) ? payload.items : []);
    renderRows(typeKey);
  }

  async function loadAll() {
    await Promise.all(CONFIG_TYPES.map((type) => loadType(type.key)));
  }

  CONFIG_TYPES.forEach((type) => {
    const { form, feedbackNode } = sectionNodes(type.key);
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      clearMessage(feedbackNode);
      const formData = new FormData(form);
      const value = text(formData.get('value'));
      if (!value) {
        showCardFeedback(type.key, 'Value is required.', 'error');
        return;
      }
      try {
        await createVoyageConfigValue(type.key, value);
        form.reset();
        await loadType(type.key);
        showCardFeedback(type.key, `${type.label} value added.`, 'success');
      } catch (error) {
        showCardFeedback(type.key, error.message || `Unable to add ${type.label.toLowerCase()} value.`, 'error');
      }
    });
  });

  grid.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const editBtn = target.closest('[data-voyage-config-edit]');
    if (editBtn) {
      const typeKey = text(editBtn.getAttribute('data-voyage-config-edit'));
      const id = Number(editBtn.getAttribute('data-id'));
      if (!typeKey || !Number.isInteger(id) || id <= 0) return;
      const { feedbackNode } = sectionNodes(typeKey);
      const items = state.itemsByType.get(typeKey) || [];
      const current = items.find((item) => Number(item.id) === id);
      const nextValue = window.prompt('Update value', text(current?.value));
      if (nextValue === null) return;
      const normalized = text(nextValue);
      if (!normalized) {
        showCardFeedback(typeKey, 'Value cannot be empty.', 'error');
        return;
      }
      void (async () => {
        try {
          await updateVoyageConfigValue(typeKey, id, normalized);
          await loadType(typeKey);
          showCardFeedback(typeKey, 'Value updated.', 'success');
        } catch (error) {
          showCardFeedback(typeKey, error.message || 'Unable to update value.', 'error');
        }
      })();
      return;
    }

    const deleteBtn = target.closest('[data-voyage-config-delete]');
    if (deleteBtn) {
      const typeKey = text(deleteBtn.getAttribute('data-voyage-config-delete'));
      const id = Number(deleteBtn.getAttribute('data-id'));
      if (!typeKey || !Number.isInteger(id) || id <= 0) return;
      const { feedbackNode } = sectionNodes(typeKey);
      if (!window.confirm('Delete this value?')) return;
      void (async () => {
        try {
          await deleteVoyageConfigValue(typeKey, id);
          await loadType(typeKey);
          showCardFeedback(typeKey, 'Value deleted.', 'success');
        } catch (error) {
          showCardFeedback(typeKey, error.message || 'Unable to delete value.', 'error');
        }
      })();
    }
  });

  try {
    await loadAll();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load voyage settings.', 'error');
  }
}
