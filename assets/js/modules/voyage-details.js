import {
  cancelVoyage,
  createVoyageLog,
  endVoyage,
  getVoyage,
  updateVoyageShipStatus,
  updateVoyageManifest
} from './admin-api.js';
import { formatLocalDateTime } from './local-datetime.js';

const MAX_TOTES_PER_VOYAGE = 18;

function text(value) {
  const out = String(value ?? '').trim();
  return out || 'N/A';
}

function toInt(value) {
  const n = Number(value);
  return Number.isInteger(n) ? n : 0;
}

function toMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function formatMoney(value) {
  return `ƒ ${toMoney(value).toLocaleString()}`;
}

function formatWhen(value) {
  return formatLocalDateTime(value, { fallback: text(value) });
}

function toteFingerprint(row) {
  const ownerId = Number(row?.ownerEmployeeId || row?.owner_employee_id || 0);
  const fishTypeId = Number(row?.fishTypeId || row?.fish_type_id || 0);
  const quantity = Math.max(0, toInt(row?.quantity || 0));
  return `${ownerId}|${fishTypeId}|${quantity}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
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

  const reset = () => {
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
    const pct = Math.max(0, Math.min(1, elapsed / duration));
    setProgress(pct * 100);
    if (pct >= 1) {
      holdActive = false;
      button.classList.remove('is-holding');
      button.classList.add('is-armed');
      inFlight = true;
      try {
        await onConfirm();
      } finally {
        inFlight = false;
        window.setTimeout(() => reset(), 120);
      }
      return;
    }
    holdFrame = window.requestAnimationFrame(tickHold);
  };

  const start = (event) => {
    if (event.type === 'pointerdown' && 'button' in event && event.button !== 0) return;
    if (button.disabled || inFlight) return;
    event.preventDefault();
    reset();
    holdActive = true;
    holdStartTs = 0;
    button.classList.add('is-holding');
    setProgress(0);
    holdFrame = window.requestAnimationFrame(tickHold);
  };

  const cancel = () => {
    if (!holdActive) return;
    reset();
  };

  button.addEventListener('pointerdown', start);
  button.addEventListener('pointerup', cancel);
  button.addEventListener('pointerleave', cancel);
  button.addEventListener('pointercancel', cancel);
  button.addEventListener('dragstart', (event) => event.preventDefault());

  return () => {
    reset();
    button.removeEventListener('pointerdown', start);
    button.removeEventListener('pointerup', cancel);
    button.removeEventListener('pointerleave', cancel);
    button.removeEventListener('pointercancel', cancel);
  };
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

function voyageIdFromUrl() {
  const url = new URL(window.location.href);
  const fromQuery = Number(url.searchParams.get('voyageId'));
  if (Number.isInteger(fromQuery) && fromQuery > 0) return fromQuery;
  const parts = window.location.pathname.split('/').filter(Boolean);
  const maybeId = Number(parts[parts.length - 1]);
  return Number.isInteger(maybeId) && maybeId > 0 ? maybeId : 0;
}

function settlementRowKey(tote, index = 0) {
  const toteId = Number(tote?.toteId || tote?.id || 0);
  if (toteId > 0) return `tote:${toteId}`;
  return `idx:${Number(index)}`;
}

function calculateOwnerSettlement(toteEntries, fishById, multiplier, baseSellByKey = new Map(), lostQtyByToteId = new Map(), skipperEmployeeId = 0) {
  const byOwner = new Map();
  const normalizedMultiplier = Number(multiplier) >= 0 ? Number(multiplier) : 1;
  const rowBaseSellByKey = baseSellByKey instanceof Map ? baseSellByKey : new Map();
  const lostMap = lostQtyByToteId instanceof Map ? lostQtyByToteId : new Map();
  let totalReimbursements = 0;

  for (let index = 0; index < toteEntries.length; index += 1) {
    const tote = toteEntries[index];
    const toteId = Number(tote.toteId || tote.id || 0);
    const ownerId = Number(tote.ownerEmployeeId);
    const fish = fishById.get(Number(tote.fishTypeId));
    const qty = Math.max(0, toInt(tote.quantity));
    const buyUnitPrice = toMoney(fish?.unit_price || fish?.unitPrice || tote.unitPrice || 0);
    const rowKey = settlementRowKey(tote, index);
    const configuredBaseSell = rowBaseSellByKey.has(rowKey) ? Number(rowBaseSellByKey.get(rowKey)) : buyUnitPrice;
    const baseSellUnitPrice = Math.max(0, toMoney(configuredBaseSell));
    const rowTotal = toMoney(qty * baseSellUnitPrice * normalizedMultiplier);
    const requestedLostQty = toteId > 0 ? Math.max(0, toInt(lostMap.get(toteId))) : 0;
    const lostQty = Math.max(0, Math.min(qty, requestedLostQty));
    const lostReimbursement = toMoney(lostQty * buyUnitPrice);
    const finalTotal = Math.max(0, toMoney(rowTotal - toMoney(lostQty * baseSellUnitPrice * normalizedMultiplier)));

    const current = byOwner.get(ownerId) || {
      ownerEmployeeId: ownerId,
      ownerName: text(tote.ownerName),
      toteCount: 0,
      totalQuantity: 0,
      lostQuantity: 0,
      reimbursementTotal: 0,
      grossTotal: 0,
      payableTotal: 0
    };
    current.toteCount += 1;
    current.totalQuantity += qty;
    current.lostQuantity += lostQty;
    current.reimbursementTotal = toMoney(current.reimbursementTotal + lostReimbursement);
    totalReimbursements = toMoney(totalReimbursements + lostReimbursement);
    current.grossTotal = toMoney(current.grossTotal + finalTotal);
    byOwner.set(ownerId, current);
  }

  const ownerSettlements = [...byOwner.values()]
    .map((owner) => ({
      ...owner,
      payableTotal:
        Number(skipperEmployeeId) > 0 && Number(owner.ownerEmployeeId) === Number(skipperEmployeeId)
          ? 0
          : Math.max(0, toMoney(Number(owner.grossTotal || 0) * 0.1))
    }))
    .sort((a, b) => a.ownerName.localeCompare(b.ownerName));
  return {
    ownerSettlements,
    totalFish: ownerSettlements.reduce((sum, owner) => sum + Number(owner.totalQuantity || 0), 0),
    totalEarnings: toMoney(ownerSettlements.reduce((sum, owner) => sum + Number(owner.grossTotal || 0), 0)),
    totalPayable: toMoney(ownerSettlements.reduce((sum, owner) => sum + Number(owner.payableTotal || 0), 0)),
    totalReimbursements: toMoney(totalReimbursements)
  };
}

export async function initVoyageDetails(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const heading = document.querySelector(config.headingSelector);
  const fieldList = document.querySelector(config.fieldListSelector);
  const shipStatusControls = document.getElementById('shipStatusControls');
  const shipStatusToggle = document.getElementById('shipStatusToggle');
  const shipStatusFeedback = document.getElementById('shipStatusFeedback');
  const toteBody = document.querySelector(config.toteBodySelector);
  const toteFeedback = document.querySelector(config.toteFeedbackSelector);
  const toteAutosaveState = document.querySelector(config.toteAutosaveStateSelector);
  const addToteBtn = document.querySelector(config.addToteButtonSelector);
  const addLogForm = document.querySelector(config.addLogFormSelector);
  const logList = document.querySelector(config.logListSelector);
  const shipLogPanel = document.getElementById('shipLogPanel');
  const settlementSection = document.querySelector(config.settlementSectionSelector);
  const settlementSummary = document.querySelector(config.settlementSummarySelector);
  const openEndVoyageBtn = document.querySelector(config.openEndVoyageButtonSelector);
  const endForm = document.querySelector(config.endFormSelector);
  const endFeedback = document.querySelector(config.endFeedbackSelector);
  const cancelVoyageBtn = document.getElementById('cancelVoyageBtn');
  const finaliseVoyageBtn = document.getElementById('finaliseVoyageBtn');
  const sellLocationSelect = document.querySelector(config.sellLocationSelector);
  const sellMultiplierInput = document.querySelector(config.sellMultiplierInputSelector);
  const ownerSettlementBody = document.querySelector(config.ownerSettlementBodySelector);
  const voyageTotalEarnings = document.querySelector(config.voyageTotalEarningsSelector);
  if (
    !feedback ||
    !heading ||
    !fieldList ||
    !shipStatusControls ||
    !shipStatusToggle ||
    !shipStatusFeedback ||
    !toteBody ||
    !toteFeedback ||
    !toteAutosaveState ||
    !addToteBtn ||
    !addLogForm ||
    !logList ||
    !settlementSection ||
    !settlementSummary ||
    !openEndVoyageBtn ||
    !endForm ||
    !endFeedback ||
    !sellLocationSelect ||
    !sellMultiplierInput ||
    !ownerSettlementBody ||
    !voyageTotalEarnings
  ) {
    return;
  }

  const voyageId = voyageIdFromUrl();
  if (!voyageId) {
    feedback.textContent = 'Invalid voyage id.';
    return;
  }

  let detail = null;
  let editableTotes = [];
  let fishTypes = [];
  let employees = [];
  let allowedOwners = [];
  let sellLocations = [];
  let fishById = new Map();
  let autosaveTimer = null;
  let autosaveInFlight = false;
  let autosavePromise = null;
  let detailLoading = false;
  let lastEditedRowIndex = -1;
  let rowSaveState = new Map();
  let lostQtyByToteId = new Map();
  let settlementBaseSellByKey = new Map();
  let lastDetailSignature = '';
  const toteDraftStorageKey = `voyage:tote-draft:${voyageId}`;

  function voyageStatus() {
    return String(detail?.voyage?.status || '').toUpperCase();
  }

  function voyageIsOngoing() {
    return voyageStatus() === 'ONGOING';
  }

  function canEditVoyage() {
    return voyageIsOngoing() && Boolean(detail?.permissions?.canEdit);
  }

  function canEndVoyage() {
    return voyageIsOngoing() && Boolean(detail?.permissions?.canEnd);
  }

  function signatureForDetail(payload) {
    const voyage = payload?.voyage || {};
    const toteEntries = Array.isArray(payload?.toteEntries) ? payload.toteEntries : Array.isArray(payload?.manifest) ? payload.manifest : [];
    const logs = Array.isArray(payload?.logs) ? payload.logs : [];
    const toteSig = toteEntries
      .map((row) =>
        [
          Number(row?.id || row?.toteId || 0),
          Number(row?.owner_employee_id || row?.ownerEmployeeId || 0),
          Number(row?.fish_type_id || row?.fishTypeId || 0),
          Math.max(0, toInt(row?.quantity || 0)),
          String(row?.updated_at || '')
        ].join(':')
      )
      .join('|');
    const logSig = logs
      .map((row) => `${Number(row?.id || 0)}:${String(row?.updated_at || row?.created_at || '')}`)
      .join('|');
    return [
      Number(voyage?.id || 0),
      String(voyage?.status || ''),
      String(voyage?.ship_status || ''),
      String(voyage?.updated_at || ''),
      toteSig,
      logSig
    ].join('~');
  }

  function readDraftRows() {
    try {
      const raw = window.localStorage.getItem(toteDraftStorageKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .map((row) => ({
          toteId: Number(row?.toteId || 0),
          ownerEmployeeId: Number(row?.ownerEmployeeId || 0),
          fishTypeId: Number(row?.fishTypeId || 0),
          quantity: Math.max(0, toInt(row?.quantity || 0))
        }))
        .slice(0, MAX_TOTES_PER_VOYAGE);
    } catch {
      return [];
    }
  }

  function clearDraftRows() {
    try {
      window.localStorage.removeItem(toteDraftStorageKey);
    } catch {
      // Ignore storage failures.
    }
  }

  function persistDraftRows() {
    if (!voyageIsOngoing()) return;
    try {
      window.localStorage.setItem(
        toteDraftStorageKey,
        JSON.stringify(
          editableTotes.slice(0, MAX_TOTES_PER_VOYAGE).map((row) => ({
            toteId: Number(row?.toteId || 0),
            ownerEmployeeId: Number(row?.ownerEmployeeId || 0),
            fishTypeId: Number(row?.fishTypeId || 0),
            quantity: Math.max(0, toInt(row?.quantity || 0))
          }))
        )
      );
    } catch {
      // Ignore storage failures.
    }
  }

  function mergeServerWithDraft(serverRows) {
    if (!canEditVoyage()) return serverRows.slice(0, MAX_TOTES_PER_VOYAGE);
    const draftRows = readDraftRows();
    if (!draftRows.length) return serverRows.slice(0, MAX_TOTES_PER_VOYAGE);
    const serverById = new Map(serverRows.filter((row) => Number(row.toteId) > 0).map((row) => [Number(row.toteId), row]));
    const consumedServerIds = new Set();
    const merged = [];

    draftRows.forEach((row) => {
      const toteId = Number(row.toteId || 0);
      if (toteId > 0 && serverById.has(toteId)) {
        merged.push({
          ...serverById.get(toteId),
          ownerEmployeeId: Number(row.ownerEmployeeId || 0),
          fishTypeId: Number(row.fishTypeId || 0),
          quantity: Math.max(0, toInt(row.quantity || 0))
        });
        consumedServerIds.add(toteId);
        return;
      }
      merged.push({
        toteId: 0,
        ownerEmployeeId: Number(row.ownerEmployeeId || 0),
        fishTypeId: Number(row.fishTypeId || 0),
        quantity: Math.max(0, toInt(row.quantity || 0))
      });
    });

    serverRows.forEach((row) => {
      const toteId = Number(row.toteId || 0);
      if (toteId > 0 && consumedServerIds.has(toteId)) return;
      merged.push(row);
    });

    return merged.slice(0, MAX_TOTES_PER_VOYAGE);
  }

  function applyViewportFit() {
    if (!document.body.classList.contains('page-voyage-details')) return;
    const manifestModule = document.querySelector('.voyage-manifest-module');
    const tableWrap = manifestModule?.querySelector('.table-wrap');
    if (!(manifestModule instanceof HTMLElement) || !(tableWrap instanceof HTMLElement)) return;
    if (!manifestModule.offsetParent || !tableWrap.offsetParent) return;

    const viewportHeight = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0;
    if (viewportHeight <= 0) return;

    // Clamp the tote module to the visible viewport so bottom actions stay on-screen.
    const moduleRect = manifestModule.getBoundingClientRect();
    const moduleBottomGap = 34;
    const moduleAvailable = Math.floor(viewportHeight - moduleRect.top - moduleBottomGap);
    const moduleHeight = Math.max(280, Math.min(720, moduleAvailable));
    manifestModule.style.height = `${moduleHeight}px`;
    manifestModule.style.maxHeight = `${moduleHeight}px`;

    const moduleStyles = window.getComputedStyle(manifestModule);
    const padTop = parseFloat(moduleStyles.paddingTop || '0') || 0;
    const padBottom = parseFloat(moduleStyles.paddingBottom || '0') || 0;
    const moduleHeader = manifestModule.querySelector('.modal-header');
    const moduleFeedback = manifestModule.querySelector('#toteFeedback');
    const moduleActions = manifestModule.querySelector('.tote-actions-row');
    const headerH = moduleHeader ? Math.ceil(moduleHeader.getBoundingClientRect().height) : 0;
    const feedbackH =
      moduleFeedback && !moduleFeedback.classList.contains('hidden')
        ? Math.ceil(moduleFeedback.getBoundingClientRect().height)
        : 0;
    const actionsH = moduleActions ? Math.ceil(moduleActions.getBoundingClientRect().height) : 0;
    const availableForTable = Math.floor(moduleHeight - padTop - padBottom - headerH - feedbackH - actionsH - 10);
    const tableHeight = Math.max(140, availableForTable);
    tableWrap.style.height = `${tableHeight}px`;
    tableWrap.style.maxHeight = `${tableHeight}px`;
    tableWrap.style.overflowY = 'auto';
    tableWrap.style.overflowX = 'hidden';
  }

  function updateAddToteAvailability() {
    const canEdit = canEditVoyage();
    const atMax = editableTotes.length >= MAX_TOTES_PER_VOYAGE;
    addToteBtn.disabled = !canEdit || atMax;
    addToteBtn.title = atMax ? `Maximum ${MAX_TOTES_PER_VOYAGE} Freight/Cargo entries reached` : 'Add Freight/Cargo';
    addToteBtn.setAttribute('aria-label', addToteBtn.title);
  }

  function setRowState(rowIndex, message = '', tone = '') {
    if (!Number.isInteger(rowIndex) || rowIndex < 0) return;
    if (!message) {
      rowSaveState.delete(rowIndex);
      return;
    }
    rowSaveState.set(rowIndex, { message, tone });
  }

  function selectedMultiplier() {
    const value = Number(sellMultiplierInput.value);
    if (!Number.isFinite(value) || value < 0) return 1;
    return value;
  }

  function renderHeading() {
    if (!detail?.voyage) return;
    heading.textContent = `${text(detail.voyage.vessel_name)} | ${text(detail.voyage.status)}`;
  }

  function renderShipStatusControls() {
    const canEdit = canEditVoyage();
    const status = String(detail?.voyage?.ship_status || 'IN_PORT').toUpperCase();
    const isUnderway = status === 'UNDERWAY';
    shipStatusControls.classList.toggle('hidden', !canEdit);
    shipStatusToggle.disabled = !canEdit;
    shipStatusToggle.setAttribute('aria-checked', isUnderway ? 'true' : 'false');
    shipStatusToggle.dataset.state = isUnderway ? 'underway' : 'in-port';
    if (!shipStatusFeedback.dataset.temporary) {
      shipStatusFeedback.textContent = '';
    }
  }

  function renderOverview() {
    const voyage = detail?.voyage || {};
    const crewRows = Array.isArray(detail?.crew) ? detail.crew : [];
    const skipperId = Number(voyage.officer_of_watch_employee_id || 0);
    const crewIds = new Set(crewRows.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0));
    const totalAboard = crewIds.has(skipperId) || skipperId <= 0 ? crewIds.size : crewIds.size + 1;
    const crewNames = crewRows
      .map((row) => text(row.roblox_username))
      .filter((name) => name && name !== 'N/A')
      .sort((a, b) => a.localeCompare(b));
    const crewNamesLabel = crewNames.length ? crewNames.join(', ') : 'None assigned';
    const crewComplementLabel = `${crewRows.length} crew (${totalAboard} total aboard): ${crewNamesLabel}`;
    fieldList.innerHTML = `
      <div class="voyage-field-row"><span class="muted">Port</span><strong>${escapeHtml(text(voyage.departure_port))}</strong></div>
      <div class="voyage-field-row"><span class="muted">Officer of the Watch (OOTW)</span><strong>${escapeHtml(text(voyage.officer_name))}</strong></div>
      <div class="voyage-field-row"><span class="muted">Crew Complement</span><strong>${escapeHtml(crewComplementLabel)}</strong></div>
      <div class="voyage-field-row"><span class="muted">Started</span><strong>${escapeHtml(formatWhen(voyage.started_at))}</strong></div>
      <div class="voyage-field-row"><span class="muted">Status</span><strong>${escapeHtml(text(voyage.status))}</strong></div>
    `;
  }

  function currentOwnerName(ownerId) {
    const owner = allowedOwners.find((row) => Number(row.id) === Number(ownerId));
    return text(owner?.roblox_username || `Employee #${ownerId}`);
  }

  function isRowComplete(row) {
    return Number(row.ownerEmployeeId) > 0 && Number(row.fishTypeId) > 0 && toInt(row.quantity) > 0;
  }

  function isRowEmpty(row) {
    return Number(row.ownerEmployeeId) <= 0 && Number(row.fishTypeId) <= 0 && toInt(row.quantity) <= 0;
  }

  function setAutosaveState(message = '', tone = '') {
    toteAutosaveState.textContent = message;
    toteAutosaveState.classList.remove('is-error', 'is-success');
    if (tone === 'error') toteAutosaveState.classList.add('is-error');
    if (tone === 'success') toteAutosaveState.classList.add('is-success');
  }

  async function persistTotes() {
    if (!canEditVoyage()) return;
    if (autosaveInFlight && autosavePromise) return autosavePromise;
    const validRows = editableTotes.filter(isRowComplete);
    const hasPartialRows = editableTotes.some((row) => !isRowComplete(row) && !isRowEmpty(row));
    const hasEmptyRows = editableTotes.some((row) => isRowEmpty(row));
    if (hasPartialRows) {
      setAutosaveState('Fill owner, cargo, and qty (>0) to save.');
      persistDraftRows();
      return;
    }
    if (!validRows.length && hasEmptyRows) {
      setAutosaveState('Row added. Fill owner, cargo, and qty.');
      persistDraftRows();
      return;
    }
    const emptyDraftRows = editableTotes
      .filter((row) => isRowEmpty(row))
      .map((row) => ({
        toteId: 0,
        ownerEmployeeId: 0,
        fishTypeId: 0,
        quantity: 0
      }));
    autosaveInFlight = true;
    autosavePromise = (async () => {
      setAutosaveState('Saving...');
      if (lastEditedRowIndex >= 0) setRowState(lastEditedRowIndex, 'Saving...', 'pending');
      renderToteRows();
      setInlineMessage(toteFeedback, '');

      const lostFingerprints = new Map();
      editableTotes.forEach((row) => {
        const toteId = Number(row.toteId || 0);
        const lostQty = toteId > 0 ? Math.max(0, toInt(lostQtyByToteId.get(toteId))) : 0;
        if (toteId <= 0 || lostQty <= 0) return;
        const key = toteFingerprint(row);
        const entries = Array.isArray(lostFingerprints.get(key)) ? lostFingerprints.get(key) : [];
        entries.push(lostQty);
        lostFingerprints.set(key, entries);
      });

      try {
        const payload = await updateVoyageManifest(voyageId, validRows);
        editableTotes = (payload?.toteEntries || payload?.manifest || [])
          .map((row) => ({
            toteId: Number(row.id || row.toteId || 0),
            ownerEmployeeId: Number(row.owner_employee_id || row.ownerEmployeeId || 0),
            fishTypeId: Number(row.fish_type_id || row.fishTypeId || 0),
            quantity: Math.max(0, toInt(row.quantity || 0))
          }))
          .concat(emptyDraftRows)
          .slice(0, MAX_TOTES_PER_VOYAGE);

        if (lostFingerprints.size) {
          const remappedLostQty = new Map();
          editableTotes.forEach((row) => {
            const toteId = Number(row.toteId || 0);
            if (toteId <= 0) return;
            const key = toteFingerprint(row);
            const queue = Array.isArray(lostFingerprints.get(key)) ? lostFingerprints.get(key) : [];
            if (!queue.length) return;
            const qty = Math.max(0, Math.min(Math.max(0, toInt(row.quantity || 0)), toInt(queue.shift())));
            if (qty > 0) remappedLostQty.set(toteId, qty);
            lostFingerprints.set(key, queue);
          });
          lostQtyByToteId = remappedLostQty;
        } else {
          lostQtyByToteId = new Map();
        }

        renderToteRows();
        renderEndPreview();
        persistDraftRows();
        setAutosaveState('Saved', 'success');
        if (lastEditedRowIndex >= 0) {
          setRowState(lastEditedRowIndex, 'Saved', 'success');
          renderToteRows();
        }
        window.setTimeout(() => {
          setAutosaveState('');
          if (lastEditedRowIndex >= 0) {
            setRowState(lastEditedRowIndex, '');
            renderToteRows();
          }
        }, 1200);
      } catch (error) {
        setInlineMessage(toteFeedback, error.message || 'Unable to autosave tote log.');
        setAutosaveState('Save failed', 'error');
        if (lastEditedRowIndex >= 0) {
          setRowState(lastEditedRowIndex, 'Save failed', 'error');
          renderToteRows();
        }
      } finally {
        autosaveInFlight = false;
        autosavePromise = null;
      }
    })();

    return autosavePromise;
  }

  function scheduleAutosave(delayMs = 2000) {
    if (!canEditVoyage()) return;
    if (autosaveTimer) window.clearTimeout(autosaveTimer);
    setAutosaveState('Pending...');
    if (lastEditedRowIndex >= 0) {
      setRowState(lastEditedRowIndex, 'Pending...', 'pending');
      renderToteRows();
    }
    autosaveTimer = window.setTimeout(() => {
      void persistTotes();
    }, Math.max(1000, Number(delayMs) || 2000));
  }

  function renderToteRows() {
    if (!editableTotes.length) {
      toteBody.innerHTML = '<tr><td colspan="5">No Freight/Cargo entries yet.</td></tr>';
      updateAddToteAvailability();
      return;
    }

    const canEdit = canEditVoyage();
    toteBody.innerHTML = editableTotes
      .map((row, idx) => {
        const fish = fishById.get(Number(row.fishTypeId));
        const qty = Math.max(0, toInt(row.quantity));
        const ownerId = Number(row.ownerEmployeeId || 0);
        const fishTypeId = Number(row.fishTypeId || 0);
        const ownerOptions = ['<option value="">Select owner</option>']
          .concat(
            allowedOwners.map((emp) => {
              const selected = Number(emp.id) === ownerId ? ' selected' : '';
              return `<option value="${Number(emp.id)}"${selected}>${escapeHtml(text(emp.roblox_username))}</option>`;
            })
          )
          .join('');
        const fishOptions = ['<option value="">Select cargo</option>']
          .concat(
            fishTypes.map((fishType) => {
              const selected = Number(fishType.id) === fishTypeId ? ' selected' : '';
              return `<option value="${Number(fishType.id)}"${selected}>${escapeHtml(text(fishType.name))}</option>`;
            })
          )
          .join('');
        const saveState = rowSaveState.get(idx);
        const saveStateHtml = saveState?.message
          ? `<div class="tote-row-state ${saveState.tone ? `is-${escapeHtml(saveState.tone)}` : ''}">${escapeHtml(saveState.message)}</div>`
          : '';

        return `
          <tr data-tote-index="${idx}">
            <td>${idx + 1}</td>
            <td>${canEdit ? `<select data-field="ownerEmployeeId">${ownerOptions}</select>` : escapeHtml(currentOwnerName(ownerId))}</td>
            <td>
              ${
                canEdit
                  ? `<select data-field="fishTypeId">${fishOptions}</select>`
                  : escapeHtml(text(fish?.name || `Cargo #${fishTypeId}`))
              }
            </td>
            <td>${
              canEdit
                ? `<input data-field="quantity" type="number" min="0" step="1" value="${qty}" />`
                : `<span>${qty}</span>`
            }</td>
            <td>
              ${saveStateHtml}
              ${canEdit ? `<button class="btn btn-icon-remove" type="button" data-remove="${idx}" aria-label="Remove cargo" title="Remove cargo">x</button>` : '<span class="muted">-</span>'}
            </td>
          </tr>
        `;
      })
      .join('');

    updateAddToteAvailability();
  }

  function renderLogs() {
    const logs = Array.isArray(detail?.logs) ? detail.logs : [];
    shipLogPanel?.classList.toggle('ship-log-empty', !logs.length);
    if (!logs.length) {
      logList.innerHTML = '<li class="muted">No log entries yet.</li>';
      return;
    }
    logList.innerHTML = logs
      .map(
        (log) =>
          `<li><strong>${escapeHtml(text(log.author_name))}</strong> | ${escapeHtml(formatLocalDateTime(log.created_at))}<br />${escapeHtml(text(log.message))}</li>`
      )
      .join('');
  }

  function renderArchivedSettlement() {
    const ownerRows = Array.isArray(detail?.ownerSettlements) ? detail.ownerSettlements : [];
    if (!ownerRows.length) {
      settlementSection.classList.add('hidden');
      return;
    }
    settlementSection.classList.remove('hidden');
    const totals = {
      cargo: ownerRows.reduce((sum, row) => sum + Number(row.totalQuantity || 0), 0),
      earnings: toMoney(ownerRows.reduce((sum, row) => sum + Number(row.grossTotal || 0), 0)),
      payable: toMoney(ownerRows.reduce((sum, row) => sum + Number(row.payableTotal || 0), 0))
    };
    settlementSummary.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr>
              <th>Owner</th>
              <th class="align-right">Freight/Cargo entries</th>
              <th class="align-right">Cargo</th>
              <th class="align-right">Earnings</th>
              <th class="align-right">To Pay</th>
            </tr>
          </thead>
          <tbody>
            ${ownerRows
              .map(
                (owner) => `
              <tr>
                <td>${escapeHtml(text(owner.ownerName))}</td>
                <td class="align-right">${Number(owner.toteCount || 0)}</td>
                <td class="align-right">${Number(owner.totalQuantity || 0)}</td>
                <td class="align-right">${formatMoney(owner.grossTotal)}</td>
                <td class="align-right">${formatMoney(owner.payableTotal)}</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      <p class="muted" style="margin-top:.5rem;">Totals: Cargo ${totals.cargo} | Earnings ${formatMoney(totals.earnings)} | To Pay ${formatMoney(totals.payable)}</p>
    `;
  }

  function renderEndPreview(options = {}) {
    const preserveBaseKey = String(options?.preserveBaseKey || '').trim();
    let preserveSelectionStart = null;
    let preserveSelectionEnd = null;
    if (preserveBaseKey) {
      const active = document.activeElement;
      if (active instanceof HTMLInputElement && active.getAttribute('data-settlement-base-key') === preserveBaseKey) {
        preserveSelectionStart = active.selectionStart;
        preserveSelectionEnd = active.selectionEnd;
      }
    }

    const multiplier = selectedMultiplier();
    const completedTotes = editableTotes
      .map((row) => ({ ...row, ownerName: currentOwnerName(row.ownerEmployeeId) }))
      .filter(isRowComplete);
    const validLost = new Map();
    completedTotes.forEach((row) => {
      const id = Number(row.toteId);
      if (id <= 0) return;
      const qty = Math.max(0, Math.min(Math.max(0, toInt(row.quantity || 0)), toInt(lostQtyByToteId.get(id))));
      if (qty > 0) validLost.set(id, qty);
    });
    lostQtyByToteId = validLost;

    const skipperEmployeeId = Number(detail?.voyage?.officer_of_watch_employee_id || 0);
    const settlement = calculateOwnerSettlement(
      completedTotes,
      fishById,
      multiplier,
      settlementBaseSellByKey,
      lostQtyByToteId,
      skipperEmployeeId
    );

    if (!completedTotes.length) {
      ownerSettlementBody.innerHTML = '<tr><td colspan="9">No Freight/Cargo rows to settle.</td></tr>';
    } else {
      ownerSettlementBody.innerHTML = completedTotes
        .map(
          (row, idx) => {
            const fish = fishById.get(Number(row.fishTypeId));
            const qty = Math.max(0, toInt(row.quantity));
            const buyUnitPrice = toMoney(fish?.unit_price || fish?.unitPrice || row.unitPrice || 0);
            const rowKey = settlementRowKey(row, idx);
            const configuredBaseSell = settlementBaseSellByKey.has(rowKey)
              ? Number(settlementBaseSellByKey.get(rowKey))
              : buyUnitPrice;
            const baseSellPrice = Math.max(0, toMoney(configuredBaseSell));
            const rowValue = toMoney(qty * baseSellPrice * multiplier);
            const toteId = Number(row.toteId || 0);
            const lostQty = toteId > 0 ? Math.max(0, Math.min(qty, toInt(lostQtyByToteId.get(toteId)))) : 0;
            const lostValue = toMoney(lostQty * baseSellPrice * multiplier);
            const netValue = Math.max(0, toMoney(rowValue - lostValue));
            const ownerDue = Number(row.ownerEmployeeId || 0) === skipperEmployeeId ? 0 : toMoney(netValue * 0.1);
            const reimbursement = toMoney(lostQty * buyUnitPrice);
            return `
          <tr class="end-settlement-row${lostQty > 0 ? ' is-lost' : ''}">
            <td>${idx + 1}</td>
            <td>${escapeHtml(text(row.ownerName))}</td>
            <td>${escapeHtml(text(fish?.name || row.fishTypeId))}</td>
            <td class="align-right">${qty}</td>
            <td class="align-right">
              <input
                type="number"
                min="0"
                step="1"
                class="end-base-sell-input"
                data-settlement-base-key="${escapeHtml(rowKey)}"
                value="${baseSellPrice}"
                ${canEndVoyage() ? '' : 'disabled'}
              />
            </td>
            <td class="align-right">${formatMoney(netValue)}</td>
            <td class="align-right">${formatMoney(ownerDue)}</td>
            <td class="align-right">${formatMoney(reimbursement)}</td>
            <td class="align-right">${
              toteId > 0
                ? `<input type="number" min="0" max="${qty}" step="1" class="end-lost-qty-input" data-lost-qty-tote-id="${toteId}" value="${lostQty}" ${canEndVoyage() ? '' : 'disabled'} />`
                : '<span class="muted">Save first</span>'
            }</td>
          </tr>`;
          }
        )
        .join('');
    }

    if (preserveBaseKey) {
      const escapedKey =
        typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
          ? CSS.escape(preserveBaseKey)
          : preserveBaseKey.replace(/"/g, '\\"');
      const input = ownerSettlementBody.querySelector(`[data-settlement-base-key="${escapedKey}"]`);
      if (input instanceof HTMLInputElement) {
        input.focus({ preventScroll: true });
        const start = Number.isInteger(preserveSelectionStart) ? preserveSelectionStart : input.value.length;
        const end = Number.isInteger(preserveSelectionEnd) ? preserveSelectionEnd : start;
        try {
          input.setSelectionRange(start, end);
        } catch {
          // no-op for browsers that reject selection updates on number inputs
        }
      }
    }

    voyageTotalEarnings.textContent = formatMoney(settlement.totalEarnings);

    const hasRows = editableTotes.length > 0;
    const hasPartialRows = editableTotes.some((row) => !isRowComplete(row) && !isRowEmpty(row));
    const hasEmptyRows = editableTotes.some((row) => isRowEmpty(row));
    const canFinalize = hasRows && !hasPartialRows && !hasEmptyRows && editableTotes.every(isRowComplete);
    const canCancelWithCurrentState = !hasPartialRows && settlement.totalEarnings <= 0;

    if (finaliseVoyageBtn) {
      finaliseVoyageBtn.disabled = !canFinalize || !canEndVoyage();
      finaliseVoyageBtn.title = canFinalize
        ? 'Press and hold for 1 second to finalise voyage'
        : 'All Freight/Cargo entries must have owner, cargo, and quantity before finalizing';
    }
    if (cancelVoyageBtn) {
      cancelVoyageBtn.disabled = !canCancelWithCurrentState || !canEndVoyage();
      cancelVoyageBtn.title = canCancelWithCurrentState
        ? 'Press and hold for 1 second to cancel voyage'
        : 'Cancel is allowed only when current cargo earnings are zero';
    }
  }

  function applyDetailPayload(payload) {
    detail = payload;
      employees = Array.isArray(detail?.employees) ? detail.employees : [];
      const skipperId = Number(detail?.voyage?.officer_of_watch_employee_id || 0);
      const crewIds = new Set((Array.isArray(detail?.crew) ? detail.crew : []).map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0));
      if (skipperId > 0) crewIds.add(skipperId);
      const employeesById = new Map(employees.map((row) => [Number(row.id), row]));
      allowedOwners = [...crewIds]
        .map((id) => employeesById.get(id))
        .filter(Boolean)
        .sort((a, b) => text(a.roblox_username).localeCompare(text(b.roblox_username)));
      fishTypes = Array.isArray(detail?.voyageConfig?.fishTypes)
        ? detail.voyageConfig.fishTypes
        : Array.isArray(detail?.voyageConfig?.cargoTypes)
        ? detail.voyageConfig.cargoTypes.map((row) => ({ id: row.id, name: row.name, unit_price: row.default_price }))
        : [];
      fishById = new Map(fishTypes.map((row) => [Number(row.id), row]));
      sellLocations = Array.isArray(detail?.voyageConfig?.sellLocations) ? detail.voyageConfig.sellLocations : [];
      settlementBaseSellByKey = new Map();

      const serverTotes = (Array.isArray(detail?.toteEntries) ? detail.toteEntries : Array.isArray(detail?.manifest) ? detail.manifest : [])
        .map((row) => ({
          toteId: Number(row.id || row.toteId || 0),
          ownerEmployeeId: Number(row.owner_employee_id || row.ownerEmployeeId || 0),
          fishTypeId: Number(row.fish_type_id || row.fishTypeId || 0),
          quantity: Math.max(0, toInt(row.quantity || 0))
        }));
      editableTotes = mergeServerWithDraft(serverTotes);
      lostQtyByToteId = new Map();

      renderHeading();
      renderOverview();
      renderShipStatusControls();
      renderToteRows();
      renderLogs();
      renderArchivedSettlement();

      const canEdit = canEditVoyage();
      const canEnd = canEndVoyage();
      addToteBtn.classList.toggle('hidden', !canEdit);
      addLogForm.classList.toggle('hidden', !canEdit);
      openEndVoyageBtn.classList.toggle('hidden', !canEnd);
      if (cancelVoyageBtn) cancelVoyageBtn.classList.toggle('hidden', !canEnd);
      updateAddToteAvailability();
      if (!canEdit) {
        setAutosaveState('');
        clearDraftRows();
      }

      if (!sellLocations.length) {
        sellLocationSelect.innerHTML = '<option value="">No sell locations configured</option>';
      } else {
        sellLocationSelect.innerHTML = ['<option value="">Select sell location</option>']
          .concat(
            sellLocations.map(
              (row) => `<option value="${Number(row.id)}">${escapeHtml(text(row.name))}</option>`
            )
          )
          .join('');
      }
      sellMultiplierInput.value = String(Math.max(0, Number(detail?.voyage?.sell_multiplier || 1) || 1));
      renderEndPreview();
      if (canEdit) persistDraftRows();
      window.requestAnimationFrame(applyViewportFit);
  }

  async function loadDetail(options = {}) {
    if (detailLoading) return false;
    detailLoading = true;
    try {
      const payload = options.payload || (await getVoyage(voyageId, { includeSetup: true, includeManifest: true, includeLogs: true }));
      const signature = signatureForDetail(payload);
      if (options.skipIfUnchanged && signature === lastDetailSignature) return false;
      applyDetailPayload(payload);
      lastDetailSignature = signature;
      return true;
    } finally {
      detailLoading = false;
    }
  }

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modalId = button.getAttribute('data-close-modal');
      if (modalId) closeModal(modalId);
    });
  });

  addToteBtn.addEventListener('click', () => {
    if (editableTotes.length >= MAX_TOTES_PER_VOYAGE) {
      setAutosaveState(`Maximum ${MAX_TOTES_PER_VOYAGE} Freight/Cargo entries per voyage.`);
      updateAddToteAvailability();
      return;
    }
    editableTotes.push({ toteId: 0, ownerEmployeeId: 0, fishTypeId: 0, quantity: 0 });
    lastEditedRowIndex = editableTotes.length - 1;
    setRowState(lastEditedRowIndex, 'New', 'pending');
    renderToteRows();
    renderEndPreview();
    persistDraftRows();
    setAutosaveState('Row added. Fill owner, cargo, and qty.');
    window.requestAnimationFrame(applyViewportFit);
  });

  async function handleShipStatusChange(nextStatus) {
    if (!canEditVoyage()) return;
    const currentStatus = String(detail?.voyage?.ship_status || 'IN_PORT');
    if (currentStatus === nextStatus) return;
    shipStatusToggle.disabled = true;
    shipStatusFeedback.dataset.temporary = '1';
    shipStatusFeedback.textContent = 'Updating...';
    try {
      const payload = await updateVoyageShipStatus(voyageId, nextStatus);
      detail = {
        ...detail,
        voyage: {
          ...(detail?.voyage || {}),
          ship_status: String(payload?.voyage?.shipStatus || payload?.voyage?.ship_status || nextStatus)
        }
      };
      renderShipStatusControls();
      shipStatusFeedback.textContent = '';
    } catch (error) {
      shipStatusFeedback.textContent = error.message || 'Unable to update ship status.';
    } finally {
      delete shipStatusFeedback.dataset.temporary;
      renderShipStatusControls();
    }
  }

  shipStatusToggle.addEventListener('click', () => {
    const currentStatus = String(detail?.voyage?.ship_status || 'IN_PORT').toUpperCase();
    const nextStatus = currentStatus === 'UNDERWAY' ? 'IN_PORT' : 'UNDERWAY';
    void handleShipStatusChange(nextStatus);
  });

  toteBody.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest('tr[data-tote-index]');
    if (!row) return;
    const idx = Number(row.getAttribute('data-tote-index'));
    if (!Number.isInteger(idx) || idx < 0 || idx >= editableTotes.length) return;

    const field = target.getAttribute('data-field');
    if (!field) return;
    if (field === 'quantity' && target instanceof HTMLInputElement) {
      editableTotes[idx].quantity = Math.max(0, toInt(target.value));
      lastEditedRowIndex = idx;
      setRowState(idx, 'Editing...', 'pending');
      setAutosaveState('Editing quantity...');
      persistDraftRows();
      return;
    } else if ((field === 'ownerEmployeeId' || field === 'fishTypeId') && target instanceof HTMLSelectElement) {
      editableTotes[idx][field] = Number(target.value) || 0;
    }
    lastEditedRowIndex = idx;
    persistDraftRows();
    renderToteRows();
    renderEndPreview();
    scheduleAutosave();
  });

  toteBody.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const row = target.closest('tr[data-tote-index]');
    if (!row) return;
    const idx = Number(row.getAttribute('data-tote-index'));
    if (!Number.isInteger(idx) || idx < 0 || idx >= editableTotes.length) return;

    const field = target.getAttribute('data-field');
    if (!field) return;
    if (field === 'quantity' && target instanceof HTMLInputElement) {
      editableTotes[idx].quantity = Math.max(0, toInt(target.value));
    } else if ((field === 'ownerEmployeeId' || field === 'fishTypeId') && target instanceof HTMLSelectElement) {
      editableTotes[idx][field] = Number(target.value) || 0;
    } else {
      return;
    }
    lastEditedRowIndex = idx;
    persistDraftRows();
    renderToteRows();
    renderEndPreview();
    scheduleAutosave();
  });

  toteBody.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const removeBtn = target.closest('[data-remove]');
    if (!removeBtn) return;
    const idx = Number(removeBtn.getAttribute('data-remove'));
    if (!Number.isInteger(idx) || idx < 0 || idx >= editableTotes.length) return;
    editableTotes.splice(idx, 1);
    persistDraftRows();
    rowSaveState = new Map();
    lastEditedRowIndex = -1;
    renderToteRows();
    renderEndPreview();
    scheduleAutosave();
  });

  toteBody.addEventListener('focusin', (event) => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.getAttribute('data-field') === 'quantity') {
      target.select();
    }
  });

  ownerSettlementBody.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const toteId = Number(target.getAttribute('data-lost-qty-tote-id'));
    if (!Number.isInteger(toteId) || toteId <= 0) return;
    const qty = Math.max(0, toInt(target.value));
    lostQtyByToteId.set(toteId, qty);
  });

  ownerSettlementBody.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const toteId = Number(target.getAttribute('data-lost-qty-tote-id'));
    if (!Number.isInteger(toteId) || toteId <= 0) return;
    const completed = editableTotes.find((row) => Number(row.toteId || 0) === toteId);
    const maxQty = Math.max(0, toInt(completed?.quantity || 0));
    const qty = Math.max(0, Math.min(maxQty, toInt(target.value)));
    lostQtyByToteId.set(toteId, qty);
    renderEndPreview();
  });

  ownerSettlementBody.addEventListener('input', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const rowKey = String(target.getAttribute('data-settlement-base-key') || '').trim();
    if (!rowKey) return;
    const value = Math.max(0, Number(target.value || 0));
    if (Number.isFinite(value)) {
      settlementBaseSellByKey.set(rowKey, value);
    }
  });

  ownerSettlementBody.addEventListener('change', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const rowKey = String(target.getAttribute('data-settlement-base-key') || '').trim();
    if (!rowKey) return;
    const value = Math.max(0, toMoney(target.value));
    settlementBaseSellByKey.set(rowKey, value);
    renderEndPreview({ preserveBaseKey: rowKey });
  });

  addLogForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(addLogForm);
    const message = text(data.get('message'));
    if (!message) return;
    try {
      await createVoyageLog(voyageId, message);
      addLogForm.reset();
      await loadDetail();
    } catch (error) {
      setInlineMessage(feedback, error.message || 'Unable to add ship log entry.');
    }
  });

  openEndVoyageBtn.addEventListener('click', () => {
    renderEndPreview();
    openModal('endVoyageModal');
  });

  sellLocationSelect.addEventListener('change', () => {
    renderEndPreview();
  });

  sellMultiplierInput.addEventListener('input', () => {
    renderEndPreview();
  });

  endForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!editableTotes.length) {
      return setInlineMessage(endFeedback, 'Add at least one cargo entry before finalizing.');
    }
    if (!editableTotes.every(isRowComplete)) {
      return setInlineMessage(endFeedback, 'All Freight/Cargo rows must include owner, cargo, and qty (>0) before finalizing.');
    }
    const sellLocationIdRaw = Number(sellLocationSelect.value);
    const sellLocationId = Number.isInteger(sellLocationIdRaw) && sellLocationIdRaw > 0 ? sellLocationIdRaw : null;
    const sellMultiplier = selectedMultiplier();
    if (!Number.isFinite(sellMultiplier) || sellMultiplier < 0) {
      return setInlineMessage(endFeedback, 'Multiplier must be 0 or greater.');
    }
    setInlineMessage(endFeedback, '');
    const submitBtn = endForm.querySelector('button[type="submit"]');
    if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = true;
    try {
      if (autosaveTimer) {
        window.clearTimeout(autosaveTimer);
        autosaveTimer = null;
      }
      await persistTotes();
      const settlementRows = editableTotes
        .map((row, idx) => ({ ...row, _index: idx }))
        .filter(isRowComplete)
        .map((row) => {
          const rowKey = settlementRowKey(row, row._index);
          const fish = fishById.get(Number(row.fishTypeId));
          const defaultBase = toMoney(fish?.unit_price || fish?.unitPrice || row.unitPrice || 0);
          const baseSellPrice = Math.max(
            0,
            toMoney(settlementBaseSellByKey.has(rowKey) ? settlementBaseSellByKey.get(rowKey) : defaultBase)
          );
          return {
            toteId: Number(row.toteId || 0),
            baseSellPrice
          };
        })
        .filter((row) => Number.isInteger(row.toteId) && row.toteId > 0);
      const lostRows = editableTotes
        .filter(isRowComplete)
        .map((row) => {
          const toteId = Number(row.toteId || 0);
          const qty = Math.max(0, Math.min(Math.max(0, toInt(row.quantity || 0)), toInt(lostQtyByToteId.get(toteId))));
          return { toteId, lostQuantity: qty };
        })
        .filter((row) => Number.isInteger(row.toteId) && row.toteId > 0 && row.lostQuantity > 0);
      await endVoyage(voyageId, {
        ...(sellLocationId ? { sellLocationId } : {}),
        sellMultiplier,
        settlementRows,
        lostRows
      });
      clearDraftRows();
      window.location.href = '/voyage-tracker';
    } catch (error) {
      setInlineMessage(endFeedback, error.message || 'Unable to finalise voyage.');
    } finally {
      if (submitBtn instanceof HTMLButtonElement) submitBtn.disabled = false;
    }
  });

  const holdMsFinalize = Number(finaliseVoyageBtn?.dataset.holdConfirmMs || 1000);
  const holdMsCancel = Number(cancelVoyageBtn?.dataset.holdConfirmMs || 1000);

  bindHoldToConfirm(
    finaliseVoyageBtn,
    async () => {
      if (!canEndVoyage()) return;
      endForm.requestSubmit();
    },
    holdMsFinalize
  );

  bindHoldToConfirm(
    cancelVoyageBtn,
    async () => {
      if (!canEndVoyage()) return;
      const multiplier = selectedMultiplier();
      const completedTotes = editableTotes
        .map((row) => ({ ...row, ownerName: currentOwnerName(row.ownerEmployeeId) }))
        .filter(isRowComplete);
      const settlement = calculateOwnerSettlement(
        completedTotes,
        fishById,
        multiplier,
        settlementBaseSellByKey,
        lostQtyByToteId,
        Number(detail?.voyage?.officer_of_watch_employee_id || 0)
      );
      if (settlement.totalEarnings > 0) {
        setInlineMessage(endFeedback, 'Cancel is only allowed when total cargo earnings are zero.');
        return;
      }

      setInlineMessage(endFeedback, '');
      cancelVoyageBtn.disabled = true;
      try {
        if (autosaveTimer) {
          window.clearTimeout(autosaveTimer);
          autosaveTimer = null;
        }
        await persistTotes();
        const lostRows = editableTotes
          .filter(isRowComplete)
          .map((row) => {
            const toteId = Number(row.toteId || 0);
            const qty = Math.max(0, Math.min(Math.max(0, toInt(row.quantity || 0)), toInt(lostQtyByToteId.get(toteId))));
            return { toteId, lostQuantity: qty };
          })
          .filter((row) => Number.isInteger(row.toteId) && row.toteId > 0 && row.lostQuantity > 0);
        await cancelVoyage(voyageId, { lostRows });
        clearDraftRows();
        closeModal('endVoyageModal');
        window.location.href = '/voyage-tracker';
      } catch (error) {
        setInlineMessage(endFeedback, error.message || 'Unable to cancel voyage.');
      } finally {
        cancelVoyageBtn.disabled = false;
      }
    },
    holdMsCancel
  );

  try {
    await loadDetail();
    window.requestAnimationFrame(applyViewportFit);
  } catch (error) {
    setInlineMessage(feedback, error.message || 'Unable to load voyage details.');
  }

  const scheduleFit = () => window.requestAnimationFrame(applyViewportFit);
  window.addEventListener('resize', scheduleFit);
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => scheduleFit());
    ro.observe(document.documentElement);
  }

  const AUTO_REFRESH_MS = 15000;
  const hasOpenModal = () => Boolean(document.querySelector('.modal-overlay:not(.hidden)'));
  const isUserEditing = () => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    return Boolean(
      active.matches('input, textarea, select, [contenteditable="true"]') ||
        active.closest(config.toteBodySelector) ||
        active.closest(config.addLogFormSelector) ||
        active.closest(config.endFormSelector)
    );
  };
  const canPassiveRefresh = () => !document.hidden && !autosaveInFlight && !autosaveTimer && !detailLoading && !hasOpenModal() && !isUserEditing();
  const refreshPassively = async () => {
    if (!canPassiveRefresh()) return;
    try {
      const payload = await getVoyage(voyageId, { includeSetup: true, includeManifest: true, includeLogs: true });
      await loadDetail({ payload, skipIfUnchanged: true });
    } catch {
      // Keep passive refresh silent to avoid noisy UI while actively working.
    }
  };
  window.setInterval(() => {
    void refreshPassively();
  }, AUTO_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshPassively();
  });
}

