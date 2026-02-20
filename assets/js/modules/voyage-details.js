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
  if (!Number.isFinite(num)) return '\u0192 0';
  return `\u0192 ${Math.round(num).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
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
  const archivedBreakdownLossAdjustment = document.querySelector(config.archivedBreakdownLossAdjustmentSelector);
  const archivedBreakdownRevenue = document.querySelector(config.archivedBreakdownRevenueSelector);
  const archivedBreakdownProfit = document.querySelector(config.archivedBreakdownProfitSelector);
  const archivedBreakdownCompanyShare = document.querySelector(config.archivedBreakdownCompanyShareSelector);
  const archivedBreakdownCrewShare = document.querySelector(config.archivedBreakdownCrewShareSelector);
  const archivedBreakdownLinesBody = document.querySelector(config.archivedBreakdownLinesBodySelector);
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
  const endVoyageLinesBody = document.querySelector(config.endVoyageLinesBodySelector);
  const finaliseHoldBtn = document.querySelector(config.finaliseHoldButtonSelector);
  const cancelHoldBtn = document.querySelector(config.cancelVoyageHoldButtonSelector);
  const breakdownRevenue = document.querySelector(config.breakdownRevenueSelector);
  const breakdownCost = document.querySelector(config.breakdownCostSelector);
  const breakdownLossAdjustment = document.querySelector(config.breakdownLossAdjustmentSelector);
  const breakdownProfit = document.querySelector(config.breakdownProfitSelector);
  const breakdownCompanyShare = document.querySelector(config.breakdownCompanyShareSelector);
  const breakdownCrewShare = document.querySelector(config.breakdownCrewShareSelector);
  const breakdownContainer = document.querySelector(config.breakdownContainerSelector);
  const sellMultiplierInput = document.querySelector(config.sellMultiplierSelector);
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
    !archivedBreakdownLossAdjustment ||
    !archivedBreakdownRevenue ||
    !archivedBreakdownProfit ||
    !archivedBreakdownCompanyShare ||
    !archivedBreakdownCrewShare ||
    !archivedBreakdownLinesBody ||
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
    !endVoyageLinesBody ||
    !finaliseHoldBtn ||
    !cancelHoldBtn ||
    !breakdownRevenue ||
    !breakdownCost ||
    !breakdownLossAdjustment ||
    !breakdownProfit ||
    !breakdownCompanyShare ||
    !breakdownCrewShare ||
    !breakdownContainer ||
    !sellMultiplierInput ||
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

  function collectEndLinesFromDom() {
    return [...endVoyageLinesBody.querySelectorAll('tr[data-cargo-id]')].map((row) => {
      const cargoTypeId = Number(row.getAttribute('data-cargo-id'));
      const quantity = Math.max(0, Math.floor(Number(row.getAttribute('data-qty') || 0)));
      const buyPrice = Math.max(0, Number(row.getAttribute('data-buy-price') || 0));
      const cargoName = row.getAttribute('data-cargo-name') || `Cargo #${cargoTypeId}`;
      const lossInput = row.querySelector('input[data-field="lostQty"]');
      const baseSellInput = row.querySelector('input[data-field="baseSellPrice"]');
      const lostQuantityRaw = Number(lossInput?.value || 0);
      const baseSellPriceRaw = Number(baseSellInput?.value || 0);
      const lostQuantity = Math.max(0, Math.min(quantity, Math.floor(Number.isFinite(lostQuantityRaw) ? lostQuantityRaw : 0)));
      const baseSellPrice = Number.isFinite(baseSellPriceRaw) ? Math.max(0, baseSellPriceRaw) : null;
      return {
        cargoTypeId,
        cargoName,
        quantity,
        buyPrice,
        lostQuantity,
        baseSellPrice,
        lossInput,
        baseSellInput,
        row
      };
    });
  }

  function calculateBreakdown(lines, sellMultiplier) {
    const lineItems = lines.map((line) => {
      const netQuantity = Math.max(line.quantity - line.lostQuantity, 0);
      const lineCost = toMoney(line.buyPrice * line.quantity);
      const trueSellUnitPrice = line.baseSellPrice === null ? null : toMoney(sellMultiplier * line.baseSellPrice);
      const lineRevenue = trueSellUnitPrice === null ? null : toMoney(trueSellUnitPrice * netQuantity);
      const lineProfit = lineRevenue === null ? null : toMoney(lineRevenue - lineCost);
      return {
        ...line,
        netQuantity,
        lineCost,
        trueSellUnitPrice,
        lineRevenue,
        lineProfit
      };
    });

    const totalCost = toMoney(lineItems.reduce((sum, line) => sum + line.lineCost, 0));
    const totalLossUnits = Math.round(lineItems.reduce((sum, line) => sum + line.lostQuantity, 0));
    const hasAllSellPrices = lineItems.every((line) => line.baseSellPrice !== null);
    const totalRevenue = hasAllSellPrices ? toMoney(lineItems.reduce((sum, line) => sum + (line.lineRevenue || 0), 0)) : null;
    const netProfit = hasAllSellPrices ? toMoney(totalRevenue - totalCost) : null;
    const companyShare = hasAllSellPrices ? toMoney(Math.max(netProfit, 0) * 0.1) : null;
    const crewShare = hasAllSellPrices ? (netProfit > 0 ? toMoney(netProfit - companyShare) : 0) : null;

    return {
      lineItems,
      totals: { totalCost, totalLossUnits, totalRevenue, netProfit, companyShare, crewShare },
      hasAllSellPrices
    };
  }

  function applyNetProfitTone(target, value) {
    if (!target) return;
    target.classList.remove('profit-positive', 'profit-negative', 'profit-zero');
    if (!Number.isFinite(value)) return;
    if (value > 0) target.classList.add('profit-positive');
    else if (value < 0) target.classList.add('profit-negative');
    else target.classList.add('profit-zero');
  }

  function applyShareMuted(target, value) {
    if (!target) return;
    target.classList.toggle('share-muted', Number(value || 0) <= 0);
  }

  function clearEndFieldErrors() {
    endVoyageLinesBody.querySelectorAll('.field-error').forEach((el) => el.classList.remove('field-error'));
    endVoyageLinesBody.querySelectorAll('.input-inline-error').forEach((el) => {
      el.textContent = '';
      el.classList.add('hidden');
    });
  }

  function validateEndVoyageInputs(lines) {
    clearEndFieldErrors();
    const sellMultiplier = toNumber(sellMultiplierInput.value);
    if (sellMultiplier === null || sellMultiplier < 0) {
      return { ok: false, message: 'Sell multiplier is required and must be >= 0.' };
    }
    for (const line of lines) {
      if (!Number.isInteger(line.lostQuantity) || line.lostQuantity < 0 || line.lostQuantity > line.quantity) {
        line.lossInput?.classList.add('field-error');
        const inlineError = line.row?.querySelector('[data-error-for="lostQty"]');
        if (inlineError) {
          inlineError.textContent = `Must be 0 to ${line.quantity}.`;
          inlineError.classList.remove('hidden');
        }
        return { ok: false, message: `Freight loss adjustment for ${line.cargoName} must be between 0 and ${line.quantity}.` };
      }
      if (line.quantity > 0 && (line.baseSellPrice === null || !Number.isFinite(line.baseSellPrice) || line.baseSellPrice < 0)) {
        line.baseSellInput?.classList.add('field-error');
        const inlineError = line.row?.querySelector('[data-error-for="baseSellPrice"]');
        if (inlineError) {
          inlineError.textContent = 'Required, and must be >= 0.';
          inlineError.classList.remove('hidden');
        }
        return { ok: false, message: `Base sell price is required for ${line.cargoName}.` };
      }
    }
    return { ok: true, message: '' };
  }

  function syncEndVoyageLineRow(row) {
    const quantity = Math.max(0, Math.floor(Number(row.getAttribute('data-qty') || 0)));
    const buyPrice = Math.max(0, Number(row.getAttribute('data-buy-price') || 0));
    const lossInput = row.querySelector('input[data-field="lostQty"]');
    const baseSellInput = row.querySelector('input[data-field="baseSellPrice"]');
    const quantityMeta = row.querySelector('[data-cell="quantityMeta"]');

    const lostRaw = Number(lossInput?.value || 0);
    const lostQuantity = Math.max(0, Math.min(quantity, Math.floor(Number.isFinite(lostRaw) ? lostRaw : 0)));
    if (lossInput && String(lossInput.value) !== String(lostQuantity)) lossInput.value = String(lostQuantity);
    const netQty = Math.max(quantity - lostQuantity, 0);
    if (quantityMeta) quantityMeta.textContent = `Net: ${netQty}`;
  }

  function syncBreakdown() {
    endVoyageLinesBody.querySelectorAll('tr[data-cargo-id]').forEach((row) => syncEndVoyageLineRow(row));
    const lines = collectEndLinesFromDom();
    if (!lines.length) {
      const manifestTotalCost = toMoney(
        manifest.reduce((sum, line) => {
          const quantity = Math.max(0, Math.floor(Number(line.quantity || 0)));
          const buyPrice = Math.max(0, Number(line.buy_price || 0));
          return sum + quantity * buyPrice;
        }, 0)
      );
      buyTotalText.textContent = formatGuilders(manifestTotalCost);
      breakdownCost.textContent = formatGuilders(manifestTotalCost);
      breakdownLossAdjustment.textContent = '0 units';
      breakdownRevenue.textContent = '—';
      breakdownProfit.textContent = '—';
      breakdownCompanyShare.textContent = '—';
      breakdownCrewShare.textContent = '—';
      applyNetProfitTone(breakdownProfit, null);
      applyShareMuted(breakdownCompanyShare, 0);
      applyShareMuted(breakdownCrewShare, 0);
      breakdownContainer.classList.add('hidden');
      return;
    }
    const sellMultiplier = toNumber(sellMultiplierInput.value);
    const hasMultiplier = sellMultiplier !== null && sellMultiplier >= 0;
    const computed = calculateBreakdown(lines, hasMultiplier ? sellMultiplier : 0);
    buyTotalText.textContent = formatGuilders(computed.totals.totalCost);
    breakdownCost.textContent = formatGuilders(computed.totals.totalCost);
    breakdownLossAdjustment.textContent = `${computed.totals.totalLossUnits} units`;
    if (!hasMultiplier || !computed.hasAllSellPrices) {
      breakdownRevenue.textContent = '—';
      breakdownProfit.textContent = '—';
      breakdownCompanyShare.textContent = '—';
      breakdownCrewShare.textContent = '—';
      applyNetProfitTone(breakdownProfit, null);
      applyShareMuted(breakdownCompanyShare, 0);
      applyShareMuted(breakdownCrewShare, 0);
      breakdownContainer.classList.add('hidden');
    } else {
      breakdownContainer.classList.remove('hidden');
      breakdownRevenue.textContent = formatGuilders(computed.totals.totalRevenue);
      breakdownProfit.textContent = formatGuilders(computed.totals.netProfit);
      breakdownCompanyShare.textContent = formatGuilders(computed.totals.companyShare);
      breakdownCrewShare.textContent = formatGuilders(computed.totals.crewShare);
      applyNetProfitTone(breakdownProfit, computed.totals.netProfit);
      applyShareMuted(breakdownCompanyShare, computed.totals.companyShare);
      applyShareMuted(breakdownCrewShare, computed.totals.crewShare);
    }
    const validation = validateEndVoyageInputs(lines);
    if (!validation.ok) setInlineMessage(endFeedback, validation.message);
    else setInlineMessage(endFeedback, '');
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
    const cargoLost = Array.isArray(detail?.cargoLost) ? detail.cargoLost : [];
    const lossByCargo = new Map(cargoLost.map((item) => [Number(item.cargoTypeId), Math.max(0, Math.floor(Number(item?.lostQuantity || 0)))]));
    const settlementLines = Array.isArray(detail?.voyageSettlementLines) ? detail.voyageSettlementLines : [];
    let lineItems = [];
    if (settlementLines.length) {
      lineItems = settlementLines.map((line) => ({
        cargoName: text(line.cargoName),
        netQuantity: Math.max(0, Math.floor(Number(line.netQuantity || 0))),
        lineCost: toMoney(line.lineCost || 0),
        lineRevenue: toMoney(line.lineRevenue || 0),
        lineProfit: toMoney(line.lineProfit || 0)
      }));
    } else {
      lineItems = (detail?.manifest || []).map((line) => {
        const quantity = Math.max(0, Math.floor(Number(line.quantity || 0)));
        const lostQuantity = Math.max(0, Math.floor(Number(lossByCargo.get(Number(line.cargo_type_id)) || 0)));
        const netQuantity = Math.max(quantity - lostQuantity, 0);
        const lineCost = toMoney(Number(line.line_total || 0));
        return {
          cargoName: text(line.cargo_name),
          netQuantity,
          lineCost,
          lineRevenue: 0,
          lineProfit: toMoney(0 - lineCost)
        };
      });
    }
    archivedBreakdownLinesBody.innerHTML = lineItems
      .map(
        (line) => `<tr>
          <td>${line.cargoName}</td>
          <td class="align-right">${line.netQuantity}</td>
          <td class="align-right">${formatGuilders(line.lineCost)}</td>
          <td class="align-right">${formatGuilders(line.lineRevenue)}</td>
          <td class="align-right">${formatGuilders(line.lineProfit)}</td>
        </tr>`
      )
      .join('');
    const totalLossUnits = cargoLost.reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item?.lostQuantity || 0))), 0);
    const totalCost = toMoney(detail.voyage.buy_total ?? detail.buyTotal ?? 0);
    const totalRevenue = toMoney(detail.voyage.effective_sell ?? 0);
    const profit = toMoney(detail.voyage.profit ?? totalRevenue - totalCost);
    const companyShare = toMoney(detail.voyage.company_share ?? Math.max(profit, 0) * 0.1);
    const crewShare = profit > 0 ? toMoney(profit - companyShare) : 0;
    archivedBreakdownFreight.textContent = formatGuilders(totalCost);
    archivedBreakdownLossAdjustment.textContent = `${Math.round(totalLossUnits)} units`;
    archivedBreakdownRevenue.textContent = formatGuilders(totalRevenue);
    archivedBreakdownProfit.textContent = formatGuilders(profit);
    archivedBreakdownCompanyShare.textContent = formatGuilders(companyShare);
    archivedBreakdownCrewShare.textContent = formatGuilders(crewShare);
    applyNetProfitTone(archivedBreakdownProfit, profit);
    applyShareMuted(archivedBreakdownCompanyShare, companyShare);
    applyShareMuted(archivedBreakdownCrewShare, crewShare);
  }

  function removeArchivedControlsFromDom() {
    const toRemove = [
      shipStatusControls,
      profileEditToggleBtn,
      openEndVoyageBtn,
      addCargoBtn,
      addLogForm,
      document.getElementById('addCargoModal'),
      document.getElementById('endVoyageModal'),
      document.getElementById('editVoyageModal')
    ];
    toRemove.forEach((node) => {
      if (node && node.parentNode) node.parentNode.removeChild(node);
    });
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
    const editable = canEdit();
    manifestBody.innerHTML = manifest
      .map(
        (line) => `<tr data-cargo-id="${line.cargo_type_id}">
          <td>${text(line.cargo_name)}</td>
          <td>${editable ? `<input data-field="quantity" type="number" min="0" step="1" value="${Number(line.quantity || 0)}" />` : Number(line.quantity || 0)}</td>
          <td>${editable ? `<input data-field="buyPrice" type="number" min="0" step="0.01" value="${Number(line.buy_price || 0)}" />` : formatGuilders(line.buy_price)}</td>
          <td>${formatGuilders(line.line_total)}</td>
          <td>${editable ? `<button class="btn btn-secondary" type="button" data-remove-line="${line.cargo_type_id}">Remove</button>` : '—'}</td>
        </tr>`
      )
      .join('');

    if (editable) {
      manifestBody.querySelectorAll('[data-remove-line]').forEach((button) => {
        button.addEventListener('click', () => {
          const cargoId = Number(button.getAttribute('data-remove-line'));
          manifest = manifest.filter((line) => Number(line.cargo_type_id) !== cargoId);
          renderManifest();
          renderEndVoyageLines();
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
    }

    if (addCargoBtn?.classList) addCargoBtn.classList.toggle('hidden', !editable);
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
      renderEndVoyageLines();
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

  function renderEndVoyageLines() {
    const existingLoss = new Map(
      [...endVoyageLinesBody.querySelectorAll('tr[data-cargo-id]')].map((row) => [
        Number(row.getAttribute('data-cargo-id')),
        Math.max(0, Math.floor(Number(row.querySelector('input[data-field="lostQty"]')?.value || 0)))
      ])
    );
    const existingBaseSell = new Map(
      [...endVoyageLinesBody.querySelectorAll('tr[data-cargo-id]')].map((row) => [
        Number(row.getAttribute('data-cargo-id')),
        Number(row.querySelector('input[data-field="baseSellPrice"]')?.value || 0)
      ])
    );
    const manifestRows = manifest
      .map((line) => ({
        cargoTypeId: Number(line.cargo_type_id),
        cargoName: text(line.cargo_name),
        quantity: Math.max(0, Math.floor(Number(line.quantity || 0))),
        buyPrice: Math.max(0, Number(line.buy_price || 0))
      }))
      .filter((line) => line.quantity > 0);

    endVoyageLinesBody.innerHTML = manifestRows
      .map((line) => {
        const defaultBaseSell = existingBaseSell.has(line.cargoTypeId)
          ? existingBaseSell.get(line.cargoTypeId)
          : Math.max(0, Number(line.buyPrice || 0));
        const defaultLoss = existingLoss.has(line.cargoTypeId)
          ? Math.min(existingLoss.get(line.cargoTypeId), line.quantity)
          : 0;
        return `<tr data-cargo-id="${line.cargoTypeId}" data-cargo-name="${line.cargoName}" data-qty="${line.quantity}" data-buy-price="${line.buyPrice}">
          <td><span class="cargo-name" title="${line.cargoName}">${line.cargoName}</span></td>
          <td><div class="quantity-main">${line.quantity}</div><div class="quantity-meta muted" data-cell="quantityMeta">Net: ${line.quantity - defaultLoss}</div></td>
          <td>
            <input data-field="lostQty" type="number" min="0" max="${line.quantity}" step="1" value="${defaultLoss}" />
            <div class="input-inline-error hidden" data-error-for="lostQty"></div>
          </td>
          <td class="align-right">${formatGuilders(line.buyPrice)}</td>
          <td>
            <input data-field="baseSellPrice" type="number" min="0" step="0.01" value="${defaultBaseSell}" />
            <div class="input-inline-error hidden" data-error-for="baseSellPrice"></div>
          </td>
        </tr>`;
      })
      .join('');

    endVoyageLinesBody.querySelectorAll('tr[data-cargo-id]').forEach((row) => {
      row.querySelectorAll('input[data-field="lostQty"], input[data-field="baseSellPrice"]').forEach((input) => {
        input.addEventListener('input', () => {
          syncEndVoyageLineRow(row);
          syncBreakdown();
        });
      });
      syncEndVoyageLineRow(row);
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
    const protectedContent = document.getElementById('protectedContent');
    const isArchived = String(detail.voyage.status) === 'ENDED';
    if (protectedContent) {
      protectedContent.classList.toggle('archived-voyage', isArchived);
    }
    if (!isArchived) {
      profileEditToggleBtn.classList.toggle('hidden', !canEdit());
    }
    renderStatusControls();
    renderFieldList();
    renderArchivedBreakdown();
    const ongoing = isOngoing();
    if (!isArchived) {
      openEndVoyageBtn.classList.toggle('hidden', !(detail.permissions?.canEnd && ongoing));
      addLogForm.classList.toggle('hidden', !(detail.permissions?.canEdit && ongoing));
    }
    const cargoTypes = detail.voyageConfig?.cargoTypes || [];
    addCargoTypeSelect.innerHTML = ['<option value="">Select cargo type</option>', ...cargoTypes.map((item) => `<option value="${item.id}">${item.name}</option>`)].join('');
    if (isArchived) {
      removeArchivedControlsFromDom();
      closeModal('addCargoModal');
      closeModal('endVoyageModal');
      closeModal('editVoyageModal');
      finaliseHoldBtn.disabled = true;
      cancelHoldBtn.disabled = true;
    } else if (!ongoing) {
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
    renderEndVoyageLines();
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
    renderEndVoyageLines();
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
    renderEndVoyageLines();
    syncBreakdown();
    openModal('endVoyageModal');
  });

  bindHoldButton(finaliseHoldBtn, async () => {
    const data = new FormData(endForm);
    const sellMultiplier = Number(data.get('sellMultiplier') || 0);
    if (!Number.isFinite(sellMultiplier) || sellMultiplier < 0) throw new Error('Sell multiplier must be >= 0.');
    const previewLines = collectEndLinesFromDom();
    const validation = validateEndVoyageInputs(previewLines);
    if (!validation.ok) throw new Error(validation.message);

    const lines = [...manifestBody.querySelectorAll('tr[data-cargo-id]')].map((row) => ({
      cargoTypeId: Number(row.getAttribute('data-cargo-id')),
      quantity: Math.max(0, Math.floor(Number(row.querySelector('input[data-field="quantity"]')?.value || 0))),
      buyPrice: Math.max(0, Number(row.querySelector('input[data-field="buyPrice"]')?.value || 0))
    }));
    await updateVoyageManifest(voyageId, lines);

    const endLines = collectEndLinesFromDom();
    const cargoLost = endLines.map((entry) => ({ cargoTypeId: entry.cargoTypeId, lostQuantity: entry.lostQuantity }));
    const baseSellPrices = endLines.map((entry) => {
      if (entry.baseSellPrice === null || !Number.isFinite(entry.baseSellPrice)) {
        throw new Error(`Base sell price is required for ${entry.cargoName}.`);
      }
      return { cargoTypeId: entry.cargoTypeId, baseSellPrice: entry.baseSellPrice };
    });

    await endVoyage(voyageId, {
      sellMultiplier,
      cargoLost,
      baseSellPrices
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

  [sellMultiplierInput].forEach((input) => {
    input.addEventListener('input', syncBreakdown);
  });

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modalId = button.getAttribute('data-close-modal');
      if (modalId === 'endVoyageModal') {
        setInlineMessage(endFeedback, '');
        clearEndFieldErrors();
      }
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
