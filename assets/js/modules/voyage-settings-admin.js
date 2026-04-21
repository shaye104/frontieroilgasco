import {
  createVoyageConfigValue,
  deleteVoyageConfigValue,
  listVoyageConfigAdmin,
  updateVoyageConfigValue
} from './admin-api.js';
import { formatLocalDate } from './local-datetime.js';
import { clearMessage, showMessage } from './notice.js';

const CONFIG_TYPES = [
  { key: 'ports', label: 'Ports', placeholder: 'Add port name', numeric: null },
  { key: 'fish_types', label: 'Cargo Types', placeholder: 'Add cargo type name', numeric: { key: 'unitPrice', label: 'Buy Price', step: '0.01', min: '0' } },
  {
    key: 'sell_locations',
    label: 'Sell Locations',
    placeholder: 'Add sell location name',
    numeric: null,
    linkedPort: true
  }
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
  return formatLocalDate(raw, { fallback: raw });
}

function formatMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '0';
  return String(Math.round(n * 100) / 100);
}

function linkedPortMarkup(type) {
  if (!type.linkedPort) return '';
  return `
      <label for="voyageConfigLinkedPort_${type.key}" class="hidden">Linked destination port</label>
      <select id="voyageConfigLinkedPort_${type.key}" name="linkedPort" class="voyage-settings-linked-port-select">
        <option value="">Linked destination port</option>
      </select>`;
}

