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
  return `ƒ ${Math.round(num).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function toMoney(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num);
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
  const profileFeedback = document.querySelector(config.profileFeedbackSelector);
  const profileEditToggleBtn = document.querySelector(config.profileEditToggleSelector);
  const shipStatusControls = document.querySelector(config.shipStatusControlsSelector);
  const shipStatusToggle = document.querySelector(config.shipStatusToggleSelector);
  const manifestBody = document.querySelector(config.manifestBodySelector);
  const buyTotalText = document.querySelector(config.buyTotalSelector);
  const archivedBreakdownSection = document.querySelector(config.archivedBreakdownSectionSelector);
  const archivedBreakdownFreight = document.querySelector(config.archivedBreakdownFreightSelector);
  const archivedBreakdownRevenue = document.querySelector(config.archivedBreakdownRevenueSelector);
  const archivedBreakdownCost = document.querySelector(config.archivedBreakdownCostSelector);
  const archivedBreakdownProfit = document.querySelector(config.archivedBreakdownProfitSelector);
  const archivedBreakdownCompanyShare = document.querySelector(config.archivedBreakdownCompanyShareSelector);
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
  const editVoyageForm = document.querySelector(config.editVoyageFormSelector);
  const editVoyageFeedback = document.querySelector(config.editVoyageFeedbackSelector);
  const editDepartureSelect = document.querySelector(config.editDepartureSelector);
  const editDestinationSelect = document.querySelector(config.editDestinationSelector);
  const editVesselNameSelect = document.querySelector(config.editVesselNameSelector);
  const editVesselClassSelect = document.querySelector(config.editVesselClassSelector);
  const editVesselCallsignSelect = document.querySelector(config.editVesselCallsignSelector);
  const editOowSearch = document.querySelector(config.editOowSearchSelector);
  const editOowResults = document.querySelector(config.editOowResultsSelector);
  const editOowSelected = document.querySelector(config.editOowSelectedSelector);
  const editOowError = document.querySelector(config.editOowErrorSelector);
  const editCrewSearch = document.querySelector(config.editCrewSearchSelector);
  const editCrewResults = document.querySelector(config.editCrewResultsSelector);
  const editCrewSelected = document.querySelector(config.editCrewSelectedSelector);
  const editCrewInfo = document.querySelector(config.editCrewInfoSelector);
  const editCrewError = document.querySelector(config.editCrewErrorSelector);
  const saveEditVoyageBtn = document.querySelector(config.saveEditVoyageButtonSelector);
  const HOLD_DURATION_MS = 500;

  if (
    !feedback ||
    !heading ||
    !fieldList ||
    !profileFeedback ||
    !profileEditToggleBtn ||
    !shipStatusControls ||
    !shipStatusToggle ||
    !manifestBody ||
    !buyTotalText ||
    !archivedBreakdownSection ||
    !archivedBreakdownFreight ||
    !archivedBreakdownRevenue ||
    !archivedBreakdownCost ||
    !archivedBreakdownProfit ||
    !archivedBreakdownCompanyShare ||
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
    !editVoyageForm ||
    !editVoyageFeedback ||
    !editDepartureSelect ||
    !editDestinationSelect ||
    !editVesselNameSelect ||
    !editVesselClassSelect ||
    !editVesselCallsignSelect ||
    !editOowSearch ||
    !editOowResults ||
    !editOowSelected ||
    !editOowError ||
    !editCrewSearch ||
    !editCrewResults ||
    !editCrewSelected ||
    !editCrewInfo ||
    !editCrewError ||
    !saveEditVoyageBtn
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
  let editState = null;

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
        const revenueLine = toMoney(trueSellUnitPrice * netQty);
        return sum + revenueLine;
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
    shipStatusToggle.checked = underway;
    shipStatusToggle.disabled = !canEdit();
  }

  function renderArchivedBreakdown() {
    if (!detail?.voyage) return;
    const ended = String(detail.voyage.status || '') === 'ENDED';
    archivedBreakdownSection.classList.toggle('hidden', !ended);
    if (!ended) return;
    const totalCost = toMoney(detail.voyage.buy_total ?? detail.buyTotal ?? 0);
    const totalRevenue = toMoney(detail.voyage.effective_sell ?? 0);
    const profit = toMoney(detail.voyage.profit ?? totalRevenue - totalCost);
    const companyShare = toMoney(detail.voyage.company_share ?? Math.max(profit, 0) * 0.1);
    archivedBreakdownFreight.textContent = formatGuilders(totalCost);
    archivedBreakdownRevenue.textContent = formatGuilders(totalRevenue);
    archivedBreakdownCost.textContent = formatGuilders(totalCost);
    archivedBreakdownProfit.textContent = formatGuilders(profit);
    archivedBreakdownCompanyShare.textContent = formatGuilders(companyShare);
  }

  function toOptions(items, value) {
    return items
      .map((entry) => {
        const selected = String(entry.value) === String(value) ? 'selected' : '';
        return `<option value="${entry.value}" ${selected}>${entry.value}</option>`;
      })
      .join('');
  }

  function renderProfileReadOnly() {
    const voyage = detail.voyage;
    const crewNames = (detail.crew || []).map((entry) => text(entry.roblox_username)).join(', ') || 'N/A';
    const rows = [
      { label: 'Started', value: formatWhen(voyage.started_at), area: 'started' },
      { label: 'Ended', value: voyage.status === 'ENDED' ? formatWhen(voyage.ended_at) : 'N/A', area: 'ended' },
      { label: 'Port of Departure', value: text(voyage.departure_port), area: 'departure' },
      { label: 'Port of Destination', value: text(voyage.destination_port), area: 'destination' },
      { label: 'Vessel Name', value: text(voyage.vessel_name), area: 'vessel-name' },
      { label: 'Vessel Class', value: text(voyage.vessel_class), area: 'vessel-class' },
      { label: 'Vessel Callsign', value: text(voyage.vessel_callsign), area: 'vessel-callsign' },
      { label: 'Officer of the Watch', value: text(voyage.officer_name), area: 'oow' },
      { label: 'Crew Complement', value: crewNames, area: 'crew' }
    ];
    fieldList.innerHTML = `<div class="voyage-profile-grid">${rows
      .map(
        (row) => `<div class="voyage-field-row voyage-field-row-${row.area}">
          <div>
            <p class="voyage-field-label">${row.label}</p>
            <p class="voyage-field-value">${row.value}</p>
          </div>
        </div>`
      )
      .join('')}</div>`;
  }

  function renderFieldList() {
    renderProfileReadOnly();
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
    profileEditToggleBtn.classList.toggle('hidden', !canEdit());
    renderStatusControls();
    renderFieldList();
    renderArchivedBreakdown();
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
    renderArchivedBreakdown();
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

  function setupEditCrewPills() {
    if (!editState) return;
    if (!editState.crewComplementIds.length) {
      editCrewSelected.innerHTML = '<span class="muted">No crew selected.</span>';
      return;
    }
    editCrewSelected.innerHTML = editState.crewComplementIds
      .map((id) => {
        const employee = (detail.employees || []).find((row) => Number(row.id) === Number(id));
        return `<span class="pill">${text(employee?.roblox_username || `#${id}`)} <button class="pill-close" type="button" data-remove-edit-crew="${id}">x</button></span>`;
      })
      .join('');
    editCrewSelected.querySelectorAll('[data-remove-edit-crew]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = Number(btn.getAttribute('data-remove-edit-crew'));
        editState.crewComplementIds = editState.crewComplementIds.filter((crewId) => crewId !== id);
        setupEditCrewPills();
      });
    });
  }

  function openEditVoyageModal() {
    if (!canEdit()) return;
    clearComboboxCleanup();
    setInlineMessage(editVoyageFeedback, '');
    setInlineMessage(editOowError, '');
    setInlineMessage(editCrewError, '');
    setInlineMessage(editCrewInfo, '');

    editState = {
      departurePort: String(detail?.voyage?.departure_port || ''),
      destinationPort: String(detail?.voyage?.destination_port || ''),
      vesselName: String(detail?.voyage?.vessel_name || ''),
      vesselClass: String(detail?.voyage?.vessel_class || ''),
      vesselCallsign: String(detail?.voyage?.vessel_callsign || ''),
      officerOfWatchEmployeeId: Number(detail?.voyage?.officer_of_watch_employee_id || 0),
      crewComplementIds: (detail?.crew || []).map((row) => Number(row.id))
    };
    editState.crewComplementIds = editState.crewComplementIds.filter((id) => id !== editState.officerOfWatchEmployeeId);

    editDepartureSelect.innerHTML = toOptions(detail.voyageConfig?.ports || [], editState.departurePort);
    editDestinationSelect.innerHTML = toOptions(detail.voyageConfig?.ports || [], editState.destinationPort);
    editVesselNameSelect.innerHTML = toOptions(detail.voyageConfig?.vesselNames || [], editState.vesselName);
    editVesselClassSelect.innerHTML = toOptions(detail.voyageConfig?.vesselClasses || [], editState.vesselClass);
    editVesselCallsignSelect.innerHTML = toOptions(detail.voyageConfig?.vesselCallsigns || [], editState.vesselCallsign);
    editDepartureSelect.value = editState.departurePort;
    editDestinationSelect.value = editState.destinationPort;
    editVesselNameSelect.value = editState.vesselName;
    editVesselClassSelect.value = editState.vesselClass;
    editVesselCallsignSelect.value = editState.vesselCallsign;

    const oowName = (detail.employees || []).find((row) => Number(row.id) === Number(editState.officerOfWatchEmployeeId))?.roblox_username || 'None';
    editOowSelected.textContent = `Selected: ${text(oowName)}`;
    editOowSearch.value = '';
    editCrewSearch.value = '';
    setupEditCrewPills();

    setupEmployeeCombobox({
      input: editOowSearch,
      results: editOowResults,
      onSearch: (query) => lookupEmployees('username', query),
      onSelect: (row) => {
        const id = Number(row.id);
        const username = text(row.roblox_username || `#${id}`);
        editState.officerOfWatchEmployeeId = id;
        if (editState.crewComplementIds.includes(id)) {
          editState.crewComplementIds = editState.crewComplementIds.filter((crewId) => crewId !== id);
          setInlineMessage(editCrewInfo, `Removed ${username} from crew because they are Officer of the Watch.`, 'success');
          setupEditCrewPills();
        }
        editOowSelected.textContent = `Selected: ${username}`;
        editOowSearch.value = '';
      },
      errorTarget: editOowError
    });

    setupEmployeeCombobox({
      input: editCrewSearch,
      results: editCrewResults,
      onSearch: async (query) =>
        (await lookupEmployees('username', query))
          .filter((row) => Number(row.id) !== Number(editState.officerOfWatchEmployeeId))
          .filter((row) => !editState.crewComplementIds.includes(Number(row.id))),
      onSelect: (row) => {
        const id = Number(row.id);
        if (!editState.crewComplementIds.includes(id)) editState.crewComplementIds.push(id);
        editCrewSearch.value = '';
        setInlineMessage(editCrewError, '');
        setInlineMessage(editCrewInfo, '');
        setupEditCrewPills();
      },
      errorTarget: editCrewError
    });

    openModal('editVoyageModal');
  }

  async function submitEditVoyageModal() {
    if (!editState) return;
    const payload = {
      departurePort: String(editDepartureSelect.value || ''),
      destinationPort: String(editDestinationSelect.value || ''),
      vesselName: String(editVesselNameSelect.value || ''),
      vesselClass: String(editVesselClassSelect.value || ''),
      vesselCallsign: String(editVesselCallsignSelect.value || ''),
      officerOfWatchEmployeeId: Number(editState.officerOfWatchEmployeeId || 0),
      crewComplementIds: editState.crewComplementIds.filter((id) => Number(id) !== Number(editState.officerOfWatchEmployeeId))
    };
    if (!payload.departurePort || !payload.destinationPort || !payload.vesselName || !payload.vesselClass || !payload.vesselCallsign) {
      setInlineMessage(editVoyageFeedback, 'All editable fields are required.');
      return;
    }
    if (!Number.isInteger(payload.officerOfWatchEmployeeId) || payload.officerOfWatchEmployeeId <= 0) {
      setInlineMessage(editVoyageFeedback, 'Officer of the Watch is required.');
      return;
    }
    try {
      await updateVoyageDetails(voyageId, payload);
      closeModal('editVoyageModal');
      editState = null;
      clearComboboxCleanup();
      await Promise.all([loadSummary(), loadLogs()]);
      renderFieldList();
    } catch (error) {
      setInlineMessage(editVoyageFeedback, error.message || 'Unable to save voyage details.');
    }
  }

  shipStatusToggle.addEventListener('change', async () => {
    if (!canEdit()) return;
    try {
      const nextStatus = shipStatusToggle.checked ? 'UNDERWAY' : 'IN_PORT';
      await updateVoyageShipStatus(voyageId, nextStatus);
      detail.voyage.ship_status = nextStatus;
      renderStatusControls();
      renderFieldList();
      await loadLogs();
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to update ship status.', 'error');
      renderStatusControls();
    }
  });

  profileEditToggleBtn.addEventListener('click', () => {
    openEditVoyageModal();
  });

  saveEditVoyageBtn.addEventListener('click', () => {
    void submitEditVoyageModal();
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
      if (modalId === 'endVoyageModal') setInlineMessage(endFeedback, '');
      if (modalId === 'editVoyageModal') {
        editState = null;
        clearComboboxCleanup();
        setInlineMessage(editVoyageFeedback, '');
      }
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
