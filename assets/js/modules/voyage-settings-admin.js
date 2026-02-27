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
  return date.toLocaleString();
}

function sectionMarkup(type) {
  return `
    <article class="panel section-surface" data-voyage-config-section="${type.key}">
      <div class="modal-header">
        <h2>${escapeHtml(type.label)}</h2>
      </div>
      <form class="filter-row" data-voyage-config-add-form="${type.key}">
        <div class="full-width-field">
          <label for="voyageConfigInput_${type.key}">Value</label>
          <input id="voyageConfigInput_${type.key}" name="value" type="text" required placeholder="${escapeHtml(type.placeholder)}" />
        </div>
        <div class="button-row">
          <button class="btn btn-primary" type="submit">Add</button>
        </div>
      </form>
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Value</th>
              <th>Updated</th>
              <th class="align-right">Actions</th>
            </tr>
          </thead>
          <tbody data-voyage-config-rows="${type.key}">
            <tr><td colspan="3">Loading...</td></tr>
          </tbody>
        </table>
      </div>
      <div class="feedback" data-voyage-config-feedback="${type.key}" role="status" aria-live="polite"></div>
    </article>
  `;
}

export async function initVoyageSettingsAdmin(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const grid = document.querySelector(config.gridSelector);
  if (!feedback || !grid) return;

  const state = {
    itemsByType: new Map()
  };

  grid.innerHTML = CONFIG_TYPES.map(sectionMarkup).join('');

  function sectionNodes(typeKey) {
    return {
      rows: grid.querySelector(`[data-voyage-config-rows="${typeKey}"]`),
      feedbackNode: grid.querySelector(`[data-voyage-config-feedback="${typeKey}"]`),
      form: grid.querySelector(`[data-voyage-config-add-form="${typeKey}"]`)
    };
  }

  function renderRows(typeKey) {
    const { rows } = sectionNodes(typeKey);
    if (!rows) return;
    const items = state.itemsByType.get(typeKey) || [];
    if (!items.length) {
      rows.innerHTML = '<tr><td colspan="3">No values configured.</td></tr>';
      return;
    }
    rows.innerHTML = items
      .map(
        (item) => `
      <tr data-voyage-config-row-id="${Number(item.id)}" data-voyage-config-type="${typeKey}">
        <td>${escapeHtml(text(item.value))}</td>
        <td>${escapeHtml(formatDate(item.updated_at || item.created_at))}</td>
        <td class="align-right">
          <button class="btn btn-secondary" type="button" data-voyage-config-edit="${typeKey}" data-id="${Number(item.id)}">Edit</button>
          <button class="btn btn-danger" type="button" data-voyage-config-delete="${typeKey}" data-id="${Number(item.id)}">Delete</button>
        </td>
      </tr>
    `
      )
      .join('');
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
        showMessage(feedbackNode, 'Value is required.', 'error');
        return;
      }
      try {
        await createVoyageConfigValue(type.key, value);
        form.reset();
        await loadType(type.key);
        showMessage(feedbackNode, `${type.label} value added.`, 'success');
      } catch (error) {
        showMessage(feedbackNode, error.message || `Unable to add ${type.label.toLowerCase()} value.`, 'error');
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
        showMessage(feedbackNode, 'Value cannot be empty.', 'error');
        return;
      }
      void (async () => {
        try {
          await updateVoyageConfigValue(typeKey, id, normalized);
          await loadType(typeKey);
          showMessage(feedbackNode, 'Value updated.', 'success');
        } catch (error) {
          showMessage(feedbackNode, error.message || 'Unable to update value.', 'error');
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
          showMessage(feedbackNode, 'Value deleted.', 'success');
        } catch (error) {
          showMessage(feedbackNode, error.message || 'Unable to delete value.', 'error');
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