function sectionMarkup(type) {
  const numericMarkup = type.numeric
    ? `
      <label for="voyageConfigNumeric_${type.key}">${escapeHtml(type.numeric.label)}</label>
      <input
        id="voyageConfigNumeric_${type.key}"
        name="numericValue"
        type="number"
        required
        min="${escapeHtml(type.numeric.min)}"
        step="${escapeHtml(type.numeric.step)}"
      />`
    : '';

  return `
    <article class="panel section-surface voyage-settings-card" data-voyage-config-section="${type.key}">
      <div class="modal-header">
        <h2>${escapeHtml(type.label)}</h2>
      </div>
      <form class="voyage-settings-add-row" data-voyage-config-add-form="${type.key}">
        <label for="voyageConfigInput_${type.key}" class="hidden">Value</label>
        <input id="voyageConfigInput_${type.key}" name="value" type="text" required placeholder="${escapeHtml(type.placeholder)}" />
        ${linkedPortMarkup(type)}
        ${numericMarkup}
        <div class="voyage-settings-add-actions">
          <button class="btn btn-primary" type="submit">Add</button>
        </div>
      </form>
      <div class="voyage-settings-list" data-voyage-config-rows="${type.key}">
        <div class="voyage-settings-row voyage-settings-row-header">
          <span>Value</span>
          <span>Details</span>
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

function detailText(type, item) {
  if (type.key === 'fish_types') return `Buy: ${formatMoney(item.unit_price)}`;
  return formatDate(item.updated_at || item.created_at);
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
      form: grid.querySelector(`[data-voyage-config-add-form="${typeKey}"]`),
      linkedPortSelect: grid.querySelector(`#voyageConfigLinkedPort_${typeKey}`)
    };
  }

  function populateLinkedPortOptions(typeKey) {
    const { linkedPortSelect } = sectionNodes(typeKey);
    if (!linkedPortSelect) return;
    const ports = state.itemsByType.get('ports') || [];
    linkedPortSelect.innerHTML = ['<option value="">Linked destination port</option>']
      .concat(ports.map((row) => `<option value="${escapeHtml(text(row.value))}">${escapeHtml(text(row.value))}</option>`))
      .join('');
  }

  function linkedPortOptionsMarkup(selectedValue = '') {
    const selected = text(selectedValue);
    const ports = state.itemsByType.get('ports') || [];
    return ['<option value="">No linked port</option>']
      .concat(
        ports.map((row) => {
          const value = text(row.value);
          const selectedAttr = value === selected ? ' selected' : '';
          return `<option value="${escapeHtml(value)}"${selectedAttr}>${escapeHtml(value)}</option>`;
        })
      )
      .join('');
  }

  function showCardFeedback(typeKey, message, tone) {
    const { feedbackNode } = sectionNodes(typeKey);
    if (!feedbackNode) return;
    showMessage(feedbackNode, message, tone);
    window.setTimeout(() => clearMessage(feedbackNode), 2200);
  }

  function renderRows(type) {
    const { rows } = sectionNodes(type.key);
    if (!rows) return;
    const items = state.itemsByType.get(type.key) || [];
    const detailHeader = type.linkedPort ? 'Port of entry' : 'Details';
    if (!items.length) {
      rows.innerHTML = `
        <div class="voyage-settings-row voyage-settings-row-header">
          <span>Value</span><span>${escapeHtml(detailHeader)}</span><span class="align-right">Actions</span>
        </div>
        <div class="voyage-settings-row">
          <span class="voyage-settings-empty">No values configured.</span>
          <span></span>
          <span></span>
        </div>`;
      return;
    }

    rows.innerHTML = `
      <div class="voyage-settings-row voyage-settings-row-header">
        <span>Value</span><span>${escapeHtml(detailHeader)}</span><span class="align-right">Actions</span>
      </div>
      ${items
        .map((item) => {
          const id = Number(item.id);
          const detailsMarkup = type.linkedPort
            ? `<select class="voyage-settings-linked-port-select" data-voyage-config-linked-port="${type.key}" data-id="${id}" aria-label="Port of entry for ${escapeHtml(text(item.value))}">
                ${linkedPortOptionsMarkup(item.linked_port)}
              </select>`
            : escapeHtml(detailText(type, item));

          return `
        <div class="voyage-settings-row" data-voyage-config-row-id="${Number(item.id)}" data-voyage-config-type="${type.key}">
          <span class="voyage-settings-value">${escapeHtml(text(item.value))}</span>
          <span class="voyage-settings-updated">${detailsMarkup}</span>
          <span class="voyage-settings-actions">
            ${
              type.linkedPort
                ? `<button class="btn btn-primary" type="button" data-voyage-config-save-link="${type.key}" data-id="${id}">Save Port</button>`
                : ''
            }
            <button class="btn btn-secondary" type="button" data-voyage-config-edit="${type.key}" data-id="${Number(item.id)}">Edit</button>
            <button class="btn btn-danger" type="button" data-voyage-config-delete="${type.key}" data-id="${Number(item.id)}">Delete</button>
          </span>
        </div>`;
        })
        .join('')}
    `;
  }

  async function loadType(type) {
    const payload = await listVoyageConfigAdmin(type.key);
    state.itemsByType.set(type.key, Array.isArray(payload?.items) ? payload.items : []);
    renderRows(type);
    if (type.key === 'ports') {
      populateLinkedPortOptions('sell_locations');
      const sellLocations = CONFIG_TYPES.find((item) => item.key === 'sell_locations');
      if (sellLocations && state.itemsByType.has('sell_locations')) renderRows(sellLocations);
    }
  }

  async function loadAll() {
    await Promise.all(CONFIG_TYPES.map((type) => loadType(type)));
  }

  CONFIG_TYPES.forEach((type) => {
    const { form } = sectionNodes(type.key);
    form?.addEventListener('submit', async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const value = text(data.get('value'));
      const numericValue = type.numeric ? Number(data.get('numericValue')) : null;
      const linkedPort = type.linkedPort ? text(data.get('linkedPort')) : '';

      if (!value) return showCardFeedback(type.key, 'Value is required.', 'error');
      if (type.numeric && (!Number.isFinite(numericValue) || numericValue < 0)) {
        return showCardFeedback(type.key, `${type.numeric.label} must be >= 0.`, 'error');
      }

      try {
        await createVoyageConfigValue(type.key, value, numericValue, type.linkedPort ? { linkedPort } : {});
        form.reset();
        if (type.linkedPort) populateLinkedPortOptions(type.key);
        await loadType(type);
        showCardFeedback(type.key, `${type.label} value added.`, 'success');
      } catch (error) {
        showCardFeedback(type.key, error.message || `Unable to add ${type.label.toLowerCase()} value.`, 'error');
      }
    });
  });

  grid.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const saveLinkBtn = target.closest('[data-voyage-config-save-link]');
    if (saveLinkBtn) {
      const typeKey = text(saveLinkBtn.getAttribute('data-voyage-config-save-link'));
      const id = Number(saveLinkBtn.getAttribute('data-id'));
      const type = CONFIG_TYPES.find((item) => item.key === typeKey);
      if (!type?.linkedPort || !Number.isInteger(id) || id <= 0) return;

      const select = grid.querySelector(`[data-voyage-config-linked-port="${type.key}"][data-id="${id}"]`);
      const items = state.itemsByType.get(type.key) || [];
      const current = items.find((item) => Number(item.id) === id);
      const linkedPort = select instanceof HTMLSelectElement ? text(select.value) : '';

      void (async () => {
        try {
          await updateVoyageConfigValue(type.key, id, text(current?.value), null, { linkedPort });
          await loadType(type);
          showCardFeedback(type.key, 'Port link saved and existing voyages updated.', 'success');
        } catch (error) {
          showCardFeedback(type.key, error.message || 'Unable to save port link.', 'error');
        }
      })();
      return;
    }

    const editBtn = target.closest('[data-voyage-config-edit]');
    if (editBtn) {
      const typeKey = text(editBtn.getAttribute('data-voyage-config-edit'));
      const id = Number(editBtn.getAttribute('data-id'));
      const type = CONFIG_TYPES.find((item) => item.key === typeKey);
      if (!type || !Number.isInteger(id) || id <= 0) return;

      const items = state.itemsByType.get(type.key) || [];
      const current = items.find((item) => Number(item.id) === id);
      const nextValue = window.prompt('Update value', text(current?.value));
      if (nextValue === null) return;
      const normalized = text(nextValue);
      if (!normalized) return showCardFeedback(type.key, 'Value cannot be empty.', 'error');

      let numericValue = null;
      const linkedPort = type.linkedPort ? text(current?.linked_port) : '';
      if (type.numeric) {
        const currentNumeric = type.key === 'fish_types' ? Number(current?.unit_price) : 0;
        const numericPrompt = window.prompt(`Update ${type.numeric.label}`, String(Number.isFinite(currentNumeric) ? currentNumeric : 0));
        if (numericPrompt === null) return;
        numericValue = Number(numericPrompt);
        if (!Number.isFinite(numericValue) || numericValue < 0) return showCardFeedback(type.key, `${type.numeric.label} must be >= 0.`, 'error');
      }

      void (async () => {
        try {
          await updateVoyageConfigValue(type.key, id, normalized, numericValue, type.linkedPort ? { linkedPort } : {});
          await loadType(type);
          showCardFeedback(type.key, 'Value updated.', 'success');
        } catch (error) {
          showCardFeedback(type.key, error.message || 'Unable to update value.', 'error');
        }
      })();
      return;
    }

    const deleteBtn = target.closest('[data-voyage-config-delete]');
    if (deleteBtn) {
      const typeKey = text(deleteBtn.getAttribute('data-voyage-config-delete'));
      const id = Number(deleteBtn.getAttribute('data-id'));
      const type = CONFIG_TYPES.find((item) => item.key === typeKey);
      if (!type || !Number.isInteger(id) || id <= 0) return;
      if (!window.confirm('Delete this value?')) return;
      void (async () => {
        try {
          await deleteVoyageConfigValue(type.key, id);
          await loadType(type);
          showCardFeedback(type.key, 'Value deleted.', 'success');
        } catch (error) {
          showCardFeedback(type.key, error.message || 'Unable to delete value.', 'error');
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

