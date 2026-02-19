import {
  cancelVoyage,
  createVoyageLog,
  endVoyage,
  getVoyage,
  getVoyageManifest,
  listVoyageLogs,
  searchEmployees,
  updateVoyageDetails,
  updateVoyageManifest,
  updateVoyageShipStatus
} from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const output = String(value ?? '').trim();
  return output || 'N/A';
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

function formatWhen(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text(value) : date.toLocaleString();
}

function formatGuilders(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 'ƒ 0';
  return `ƒ ${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
}

function parseVoyageId() {
  const query = new URLSearchParams(window.location.search);
  const value = Number(query.get('voyageId') || query.get('id'));
  return Number.isInteger(value) && value > 0 ? value : null;
}

function openModal(id) {
  const target = document.getElementById(id);
  if (!target) return;
  target.classList.remove('hidden');
  target.setAttribute('aria-hidden', 'false');
}

function closeModal(id) {
  const target = document.getElementById(id);
  if (!target) return;
  target.classList.add('hidden');
  target.setAttribute('aria-hidden', 'true');
}

export async function initVoyageDetails(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const heading = document.querySelector(config.headingSelector);
  const fieldList = document.querySelector(config.fieldListSelector);
  const shipStatusControls = document.querySelector(config.shipStatusControlsSelector);
  const shipUnderwayBtn = document.querySelector(config.shipUnderwaySelector);
  const shipInPortBtn = document.querySelector(config.shipInPortSelector);
  const manifestBody = document.querySelector(config.manifestBodySelector);
  const buyTotalText = document.querySelector(config.buyTotalSelector);
  const manifestSaveState = document.querySelector(config.manifestSaveStateSelector);
  const manifestFeedback = document.querySelector(config.manifestFeedbackSelector);
  const openEndVoyageBtn = document.querySelector(config.openEndVoyageButtonSelector);
  const addCargoBtn = document.querySelector(config.addCargoButtonSelector);
  const addCargoForm = document.querySelector(config.addCargoFormSelector);
  const addCargoTypeSelect = document.querySelector(config.addCargoTypeSelector);
  const addLogForm = document.querySelector(config.addLogFormSelector);
  const logList = document.querySelector(config.logListSelector);
  const endForm = document.querySelector(config.endFormSelector);
  const endFeedback = document.querySelector(config.endFeedbackSelector);
  const cargoLostEditor = document.querySelector(config.cargoLostEditorSelector);
  const finaliseHoldBtn = document.querySelector(config.finaliseHoldButtonSelector);
  const cancelHoldBtn = document.querySelector(config.cancelVoyageHoldButtonSelector);
  const breakdownTrueSellUnitPrice = document.querySelector(config.breakdownTrueSellUnitPriceSelector);
  const breakdownRevenue = document.querySelector(config.breakdownRevenueSelector);
  const breakdownCost = document.querySelector(config.breakdownCostSelector);
  const breakdownProfit = document.querySelector(config.breakdownProfitSelector);
  const breakdownCompanyShare = document.querySelector(config.breakdownCompanyShareSelector);
  const breakdownContainer = document.querySelector(config.breakdownContainerSelector);
  const sellMultiplierInput = document.querySelector(config.sellMultiplierSelector);
  const baseSellPriceInput = document.querySelector(config.baseSellPriceSelector);

  const updateFieldForm = document.querySelector(config.updateFieldFormSelector);
  const updateFieldTitle = document.querySelector(config.updateFieldTitleSelector);
  const updateFieldKey = document.querySelector(config.updateFieldKeySelector);
  const updateFieldControls = document.querySelector(config.updateFieldControlsSelector);
  const HOLD_DURATION_MS = 500;

  if (
    !feedback ||
    !heading ||
    !fieldList ||
    !shipStatusControls ||
    !shipUnderwayBtn ||
    !shipInPortBtn ||
    !manifestBody ||
    !buyTotalText ||
    !manifestSaveState ||
    !manifestFeedback ||
    !openEndVoyageBtn ||
    !addCargoBtn ||
    !addCargoForm ||
    !addCargoTypeSelect ||
    !addLogForm ||
    !logList ||
    !endForm ||
    !endFeedback ||
    !cargoLostEditor ||
    !finaliseHoldBtn ||
    !cancelHoldBtn ||
    !breakdownTrueSellUnitPrice ||
    !breakdownRevenue ||
    !breakdownCost ||
    !breakdownProfit ||
    !breakdownCompanyShare ||
    !breakdownContainer ||
    !sellMultiplierInput ||
    !baseSellPriceInput ||
    !updateFieldForm ||
    !updateFieldTitle ||
    !updateFieldKey ||
    !updateFieldControls
  ) {
    return;
  }

  const voyageId = parseVoyageId();
  if (!voyageId) {
    showMessage(feedback, 'Invalid voyage route.', 'error');
    return;
  }

  let detail = null;
  let manifest = [];
  let logs = [];
  const searchCache = new Map();
  let holdTimer = null;
  let holdAnimation = null;
  let activeHoldButton = null;
  let holdStartedAt = 0;
  let holdLock = false;
  let comboboxCleanup = [];
  let manifestSaveFlashTimer = null;
  let manifestSaveRequestId = 0;

  function isOngoing() {
    return String(detail?.voyage?.status || '') === 'ONGOING';
  }

  function canEdit() {
    return Boolean(detail?.permissions?.canEdit) && isOngoing();
  }

  function setInlineMessage(target, message = '', tone = 'error') {
    if (!target) return;
    target.textContent = message;
    target.classList.remove('hidden', 'is-error', 'is-success');
    if (!message) {
      target.classList.add('hidden');
      return;
    }
    target.classList.add(tone === 'success' ? 'is-success' : 'is-error');
  }

  function setManifestSaveState(textValue = '', tone = 'muted') {
    if (manifestSaveFlashTimer) {
      window.clearTimeout(manifestSaveFlashTimer);
      manifestSaveFlashTimer = null;
    }
    manifestSaveState.textContent = textValue;
    manifestSaveState.classList.remove('is-saving', 'is-saved', 'is-error');
    if (!textValue) return;
    if (tone === 'saving') manifestSaveState.classList.add('is-saving');
    if (tone === 'saved') {
      manifestSaveState.classList.add('is-saved');
      manifestSaveFlashTimer = window.setTimeout(() => {
        manifestSaveState.textContent = '';
        manifestSaveState.classList.remove('is-saving', 'is-saved', 'is-error');
      }, 1300);
    }
    if (tone === 'error') manifestSaveState.classList.add('is-error');
  }

  function stopHoldEffect() {
    if (holdTimer) {
      window.clearTimeout(holdTimer);
      holdTimer = null;
    }
    if (holdAnimation) {
      window.cancelAnimationFrame(holdAnimation);
      holdAnimation = null;
    }
    if (activeHoldButton) {
      activeHoldButton.style.setProperty('--hold-pct', '0%');
      activeHoldButton = null;
    }
    holdStartedAt = 0;
    holdLock = false;
  }

  function startHoldAction(button, action, onError) {
    if (!canEdit() || holdLock) return;
    stopHoldEffect();
    holdLock = true;
    activeHoldButton = button;
    holdStartedAt = Date.now();
    const tick = () => {
      const pct = Math.min(1, (Date.now() - holdStartedAt) / HOLD_DURATION_MS);
      button.style.setProperty('--hold-pct', `${Math.floor(pct * 100)}%`);
      if (pct < 1) holdAnimation = window.requestAnimationFrame(tick);
    };
    holdAnimation = window.requestAnimationFrame(tick);
    holdTimer = window.setTimeout(async () => {
      stopHoldEffect();
      try {
        await action();
      } catch (error) {
        if (typeof onError === 'function') onError(error);
        else showMessage(feedback, error.message || 'Action failed.', 'error');
      }
    }, HOLD_DURATION_MS);
  }

  function bindHoldButton(button, action, onError) {
    const start = () => startHoldAction(button, action, onError);
    const end = () => stopHoldEffect();
    button.addEventListener('pointerdown', start);
    ['pointerup', 'pointerleave', 'pointercancel'].forEach((eventName) => button.addEventListener(eventName, end));
  }

  async function lookupEmployees(mode, query) {
    const clean = normalize(query);
    if (!clean) return [];
    const key = `${mode}:${clean}`;
    if (searchCache.has(key)) return searchCache.get(key);
    const payload = await searchEmployees(mode === 'username' ? { username: clean, limit: 12 } : { serial: clean, limit: 12 });
    const rows = payload.employees || [];
    searchCache.set(key, rows);
    return rows;
  }

  function clearComboboxCleanup() {
    comboboxCleanup.forEach((fn) => fn());
    comboboxCleanup = [];
  }

  function readLossMap() {
    const lossMap = new Map();
    cargoLostEditor.querySelectorAll('[data-loss-cargo-id]').forEach((input) => {
      const cargoId = Number(input.getAttribute('data-loss-cargo-id'));
      const raw = Number(input.value || 0);
      const normalized = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
      lossMap.set(cargoId, normalized);
    });
    return lossMap;
  }

  function buildBreakdown() {
    const lines = manifest.map((line) => {
      const row = manifestBody.querySelector(`tr[data-cargo-id="${Number(line.cargo_type_id)}"]`);
      const quantityValue = row?.querySelector('input[data-field="quantity"]')?.value;
      const buyPriceValue = row?.querySelector('input[data-field="buyPrice"]')?.value;
      const quantity = Math.max(0, Math.floor(Number(quantityValue ?? line.quantity ?? 0)));
      const buyPrice = Math.max(0, Number(buyPriceValue ?? line.buy_price ?? 0));
      return { line, quantity, buyPrice };
    });
    const totalCost = toMoney(lines.reduce((sum, row) => sum + row.quantity * row.buyPrice, 0));
    const sellMultiplier = toNumber(sellMultiplierInput.value);
    const baseSellPrice = toNumber(baseSellPriceInput.value);
    const lossMap = readLossMap();

    return {
      totalCost,
      sellMultiplier,
      baseSellPrice,
      lossMap,
      lines
    };
  }

  function syncBreakdown() {
    const { totalCost, sellMultiplier, baseSellPrice, lossMap, lines } = buildBreakdown();
    buyTotalText.textContent = formatGuilders(totalCost);

    if (sellMultiplier === null || baseSellPrice === null) {
      breakdownTrueSellUnitPrice.textContent = '—';
      breakdownRevenue.textContent = '—';
      breakdownCost.textContent = formatGuilders(totalCost);
      breakdownProfit.textContent = '—';
      breakdownCompanyShare.textContent = '—';
      breakdownContainer.classList.add('hidden');
      return;
    }

    if (sellMultiplier < 0 || baseSellPrice < 0) {
      breakdownTrueSellUnitPrice.textContent = '—';
      breakdownRevenue.textContent = '—';
      breakdownCost.textContent = formatGuilders(totalCost);
      breakdownProfit.textContent = '—';
      breakdownCompanyShare.textContent = '—';
      breakdownContainer.classList.add('hidden');
      return;
    }

    const trueSellUnitPrice = toMoney(sellMultiplier * baseSellPrice);
    const totalRevenue = toMoney(
      lines.reduce((sum, row) => {
        const lost = Math.min(row.quantity, Math.max(0, Number(lossMap.get(Number(row.line.cargo_type_id)) || 0)));
        const netQty = Math.max(row.quantity - lost, 0);
        return sum + trueSellUnitPrice * netQty;
      }, 0)
    );
    const profit = toMoney(totalRevenue - totalCost);
    const companyShare = toMoney(Math.max(profit, 0) * 0.1);

    breakdownContainer.classList.remove('hidden');
    breakdownTrueSellUnitPrice.textContent = formatGuilders(trueSellUnitPrice);
    breakdownRevenue.textContent = formatGuilders(totalRevenue);
    breakdownCost.textContent = formatGuilders(totalCost);
    breakdownProfit.textContent = formatGuilders(profit);
    breakdownCompanyShare.textContent = formatGuilders(companyShare);
  }

  function renderStatusControls() {
    if (!isOngoing()) {
      shipStatusControls.classList.add('hidden');
      return;
    }
    shipStatusControls.classList.remove('hidden');
    const underway = String(detail.voyage.ship_status || 'IN_PORT') === 'UNDERWAY';
    shipUnderwayBtn.disabled = !canEdit() || underway;
    shipInPortBtn.disabled = !canEdit() || !underway;
  }

  function renderFieldList() {
    const voyage = detail.voyage;
    const crewNames = (detail.crew || []).map((entry) => text(entry.roblox_username)).join(', ') || 'N/A';
    const rows = [
      { key: 'departurePort', label: 'Port of Departure', value: text(voyage.departure_port), area: 'departure' },
      { key: 'destinationPort', label: 'Port of Destination', value: text(voyage.destination_port), area: 'destination' },
      { key: 'vesselName', label: 'Vessel Name', value: text(voyage.vessel_name), area: 'vessel-name' },
      { key: 'vesselClass', label: 'Vessel Class', value: text(voyage.vessel_class), area: 'vessel-class' },
      { key: 'vesselCallsign', label: 'Vessel Callsign', value: text(voyage.vessel_callsign), area: 'vessel-callsign' },
      { key: 'officerOfWatchEmployeeId', label: 'Officer of the Watch', value: text(voyage.officer_name), area: 'oow' },
      { key: 'crewComplementIds', label: 'Crew Complement', value: crewNames, area: 'crew' },
      { key: 'status', label: 'Voyage State', value: text(voyage.status), area: 'state' },
      { key: 'startedAt', label: 'Started', value: formatWhen(voyage.started_at), area: 'started' },
      { key: 'endedAt', label: 'Ended', value: voyage.status === 'ENDED' ? formatWhen(voyage.ended_at) : 'N/A', area: 'ended' }
    ];

    const editableKeys = new Set(['departurePort', 'destinationPort', 'vesselName', 'vesselClass', 'vesselCallsign', 'officerOfWatchEmployeeId', 'crewComplementIds']);

    fieldList.innerHTML = `<div class="voyage-profile-grid">${rows
      .map(
        (row) => `<div class="voyage-field-row voyage-field-row-${row.area}">
          <div>
            <p class="voyage-field-label">${row.label}</p>
            <p class="voyage-field-value">${row.value}</p>
          </div>
          ${
            canEdit() && editableKeys.has(row.key)
              ? `<button class="btn btn-secondary btn-pencil" type="button" data-edit-field="${row.key}" aria-label="Edit ${row.label}">✏</button>`
              : ''
          }
        </div>`
      )
      .join('')}</div>`;

    fieldList.querySelectorAll('[data-edit-field]').forEach((button) => {
      button.addEventListener('click', () => {
        const key = button.getAttribute('data-edit-field');
        if (key) openFieldModal(key);
      });
    });
  }

  function renderManifest() {
    manifestBody.innerHTML = manifest
      .map(
        (line) => `<tr data-cargo-id="${line.cargo_type_id}">
          <td>${text(line.cargo_name)}</td>
          <td><input data-field="quantity" type="number" min="0" step="1" value="${Number(line.quantity || 0)}" ${canEdit() ? '' : 'disabled'} /></td>
          <td><input data-field="buyPrice" type="number" min="0" step="0.01" value="${Number(line.buy_price || 0)}" ${canEdit() ? '' : 'disabled'} /></td>
          <td>${formatGuilders(line.line_total)}</td>
          <td>${canEdit() ? `<button class="btn btn-secondary" type="button" data-remove-line="${line.cargo_type_id}">Remove</button>` : '-'}</td>
        </tr>`
      )
      .join('');

    manifestBody.querySelectorAll('[data-remove-line]').forEach((button) => {
      button.addEventListener('click', () => {
        const cargoId = Number(button.getAttribute('data-remove-line'));
        manifest = manifest.filter((line) => Number(line.cargo_type_id) !== cargoId);
        renderManifest();
        renderCargoLostEditor();
        syncBreakdown();
        queueManifestAutoSave();
      });
    });

    manifestBody.querySelectorAll('tr[data-cargo-id]').forEach((row) => {
      const quantityInput = row.querySelector('input[data-field="quantity"]');
      const buyPriceInput = row.querySelector('input[data-field="buyPrice"]');
      const lineTotalCell = row.querySelector('td:nth-child(4)');
      const refreshRow = () => {
        const quantity = Math.max(0, Math.floor(Number(quantityInput?.value || 0)));
        const buyPrice = Math.max(0, Number(buyPriceInput?.value || 0));
        if (quantityInput && String(quantityInput.value) !== String(quantity)) quantityInput.value = String(quantity);
        if (lineTotalCell) lineTotalCell.textContent = formatGuilders(toMoney(quantity * buyPrice));
        syncBreakdown();
        queueManifestAutoSave();
      };
      quantityInput?.addEventListener('input', refreshRow);
      buyPriceInput?.addEventListener('input', refreshRow);
    });

    addCargoBtn.classList.toggle('hidden', !canEdit());
    syncBreakdown();
  }

  function clearManifestFieldErrors() {
    manifestFeedback.classList.add('hidden');
    manifestBody.querySelectorAll('.field-error').forEach((el) => el.classList.remove('field-error'));
    manifestBody.querySelectorAll('.row-error').forEach((el) => el.classList.remove('row-error'));
  }

  function collectManifestLinesFromDom() {
    return [...manifestBody.querySelectorAll('tr[data-cargo-id]')].map((row) => {
      const qtyInput = row.querySelector('input[data-field="quantity"]');
      const priceInput = row.querySelector('input[data-field="buyPrice"]');
      const quantity = Number(qtyInput?.value || 0);
      const buyPrice = Number(priceInput?.value || 0);
      return {
        row,
        qtyInput,
        priceInput,
        cargoTypeId: Number(row.getAttribute('data-cargo-id')),
        quantity,
        buyPrice
      };
    });
  }

  function validateManifestRows(rows) {
    clearManifestFieldErrors();
    for (const item of rows) {
      if (!Number.isInteger(item.quantity) || item.quantity < 0) {
        item.row.classList.add('row-error');
        item.qtyInput?.classList.add('field-error');
        setInlineMessage(manifestFeedback, 'Quantity must be a whole number >= 0.');
        return false;
      }
      if (!Number.isFinite(item.buyPrice) || item.buyPrice < 0) {
        item.row.classList.add('row-error');
        item.priceInput?.classList.add('field-error');
        setInlineMessage(manifestFeedback, 'Buy price must be a number >= 0.');
        return false;
      }
      if (item.quantity > 0 && !Number.isFinite(item.buyPrice)) {
        item.row.classList.add('row-error');
        item.priceInput?.classList.add('field-error');
        setInlineMessage(manifestFeedback, 'Buy price is required when quantity > 0.');
        return false;
      }
    }
    setInlineMessage(manifestFeedback, '');
    return true;
  }

  async function persistManifestNow() {
    if (!canEdit()) return;
    const rows = collectManifestLinesFromDom();
    if (!validateManifestRows(rows)) {
      setManifestSaveState('Error', 'error');
      return;
    }
    const lines = rows.map((item) => ({
      cargoTypeId: item.cargoTypeId,
      quantity: item.quantity,
      buyPrice: item.buyPrice
    }));
    const requestId = ++manifestSaveRequestId;
    setManifestSaveState('Saving...', 'saving');
    try {
      const payload = await updateVoyageManifest(voyageId, lines);
      if (requestId !== manifestSaveRequestId) return;
      manifest = payload.manifest || manifest;
      renderManifest();
      renderCargoLostEditor();
      setInlineMessage(manifestFeedback, '');
      setManifestSaveState('Saved', 'saved');
    } catch (error) {
      if (requestId !== manifestSaveRequestId) return;
      setInlineMessage(manifestFeedback, error.message || 'Unable to save manifest.');
      setManifestSaveState('Error', 'error');
    }
  }

  const queueManifestAutoSave = debounce(() => {
    persistManifestNow();
  }, 420);

  function renderCargoLostEditor() {
    cargoLostEditor.innerHTML = manifest
      .map(
        (line) => `<div>
          <label>${text(line.cargo_name)} (max ${Number(line.quantity || 0)})</label>
          <input type="number" min="0" max="${Number(line.quantity || 0)}" step="1" data-loss-cargo-id="${line.cargo_type_id}" value="0" ${canEdit() ? '' : 'disabled'} />
        </div>`
      )
      .join('');

    cargoLostEditor.querySelectorAll('[data-loss-cargo-id]').forEach((input) => {
      input.addEventListener('input', () => {
        const max = Math.max(0, Math.floor(Number(input.getAttribute('max') || 0)));
        const raw = Number(input.value || 0);
        let normalized = Number.isFinite(raw) ? Math.floor(raw) : 0;
        normalized = Math.max(0, Math.min(max, normalized));
        if (String(normalized) !== String(input.value)) input.value = String(normalized);
        syncBreakdown();
      });
    });
  }

  function renderLogs() {
    if (!logs.length) {
      logList.innerHTML = '<li class="role-item"><span class="role-id">No ship log entries yet.</span></li>';
      return;
    }
    logList.innerHTML = logs
      .map(
        (entry) => `<li class="role-item">
          <span class="role-id">${formatWhen(entry.created_at)} | ${text(entry.author_name)} | ${
            String(entry.log_type || 'manual') === 'system' ? '[System] ' : ''
          }${text(entry.message)}</span>
        </li>`
      )
      .join('');
  }

  async function loadSummary() {
    detail = await getVoyage(voyageId, { includeSetup: true, includeManifest: false, includeLogs: false });
    heading.textContent = `${text(detail.voyage.vessel_name)} | ${text(detail.voyage.vessel_callsign)} | ${text(detail.voyage.status)}`;
    renderStatusControls();
    renderFieldList();
    const ongoing = isOngoing();
    openEndVoyageBtn.classList.toggle('hidden', !(detail.permissions?.canEnd && ongoing));
    addLogForm.classList.toggle('hidden', !(detail.permissions?.canEdit && ongoing));
    const cargoTypes = detail.voyageConfig?.cargoTypes || [];
    addCargoTypeSelect.innerHTML = ['<option value="">Select cargo type</option>', ...cargoTypes.map((item) => `<option value="${item.id}">${item.name}</option>`)].join('');
    if (!ongoing) {
      finaliseHoldBtn.disabled = true;
      cancelHoldBtn.disabled = true;
      closeModal('endVoyageModal');
    } else {
      finaliseHoldBtn.disabled = !detail.permissions?.canEnd;
      cancelHoldBtn.disabled = !detail.permissions?.canEnd;
    }
  }

  async function loadManifest() {
    const payload = await getVoyageManifest(voyageId);
    manifest = payload.manifest || [];
    setManifestSaveState('');
    setInlineMessage(manifestFeedback, '');
    renderManifest();
    renderCargoLostEditor();
  }

  async function loadLogs() {
    const payload = await listVoyageLogs(voyageId, { page: 1, pageSize: 120 });
    logs = payload.logs || [];
    renderLogs();
  }

  function setupEmployeeCombobox({ input, results, onSearch, onSelect, errorTarget }) {
    let options = [];
    let activeIndex = -1;

    function closeList() {
      options = [];
      activeIndex = -1;
      results.classList.remove('is-open');
      results.innerHTML = '';
    }

    function renderList() {
      if (!options.length) {
        closeList();
        return;
      }
      results.classList.add('is-open');
      results.innerHTML = options
        .map(
          (row, index) => `<button class="autocomplete-item ${index === activeIndex ? 'is-active' : ''}" type="button" data-pick-id="${row.id}" data-pick-index="${index}">
              <span>${text(row.roblox_username)}</span><small>${text(row.serial_number)}</small>
            </button>`
        )
        .join('');
      results.querySelectorAll('[data-pick-index]').forEach((button) => {
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => {
          const index = Number(button.getAttribute('data-pick-index'));
          const picked = options[index];
          if (!picked) return;
          onSelect(picked);
          closeList();
        });
      });
    }

    const runSearch = debounce(async () => {
      const query = String(input.value || '').trim();
      if (!query) {
        setInlineMessage(errorTarget, '');
        closeList();
        return;
      }
      try {
        options = await onSearch(query);
        setInlineMessage(errorTarget, '');
        activeIndex = options.length ? 0 : -1;
        renderList();
      } catch (error) {
        closeList();
        setInlineMessage(errorTarget, error.message || 'Search failed.');
      }
    }, 260);

    const onKeyDown = (event) => {
      if (!options.length) {
        if (event.key === 'Escape') closeList();
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        activeIndex = (activeIndex + 1) % options.length;
        renderList();
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        activeIndex = activeIndex <= 0 ? options.length - 1 : activeIndex - 1;
        renderList();
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        const picked = options[activeIndex];
        if (!picked) return;
        onSelect(picked);
        closeList();
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        closeList();
      }
    };

    const onOutside = (event) => {
      const target = event.target;
      if (target instanceof Node && (input.contains(target) || results.contains(target))) return;
      closeList();
    };

    input.addEventListener('focus', runSearch);
    input.addEventListener('input', runSearch);
    input.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onOutside);

    comboboxCleanup.push(() => {
      input.removeEventListener('focus', runSearch);
      input.removeEventListener('input', runSearch);
      input.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onOutside);
    });
  }

  function openFieldModal(fieldKey) {
    clearComboboxCleanup();
    updateFieldKey.value = fieldKey;
    const voyage = detail.voyage;
    const ports = detail.voyageConfig?.ports || [];
    const vesselNames = detail.voyageConfig?.vesselNames || [];
    const vesselClasses = detail.voyageConfig?.vesselClasses || [];
    const vesselCallsigns = detail.voyageConfig?.vesselCallsigns || [];

    if (fieldKey === 'departurePort' || fieldKey === 'destinationPort') {
      const current = fieldKey === 'departurePort' ? voyage.departure_port : voyage.destination_port;
      updateFieldTitle.textContent = fieldKey === 'departurePort' ? 'Update Port of Departure' : 'Update Port of Destination';
      updateFieldControls.innerHTML = `<label>Port</label><select name="value">${ports
        .map((entry) => `<option value="${entry.value}" ${entry.value === current ? 'selected' : ''}>${entry.value}</option>`)
        .join('')}</select>`;
    } else if (fieldKey === 'vesselName' || fieldKey === 'vesselClass' || fieldKey === 'vesselCallsign') {
      const map = {
        vesselName: { title: 'Update Vessel Name', current: voyage.vessel_name, items: vesselNames },
        vesselClass: { title: 'Update Vessel Class', current: voyage.vessel_class, items: vesselClasses },
        vesselCallsign: { title: 'Update Vessel Callsign', current: voyage.vessel_callsign, items: vesselCallsigns }
      };
      const info = map[fieldKey];
      updateFieldTitle.textContent = info.title;
      updateFieldControls.innerHTML = `<label>Value</label><select name="value">${info.items
        .map((entry) => `<option value="${entry.value}" ${entry.value === info.current ? 'selected' : ''}>${entry.value}</option>`)
        .join('')}</select>`;
    } else if (fieldKey === 'officerOfWatchEmployeeId') {
      updateFieldTitle.textContent = 'Update Officer of the Watch';
      updateFieldControls.innerHTML = `
        <label>Search Roblox Username</label>
        <div class="combobox-wrap">
          <input id="pickerOowSearch" type="text" autocomplete="off" placeholder="Type username..." />
          <div id="pickerOowResults" class="autocomplete-list"></div>
        </div>
        <div id="pickerOowError" class="inline-feedback hidden"></div>
        <input id="pickerOowSelectedId" type="hidden" value="${voyage.officer_of_watch_employee_id}" />
        <p id="pickerOowSelected" class="muted">Selected: ${text(voyage.officer_name)}</p>`;
      const search = updateFieldControls.querySelector('#pickerOowSearch');
      const results = updateFieldControls.querySelector('#pickerOowResults');
      const error = updateFieldControls.querySelector('#pickerOowError');
      const selectedId = updateFieldControls.querySelector('#pickerOowSelectedId');
      const selectedText = updateFieldControls.querySelector('#pickerOowSelected');

      setupEmployeeCombobox({
        input: search,
        results,
        onSearch: (query) => lookupEmployees('username', query),
        onSelect: (row) => {
          const id = Number(row.id);
          selectedId.value = String(id);
          selectedText.textContent = `Selected: ${text(row.roblox_username || `#${id}`)}`;
          search.value = '';
        },
        errorTarget: error
      });
    } else if (fieldKey === 'crewComplementIds') {
      updateFieldTitle.textContent = 'Update Crew Complement';
      const selectedCrew = new Set((detail.crew || []).map((row) => Number(row.id)));
      const oowId = Number(detail.voyage.officer_of_watch_employee_id || 0);
      updateFieldControls.innerHTML = `
        <label>Search Roblox Username</label>
        <div class="combobox-wrap combobox-wrap-multi">
          <div id="pickerCrewSelected" class="pill-list"></div>
          <input id="pickerCrewSearch" type="text" autocomplete="off" placeholder="Type username..." />
          <div id="pickerCrewResults" class="autocomplete-list"></div>
        </div>`;
      updateFieldControls.insertAdjacentHTML('beforeend', '<div id="pickerCrewError" class="inline-feedback hidden"></div>');
      const search = updateFieldControls.querySelector('#pickerCrewSearch');
      const results = updateFieldControls.querySelector('#pickerCrewResults');
      const selected = updateFieldControls.querySelector('#pickerCrewSelected');
      const error = updateFieldControls.querySelector('#pickerCrewError');

      const renderSelected = () => {
        updateFieldControls.setAttribute('data-crew-values', JSON.stringify([...selectedCrew]));
        if (!selectedCrew.size) {
          selected.innerHTML = '<span class="muted">No crew selected.</span>';
          return;
        }
        selected.innerHTML = [...selectedCrew]
          .map((id) => {
            const employee = (detail.employees || []).find((row) => Number(row.id) === id);
            return `<span class="pill">${text(employee?.roblox_username || `#${id}`)} <button class="pill-close" type="button" data-remove-id="${id}">x</button></span>`;
          })
          .join('');
        selected.querySelectorAll('[data-remove-id]').forEach((button) => {
          button.addEventListener('click', () => {
            const id = Number(button.getAttribute('data-remove-id'));
            selectedCrew.delete(id);
            renderSelected();
          });
        });
      };

      setupEmployeeCombobox({
        input: search,
        results,
        onSearch: async (query) =>
          (await lookupEmployees('username', query))
            .filter((row) => Number(row.id) !== oowId)
            .filter((row) => !selectedCrew.has(Number(row.id))),
        onSelect: (row) => {
          const id = Number(row.id);
          selectedCrew.add(id);
          search.value = '';
          renderSelected();
        },
        errorTarget: error
      });
      renderSelected();
    }

    openModal('updateFieldModal');
  }

  async function saveFieldModal() {
    const fieldKey = String(updateFieldKey.value || '').trim();
    if (!fieldKey) return;
    const payload = {};
    if (fieldKey === 'departurePort') payload.departurePort = String(updateFieldControls.querySelector('[name="value"]')?.value || '');
    if (fieldKey === 'destinationPort') payload.destinationPort = String(updateFieldControls.querySelector('[name="value"]')?.value || '');
    if (fieldKey === 'vesselName') payload.vesselName = String(updateFieldControls.querySelector('[name="value"]')?.value || '');
    if (fieldKey === 'vesselClass') payload.vesselClass = String(updateFieldControls.querySelector('[name="value"]')?.value || '');
    if (fieldKey === 'vesselCallsign') payload.vesselCallsign = String(updateFieldControls.querySelector('[name="value"]')?.value || '');
    if (fieldKey === 'officerOfWatchEmployeeId') payload.officerOfWatchEmployeeId = Number(updateFieldControls.querySelector('#pickerOowSelectedId')?.value || 0);
    if (fieldKey === 'crewComplementIds') payload.crewComplementIds = JSON.parse(String(updateFieldControls.getAttribute('data-crew-values') || '[]'));

    await updateVoyageDetails(voyageId, payload);
    clearComboboxCleanup();
    closeModal('updateFieldModal');
    await Promise.all([loadSummary(), loadLogs()]);
    showMessage(feedback, 'Voyage profile updated.', 'success');
  }

  updateFieldForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await saveFieldModal();
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to update field.', 'error');
    }
  });

  shipUnderwayBtn.addEventListener('click', async () => {
    if (!canEdit()) return;
    try {
      await updateVoyageShipStatus(voyageId, 'UNDERWAY');
      detail.voyage.ship_status = 'UNDERWAY';
      renderStatusControls();
      renderFieldList();
      await loadLogs();
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to update ship status.', 'error');
    }
  });

  shipInPortBtn.addEventListener('click', async () => {
    if (!canEdit()) return;
    try {
      await updateVoyageShipStatus(voyageId, 'IN_PORT');
      detail.voyage.ship_status = 'IN_PORT';
      renderStatusControls();
      renderFieldList();
      await loadLogs();
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to update ship status.', 'error');
    }
  });

  addCargoBtn.addEventListener('click', () => openModal('addCargoModal'));
  addCargoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(addCargoForm);
    const cargoTypeId = Number(data.get('cargoTypeId'));
    const quantity = Math.max(0, Math.floor(Number(data.get('quantity'))));
    const buyPrice = Math.max(0, Number(data.get('buyPrice')));
    if (!Number.isInteger(cargoTypeId) || cargoTypeId <= 0) {
      setInlineMessage(manifestFeedback, 'Select a cargo type before adding a line.');
      return;
    }
    const cargoType = (detail.voyageConfig?.cargoTypes || []).find((row) => Number(row.id) === cargoTypeId);
    const next = {
      cargo_type_id: cargoTypeId,
      cargo_name: cargoType?.name || `Cargo #${cargoTypeId}`,
      quantity,
      buy_price: buyPrice,
      line_total: quantity * buyPrice
    };
    const exists = manifest.some((line) => Number(line.cargo_type_id) === cargoTypeId);
    manifest = exists ? manifest.map((line) => (Number(line.cargo_type_id) === cargoTypeId ? next : line)) : [...manifest, next];
    renderManifest();
    renderCargoLostEditor();
    closeModal('addCargoModal');
    addCargoForm.reset();
    queueManifestAutoSave();
  });

  addLogForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(addLogForm);
    const message = String(data.get('message') || '').trim();
    if (!message) return;
    try {
      await createVoyageLog(voyageId, message);
      addLogForm.reset();
      await loadLogs();
      showMessage(feedback, 'Ship log entry added.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to add ship log entry.', 'error');
    }
  });

  openEndVoyageBtn.addEventListener('click', () => {
    if (!detail?.permissions?.canEnd || !isOngoing()) return;
    setInlineMessage(endFeedback, '');
    syncBreakdown();
    openModal('endVoyageModal');
  });

  bindHoldButton(finaliseHoldBtn, async () => {
    const data = new FormData(endForm);
    const sellMultiplier = Number(data.get('sellMultiplier') || 0);
    const baseSellPrice = Number(data.get('baseSellPrice') || 0);
    if (!Number.isFinite(sellMultiplier) || sellMultiplier < 0) throw new Error('Sell multiplier must be >= 0.');
    if (!Number.isFinite(baseSellPrice) || baseSellPrice < 0) throw new Error('Base sell price must be >= 0.');

    const lines = [...manifestBody.querySelectorAll('tr[data-cargo-id]')].map((row) => ({
      cargoTypeId: Number(row.getAttribute('data-cargo-id')),
      quantity: Math.max(0, Math.floor(Number(row.querySelector('input[data-field="quantity"]')?.value || 0))),
      buyPrice: Math.max(0, Number(row.querySelector('input[data-field="buyPrice"]')?.value || 0))
    }));
    await updateVoyageManifest(voyageId, lines);

    const manifestQtyByCargo = new Map(lines.map((line) => [Number(line.cargoTypeId), Number(line.quantity)]));
    const cargoLost = [...cargoLostEditor.querySelectorAll('[data-loss-cargo-id]')]
      .map((input) => ({
        cargoTypeId: Number(input.getAttribute('data-loss-cargo-id')),
        lostQuantity: Math.max(0, Math.floor(Number(input.value || 0)))
      }))
      .filter((entry) => manifestQtyByCargo.has(Number(entry.cargoTypeId)))
      .map((entry) => ({
        cargoTypeId: entry.cargoTypeId,
        lostQuantity: Math.min(entry.lostQuantity, manifestQtyByCargo.get(Number(entry.cargoTypeId)) || 0)
      }));

    await endVoyage(voyageId, {
      sellMultiplier,
      baseSellPrice,
      cargoLost
    });
    setInlineMessage(endFeedback, '');
    closeModal('endVoyageModal');
    await Promise.all([loadSummary(), loadManifest(), loadLogs()]);
    showMessage(feedback, 'Voyage finalized and archived.', 'success');
  }, (error) => setInlineMessage(endFeedback, error.message || 'Unable to submit voyage.'));

  bindHoldButton(cancelHoldBtn, async () => {
    await cancelVoyage(voyageId);
    window.location.href = 'voyage-tracker.html';
  }, (error) => setInlineMessage(endFeedback, error.message || 'Unable to cancel voyage.'));

  [sellMultiplierInput, baseSellPriceInput].forEach((input) => {
    input.addEventListener('input', syncBreakdown);
  });

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modalId = button.getAttribute('data-close-modal');
      if (modalId === 'updateFieldModal') clearComboboxCleanup();
      if (modalId === 'endVoyageModal') setInlineMessage(endFeedback, '');
      if (modalId) closeModal(modalId);
    });
  });

  try {
    await Promise.all([loadSummary(), loadManifest(), loadLogs()]);
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load voyage details.', 'error');
  }
}
