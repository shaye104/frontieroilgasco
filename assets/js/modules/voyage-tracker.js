import {
  getLiveNotificationPresence,
  getVoyageOverview,
  releaseVoyageShipAssignment,
  reserveVoyageShipAssignment,
  searchEmployees,
  sendLiveNotification,
  startVoyage,
  timeoutVoyageShipAssignment
} from './admin-api.js?v=20260313d';
import { formatLocalDateTime } from './local-datetime.js';
import { hasPermission } from './nav.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const output = String(value ?? '').trim();
  return output || 'N/A';
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function toMoney(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n);
}

function formatMoney(value) {
  return `ƒ ${toMoney(value).toLocaleString()}`;
}

function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    if (timer) window.clearTimeout(timer);
    timer = window.setTimeout(() => fn(...args), wait);
  };
}

const VOYAGE_TRACKER_POLL_MS = 15000;
const SHIP_RESERVATION_HOLD_MS = 60 * 1000;
const SHIP_RESERVATION_COOLDOWN_MS = 60 * 1000;

function formatWhen(value) {
  if (!value) return 'N/A';
  return formatLocalDateTime(value, { fallback: text(value) });
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

function fillSelect(select, items, placeholder) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = [`<option value="">${placeholder}</option>`, ...items.map((item) => `<option value="${item.value}">${item.value}</option>`)]
    .join('');
  if (current) select.value = current;
}

function renderOngoingVoyageCards(target, voyages) {
  if (!target) return;
  if (!voyages.length) {
    target.innerHTML = `<article class="voyage-empty-state">
      <span class="voyage-empty-icon" aria-hidden="true">⛵</span>
      <h3>No ongoing voyages</h3>
      <p>Start a new voyage to begin tracking fleet activity.</p>
    </article>`;
    return;
  }

  target.innerHTML = voyages
    .map((voyage) => {
      const underway = voyage.ship_status === 'UNDERWAY';
      const shipStatusLabel = underway ? 'Ship Underway' : 'Ship In Port';
      const statusClass = underway ? 'status-pill status-pill-underway' : 'status-pill status-pill-in-port';
      return `
        <a class="voyage-card voyage-card-ongoing" href="/voyage-details.html?voyageId=${voyage.id}">
          <div class="voyage-card-head">
            <h3>${text(voyage.vessel_name)}</h3>
            <span class="${statusClass}">${shipStatusLabel}</span>
          </div>
          <p class="voyage-route-line">Port: ${text(voyage.departure_port)}</p>
          <div class="voyage-card-meta">
            <p class="voyage-meta-line"><span>Officer of the Watch (OOTW)</span>${text(voyage.officer_name)}</p>
            <p class="voyage-meta-line"><span>Started</span>${formatWhen(voyage.started_at)}</p>
          </div>
        </a>
      `;
    })
    .join('');
}

function renderArchivedVoyageCards(target, voyages) {
  if (!target) return;
  if (!voyages.length) {
    target.innerHTML = `<article class="voyage-empty-state voyage-empty-state-muted">
      <span class="voyage-empty-icon" aria-hidden="true">⌁</span>
      <h3>No past voyages</h3>
      <p>Ended and cancelled voyages will appear here.</p>
    </article>`;
    return;
  }

  target.innerHTML = voyages
    .map((voyage) => {
      const status = String(voyage?.status || '').toUpperCase();
      const isCancelled = status === 'CANCELLED';
      const statusClass = isCancelled ? 'status-pill status-pill-cancelled' : 'status-pill status-pill-ended';
      const statusLabel = isCancelled ? 'Cancelled' : 'Ended';
      return `
        <article class="voyage-card voyage-card-archived voyage-card-static" aria-label="Archived voyage preview">
          <div class="voyage-card-head">
            <h3>${text(voyage.vessel_name)}</h3>
            <span class="${statusClass}">${statusLabel}</span>
          </div>
          <p class="voyage-route-line">Port: ${text(voyage.departure_port)}</p>
          <div class="voyage-card-meta">
            <p class="voyage-meta-line"><span>Officer of the Watch (OOTW)</span>${text(voyage.officer_name)}</p>
            <p class="voyage-meta-line"><span>Ended</span>${formatWhen(voyage.ended_at)}</p>
            <p class="voyage-meta-line"><span>Trip</span>${formatMoney(voyage.profit || 0)}</p>
          </div>
        </article>
      `;
    })
    .join('');
}

function renderVoyageSkeleton(target, count = 3) {
  if (!target) return;
  target.innerHTML = Array.from({ length: count })
    .map(
      () => `<article class="voyage-card skeleton-shell">
        <div class="skeleton-line skeleton-w-60"></div>
        <div class="skeleton-line skeleton-w-80"></div>
        <div class="skeleton-line skeleton-w-45"></div>
      </article>`
    )
    .join('');
}

export async function initVoyageTracker(config, session) {
  const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  const feedback = document.querySelector(config.feedbackSelector);
  const ongoingRoot = document.querySelector(config.ongoingSelector);
  const archivedRoot = document.querySelector(config.archivedSelector);
  const archivedCta = document.querySelector(config.archivedCtaSelector);
  const ongoingCountChip = document.querySelector(config.ongoingCountSelector);
  const archivedCountChip = document.querySelector(config.archivedCountSelector);
  const startBtn = document.querySelector(config.startButtonSelector);
  const startForm = document.querySelector(config.startFormSelector);
  const departureSelect = document.querySelector(config.departureSelector);
  const vesselNameSelect = document.querySelector(config.vesselNameSelector);
  const vesselClassSelect = document.querySelector(config.vesselClassSelector);
  const vesselCallsignSelect = document.querySelector(config.vesselCallsignSelector);
  const reservationTokenInput = document.querySelector(config.reservationTokenSelector);
  const assignedVesselInfo = document.querySelector(config.assignedVesselInfoSelector);
  const startSubmitButton = document.querySelector(config.startSubmitSelector);
  const startHint = document.querySelector(config.startHintSelector);
  const oowHidden = document.querySelector(config.officerHiddenSelector);
  const oowSelected = document.querySelector(config.officerSelectedSelector);
  const crewSearch = document.querySelector(config.crewSearchSelector);
  const crewResults = document.querySelector(config.crewResultsSelector);
  const crewSelected = document.querySelector(config.crewSelectedSelector);
  const crewInfo = document.querySelector(config.crewInfoSelector);
  const crewError = document.querySelector(config.crewErrorSelector);
  const notifyOpenButton = document.querySelector(config.notifyOpenSelector);
  const notifyForm = document.querySelector(config.notifyFormSelector);
  const notifyTargetMode = document.querySelector(config.notifyTargetModeSelector);
  const notifySpecificPanel = document.querySelector(config.notifySpecificPanelSelector);
  const notifyUserSelect = document.querySelector(config.notifyUserSelectSelector);
  const notifySelectedUsers = document.querySelector(config.notifySelectedUsersSelector);
  const notifyFeedback = document.querySelector(config.notifyFeedbackSelector);
  const notifySendButton = document.querySelector(config.notifySendButtonSelector);

  if (
    !feedback ||
    !ongoingRoot ||
    !archivedRoot ||
    !archivedCta ||
    !ongoingCountChip ||
    !archivedCountChip ||
    !startBtn ||
    !startForm ||
    !departureSelect ||
    !vesselNameSelect ||
    !vesselClassSelect ||
    !vesselCallsignSelect ||
    !reservationTokenInput ||
    !assignedVesselInfo ||
    !startSubmitButton ||
    !startHint ||
    !oowHidden ||
    !oowSelected ||
    !crewSearch ||
    !crewResults ||
    !crewSelected ||
    !crewInfo ||
    !crewError ||
    !notifyOpenButton ||
    !notifyForm ||
    !notifyTargetMode ||
    !notifySpecificPanel ||
    !notifyUserSelect ||
    !notifySelectedUsers ||
    !notifyFeedback ||
    !notifySendButton
  ) {
    return;
  }

  let employees = [];
  let ongoing = [];
  let archived = [];
  let archivedTotal = 0;
  let ongoingKeys = new Set();
  let selectedCrewIds = new Set();
  const selectedCrewById = new Map();
  let selectedNotifyUserIds = new Set();
  const selectedNotifyUsersById = new Map();
  let notifyPresenceUsers = [];
  let myAssignedVessel = null;
  let currentEmployeeId = 0;
  let currentEmployeeUsername = '';
  let hasValidAssignment = true;
  const searchCache = new Map();
  let pollTimer = 0;
  let refreshInFlight = false;
  let lastBoardSignature = '';
  let activeShipReservation = null;
  let reservationTimeoutTimer = 0;
  let reservationCountdownTimer = 0;
  let startCooldownUntil = 0;
  let releasingReservation = false;

  function boardSignatureFromPayload(payload) {
    const ongoingRows = Array.isArray(payload?.ongoing) ? payload.ongoing : [];
    const archivedRows = Array.isArray(payload?.archived) ? payload.archived : [];
    const ongoingSig = ongoingRows
      .map((row) =>
        [
          Number(row?.id || 0),
          String(row?.status || ''),
          String(row?.ship_status || ''),
          String(row?.started_at || ''),
          String(row?.updated_at || '')
        ].join(':')
      )
      .join('|');
    const archivedSig = archivedRows
      .map((row) => [Number(row?.id || 0), String(row?.status || ''), String(row?.ended_at || ''), String(row?.updated_at || '')].join(':'))
      .join('|');
    const me = payload?.currentEmployee || {};
    const assignment = payload?.myVesselAssignment || {};
    return [
      ongoingSig,
      archivedSig,
      Number(payload?.counts?.archived || archivedRows.length || 0),
      Number(me?.id || 0),
      String(me?.robloxUsername || ''),
      String(assignment?.vessel_name || ''),
      String(assignment?.vessel_class || ''),
      String(assignment?.vessel_callsign || '')
    ].join('~');
  }

  function isModalOpen(modalId) {
    const modal = document.getElementById(modalId);
    if (!modal) return false;
    return !modal.classList.contains('hidden');
  }

  function shouldPauseAutoRefresh() {
    if (document.hidden) return true;
    if (isModalOpen('startVoyageModal') || isModalOpen('notifyModal')) return true;
    const active = document.activeElement;
    if (!active) return false;
    if (active === crewSearch || active === notifyUserSelect) return true;
    if (!(active instanceof HTMLElement)) return false;
    return Boolean(active.closest('#startVoyageForm, #notifyForm'));
  }

  async function autoRefreshBoard() {
    if (refreshInFlight || shouldPauseAutoRefresh()) return;
    refreshInFlight = true;
    try {
      await refreshBoard({ onlyIfChanged: true });
    } catch (error) {
      console.warn('[voyages] background refresh failed', error);
    } finally {
      refreshInFlight = false;
    }
  }

  function stopPolling() {
    if (pollTimer) {
      window.clearInterval(pollTimer);
      pollTimer = 0;
    }
  }

  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => {
      void autoRefreshBoard();
    }, VOYAGE_TRACKER_POLL_MS);
  }

  function clearReservationTimers() {
    if (reservationTimeoutTimer) {
      window.clearTimeout(reservationTimeoutTimer);
      reservationTimeoutTimer = 0;
    }
    if (reservationCountdownTimer) {
      window.clearInterval(reservationCountdownTimer);
      reservationCountdownTimer = 0;
    }
  }

  function renderReservationPending() {
    assignedVesselInfo.innerHTML = `
      <div class="voyage-assigned-ship-title">Ship Details</div>
      <div class="voyage-assigned-ship-meta">Reserving an available ship...</div>
    `;
  }

  function renderReservationDetails(reservation) {
    const vesselName = text(reservation?.vesselName || 'Assigned on start');
    const vesselCallsign = text(reservation?.vesselCallsign || 'Assigned on start');
    const vesselClass = text(reservation?.vesselClass || 'Assigned on start');
    assignedVesselInfo.innerHTML = `
      <div class="voyage-assigned-ship-title">Ship Details</div>
      <div class="voyage-assigned-ship-meta">Vessel Name: ${vesselName}</div>
      <div class="voyage-assigned-ship-meta">Vessel Callsign: ${vesselCallsign}</div>
      <div class="voyage-assigned-ship-meta">Vessel Class: ${vesselClass}</div>
    `;
  }

  function setStartCooldown(seconds) {
    const safeSeconds = Math.max(0, Number(seconds || 0));
    if (!safeSeconds) return;
    startCooldownUntil = Date.now() + safeSeconds * 1000;
  }

  function getCooldownSecondsLeft() {
    return Math.max(0, Math.ceil((startCooldownUntil - Date.now()) / 1000));
  }

  function updateStartSubmitState() {
    const departure = text(departureSelect.value);
    const hasPorts = Boolean(departure);
    const hasCrew = selectedCrewIds.size > 0;
    const hasReservation = Boolean(activeShipReservation?.token);
    const canStart = hasPorts && hasCrew && hasReservation;
    startSubmitButton.disabled = !canStart;
    if (!hasReservation) {
      startHint.textContent = 'Ship assignment pending. Please wait.';
      return;
    }
    const expiresAt = Number(activeShipReservation?.expiresAtMs || 0);
    const secondsLeft = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
    startHint.textContent = secondsLeft > 0 ? `Ship reservation expires in ${secondsLeft}s.` : '';
  }

  async function lookupEmployees(queryKind, queryValue) {
    const query = normalize(queryValue);
    if (!query) return [];
    const key = `${queryKind}:${query}`;
    if (searchCache.has(key)) return searchCache.get(key);
    const payload = await searchEmployees(queryKind === 'serial' ? { serial: query, limit: 12 } : { username: query, limit: 12 });
    const results = payload.employees || [];
    searchCache.set(key, results);
    return results;
  }

  function setupCombobox({ input, dropdown, errorTarget, onSearch, onSelect }) {
    let options = [];
    let activeIndex = -1;

    function closeList() {
      dropdown.classList.remove('is-open');
      dropdown.innerHTML = '';
      options = [];
      activeIndex = -1;
    }

    function renderList() {
      if (!options.length) {
        dropdown.classList.add('is-open');
        dropdown.innerHTML = '<div class="autocomplete-empty">No results</div>';
        return;
      }
      dropdown.classList.add('is-open');
      dropdown.innerHTML = options
        .map(
          (employee, index) => `<button class="autocomplete-item ${index === activeIndex ? 'is-active' : ''}" type="button" data-index="${index}">
          <span>${text(employee.roblox_username)}</span>
          <small>${text(employee.serial_number)}</small>
        </button>`
        )
        .join('');
      dropdown.querySelectorAll('[data-index]').forEach((button) => {
        button.addEventListener('mousedown', (event) => event.preventDefault());
        button.addEventListener('click', () => {
          const idx = Number(button.getAttribute('data-index'));
          const choice = options[idx];
          if (!choice) return;
          onSelect(choice);
          closeList();
        });
      });
    }

    const runSearch = debounce(async () => {
      const query = normalize(input.value);
      if (!query) {
        closeList();
        setInlineMessage(errorTarget, '');
        return;
      }
      try {
        options = (await onSearch(query)).slice(0, 12);
        setInlineMessage(errorTarget, '');
        activeIndex = options.length ? 0 : -1;
        renderList();
      } catch (error) {
        closeList();
        setInlineMessage(errorTarget, error.message || 'Search failed.');
      }
    }, 300);

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
        const choice = options[activeIndex];
        if (!choice) return;
        onSelect(choice);
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
      if (target instanceof Node && (input.contains(target) || dropdown.contains(target))) return;
      closeList();
    };

    input.addEventListener('focus', runSearch);
    input.addEventListener('input', runSearch);
    input.addEventListener('keydown', onKeyDown);
    document.addEventListener('pointerdown', onOutside);
    return () => {
      input.removeEventListener('focus', runSearch);
      input.removeEventListener('input', runSearch);
      input.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('pointerdown', onOutside);
      closeList();
    };
  }

  function renderCrewSelected() {
    if (!selectedCrewIds.size) {
      crewSelected.innerHTML = '<span class="muted">No crew selected.</span>';
      updateStartSubmitState();
      return;
    }

    crewSelected.innerHTML = [...selectedCrewIds]
      .map((employeeId) => {
        const employee =
          selectedCrewById.get(Number(employeeId)) ||
          employees.find((item) => Number(item.id) === Number(employeeId)) ||
          null;
        const label = text(employee?.roblox_username || `Employee #${employeeId}`);
        return `<span class="pill">
            ${label}
            <button type="button" class="pill-close" data-remove-crew="${Number(employeeId)}" aria-label="Remove crew member">x</button>
            <input type="hidden" name="crewComplementIds" value="${Number(employeeId)}" />
          </span>`;
      })
      .filter(Boolean)
      .join('');

    crewSelected.querySelectorAll('[data-remove-crew]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = Number(button.getAttribute('data-remove-crew'));
        selectedCrewIds.delete(id);
        selectedCrewById.delete(id);
        renderCrewSelected();
        updateStartSubmitState();
      });
    });
    updateStartSubmitState();
  }

  function clearStartForm() {
    startForm.reset();
    clearReservationTimers();
    activeShipReservation = null;
    oowHidden.value = '';
    reservationTokenInput.value = '';
    oowSelected.textContent = currentEmployeeUsername
      ? `Officer of the Watch (OOTW): ${currentEmployeeUsername}`
      : 'Officer of the Watch (OOTW): your account';
    setInlineMessage(crewError, '');
    setInlineMessage(crewInfo, '');
    crewSearch.value = '';
    crewResults.innerHTML = '';
    crewResults.classList.remove('is-open');
    vesselNameSelect.value = '';
    vesselClassSelect.value = '';
    vesselCallsignSelect.value = '';
    renderReservationPending();
    selectedCrewIds = new Set();
    selectedCrewById.clear();
    renderCrewSelected();
    updateStartSubmitState();
  }

  function setReservation(reservation) {
    activeShipReservation = {
      token: text(reservation?.token),
      vesselName: text(reservation?.vesselName),
      vesselCallsign: text(reservation?.vesselCallsign),
      vesselClass: text(reservation?.vesselClass),
      expiresAtMs: Date.now() + SHIP_RESERVATION_HOLD_MS
    };
    reservationTokenInput.value = activeShipReservation.token;
    vesselNameSelect.value = activeShipReservation.vesselName;
    vesselClassSelect.value = activeShipReservation.vesselClass;
    vesselCallsignSelect.value = activeShipReservation.vesselCallsign;
    renderReservationDetails(activeShipReservation);
    clearReservationTimers();
    reservationTimeoutTimer = window.setTimeout(() => {
      void timeoutActiveReservation();
    }, SHIP_RESERVATION_HOLD_MS);
    reservationCountdownTimer = window.setInterval(() => {
      updateStartSubmitState();
    }, 1000);
    updateStartSubmitState();
  }

  async function releaseActiveReservation() {
    if (releasingReservation || !activeShipReservation?.token) return;
    releasingReservation = true;
    const token = activeShipReservation.token;
    try {
      await releaseVoyageShipAssignment(token);
    } catch (error) {
      console.warn('[voyages] reservation release failed', error);
    } finally {
      releasingReservation = false;
      if (activeShipReservation?.token === token) {
        activeShipReservation = null;
        reservationTokenInput.value = '';
      }
      clearReservationTimers();
    }
  }

  async function timeoutActiveReservation() {
    const token = text(activeShipReservation?.token);
    if (!token) return;
    clearReservationTimers();
    try {
      const payload = await timeoutVoyageShipAssignment(token);
      const cooldownSeconds = Number(payload?.cooldown?.secondsLeft || SHIP_RESERVATION_COOLDOWN_SECONDS);
      setStartCooldown(cooldownSeconds);
    } catch (error) {
      setStartCooldown(SHIP_RESERVATION_COOLDOWN_SECONDS);
      console.warn('[voyages] reservation timeout failed', error);
    } finally {
      activeShipReservation = null;
      reservationTokenInput.value = '';
      closeModal('startVoyageModal');
      clearStartForm();
      showMessage(feedback, 'Ship reservation timed out. Please wait 60 seconds before trying again.', 'error');
    }
  }

  async function reserveShipForModal() {
    renderReservationPending();
    startSubmitButton.disabled = true;
    startHint.textContent = 'Reserving ship...';
    const payload = await reserveVoyageShipAssignment();
    const reservation = payload?.reservation || null;
    if (!reservation?.token) throw new Error('Unable to reserve ship.');
    setReservation(reservation);
  }

  function renderNotifySelectedUsers() {
    if (!selectedNotifyUserIds.size) {
      notifySelectedUsers.innerHTML = '<span class="muted">No users selected.</span>';
      return;
    }
    notifySelectedUsers.innerHTML = [...selectedNotifyUserIds]
      .map((employeeId) => {
        const employee =
          selectedNotifyUsersById.get(Number(employeeId)) ||
          employees.find((item) => Number(item.id) === Number(employeeId)) ||
          null;
        const label = text(employee?.roblox_username || `Employee #${employeeId}`);
        return `<span class="pill">
          ${label}
          <button type="button" class="pill-close" data-remove-notify-user="${Number(employeeId)}" aria-label="Remove recipient">x</button>
        </span>`;
      })
      .join('');
    notifySelectedUsers.querySelectorAll('[data-remove-notify-user]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = Number(button.getAttribute('data-remove-notify-user'));
        selectedNotifyUserIds.delete(id);
        selectedNotifyUsersById.delete(id);
        const option = notifyUserSelect.querySelector(`option[value="${id}"]`);
        if (option) option.selected = false;
        renderNotifySelectedUsers();
      });
    });
  }

  function renderNotifyUserOptions() {
    if (!notifyUserSelect) return;
    if (!notifyPresenceUsers.length) {
      notifyUserSelect.innerHTML = '';
      return;
    }
    notifyUserSelect.innerHTML = notifyPresenceUsers
      .map((user) => {
        const selected = selectedNotifyUserIds.has(Number(user.id)) ? ' selected' : '';
        const rank = text(user.rank);
        const username = text(user.roblox_username || `Employee #${user.id}`);
        const path = text(user.current_path || '/');
        const label = `${username} ${rank !== 'N/A' ? `(${rank})` : ''} - ${path}`;
        return `<option value="${Number(user.id)}"${selected}>${label}</option>`;
      })
      .join('');
  }

  function clearNotifyForm() {
    notifyForm.reset();
    notifyTargetMode.value = 'ONLINE_USERS';
    selectedNotifyUserIds = new Set();
    selectedNotifyUsersById.clear();
    notifyUserSelect.innerHTML = '';
    notifySpecificPanel.classList.add('hidden');
    setInlineMessage(notifyFeedback, '');
    renderNotifySelectedUsers();
  }

  async function loadNotifyPresenceUsers() {
    const payload = await getLiveNotificationPresence();
    const rows = Array.isArray(payload?.users) ? payload.users : [];
    notifyPresenceUsers = rows
      .map((row) => ({
        id: Number(row.id),
        roblox_username: text(row.roblox_username),
        serial_number: text(row.serial_number),
        rank: text(row.rank),
        current_path: text(row.current_path) || '/'
      }))
      .filter((row) => Number.isInteger(row.id) && row.id > 0);

    const allowedIds = new Set(notifyPresenceUsers.map((row) => row.id));
    selectedNotifyUserIds.forEach((id) => {
      if (!allowedIds.has(id)) {
        selectedNotifyUserIds.delete(id);
        selectedNotifyUsersById.delete(id);
      }
    });
    renderNotifyUserOptions();
    renderNotifySelectedUsers();
  }

  async function refreshBoard(options = {}) {
    const payload = await getVoyageOverview({ includeSetup: true, archivedLimit: 8 });
    const nextSignature = boardSignatureFromPayload(payload);
    if (options.onlyIfChanged && nextSignature === lastBoardSignature) {
      return false;
    }
    employees = payload.employees || [];
    ongoing = payload.ongoing || [];
    archived = payload.archived || [];
    archivedTotal = Number(payload?.counts?.archived || archived.length || 0);
    myAssignedVessel = payload?.myVesselAssignment || null;
    currentEmployeeId = Number(payload?.currentEmployee?.id || 0);
    currentEmployeeUsername = text(payload?.currentEmployee?.robloxUsername);
    console.info('[voyages] loaded', { ongoing: ongoing.length, archived: archived.length });
    ongoingKeys = new Set(ongoing.map((voyage) => `${normalize(voyage.vessel_name)}::${normalize(voyage.vessel_callsign)}`));

    if (hasPermission(session, 'voyages.create')) startBtn.classList.remove('hidden');
    else startBtn.classList.add('hidden');

    fillSelect(departureSelect, payload.voyageConfig?.ports || [], 'Select departure port');
    vesselNameSelect.value = '';
    vesselClassSelect.value = '';
    vesselCallsignSelect.value = '';
    reservationTokenInput.value = '';
    renderReservationPending();
    oowHidden.value = currentEmployeeId > 0 ? String(currentEmployeeId) : '';
    oowSelected.textContent = currentEmployeeUsername
      ? `Officer of the Watch (OOTW): ${currentEmployeeUsername}`
      : 'Officer of the Watch (OOTW): your account';
    renderCrewSelected();
    renderOngoingVoyageCards(ongoingRoot, ongoing);
    renderArchivedVoyageCards(archivedRoot, archived);
    ongoingCountChip.textContent = String(ongoing.length);
    archivedCountChip.textContent = String(archivedTotal);
    archivedCta.classList.toggle('hidden', archivedTotal <= 8);
    if (startedAt) {
      const elapsed = Math.round(performance.now() - startedAt);
      console.info('[perf] voyage tracker first data render', { ms: elapsed });
    }
    lastBoardSignature = nextSignature;
    return true;
  }

  startBtn.addEventListener('click', async () => {
    const cooldownLeft = getCooldownSecondsLeft();
    if (cooldownLeft > 0) {
      showMessage(feedback, `Please wait ${cooldownLeft}s before starting another voyage.`, 'error');
      return;
    }
    clearStartForm();
    openModal('startVoyageModal');
    try {
      await reserveShipForModal();
      updateStartSubmitState();
    } catch (error) {
      closeModal('startVoyageModal');
      clearStartForm();
      showMessage(feedback, error.message || 'Unable to reserve a ship right now.', 'error');
    }
  });
  notifyOpenButton.addEventListener('click', () => {
    clearNotifyForm();
    openModal('notifyModal');
    void loadNotifyPresenceUsers().catch(() => {
      setInlineMessage(notifyFeedback, 'Unable to load currently active users.');
    });
  });
  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', async () => {
      const modalId = button.getAttribute('data-close-modal');
      if (!modalId) return;
      if (modalId === 'startVoyageModal') {
        await releaseActiveReservation();
        clearStartForm();
      }
      closeModal(modalId);
    });
  });

  notifyUserSelect.addEventListener('change', () => {
    const options = [...notifyUserSelect.options];
    selectedNotifyUserIds = new Set();
    selectedNotifyUsersById.clear();
    options.forEach((option) => {
      if (!option.selected) return;
      const id = Number(option.value);
      if (!Number.isInteger(id) || id <= 0) return;
      selectedNotifyUserIds.add(id);
      const user = notifyPresenceUsers.find((entry) => Number(entry.id) === id);
      if (user) selectedNotifyUsersById.set(id, user);
    });
    setInlineMessage(notifyFeedback, '');
    renderNotifySelectedUsers();
  });

  notifyTargetMode.addEventListener('change', () => {
    const isSpecific = normalize(notifyTargetMode.value) === 'select_users';
    notifySpecificPanel.classList.toggle('hidden', !isSpecific);
    if (isSpecific) {
      void loadNotifyPresenceUsers().catch(() => {
        setInlineMessage(notifyFeedback, 'Unable to load currently active users.');
      });
    } else {
      selectedNotifyUserIds = new Set();
      selectedNotifyUsersById.clear();
      renderNotifySelectedUsers();
    }
  });

  notifyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    setInlineMessage(notifyFeedback, '');
    const data = new FormData(notifyForm);
    const targetModeRaw = normalize(data.get('targetMode'));
    const targetMode = targetModeRaw === 'select_users' ? 'SELECT_USERS' : targetModeRaw === 'all_users' ? 'ALL_USERS' : 'ONLINE_USERS';
    const employeeIds = [...selectedNotifyUserIds];
    if (targetMode === 'SELECT_USERS' && !employeeIds.length) {
      setInlineMessage(notifyFeedback, 'Select at least one currently active user.');
      return;
    }
    notifySendButton.disabled = true;
    notifySendButton.textContent = 'Sending...';
    try {
      await sendLiveNotification({
        severity: text(data.get('severity')).toUpperCase() === 'URGENT' ? 'URGENT' : 'STANDARD',
        title: text(data.get('title')),
        message: text(data.get('message')),
        targetMode,
        employeeIds
      });
      closeModal('notifyModal');
      clearNotifyForm();
      showMessage(feedback, 'Live notification sent.', 'success');
    } catch (error) {
      setInlineMessage(notifyFeedback, error.message || 'Unable to send notification.');
    } finally {
      notifySendButton.disabled = false;
      notifySendButton.textContent = 'Send';
    }
  });

  setupCombobox({
    input: crewSearch,
    dropdown: crewResults,
    errorTarget: crewError,
    onSearch: async (query) =>
      (await lookupEmployees('username', query))
        .filter((employee) => !selectedCrewIds.has(Number(employee.id)))
        .filter((employee) => Number(employee.id) !== Number(currentEmployeeId || oowHidden.value || 0)),
    onSelect: (employee) => {
      const selectedId = Number(employee.id);
      const skipperId = Number(currentEmployeeId || oowHidden.value || 0);
      if (selectedId === skipperId) {
        setInlineMessage(crewError, 'Officer of the Watch (OOTW) cannot be added to crew.');
        return;
      }
      selectedCrewIds.add(selectedId);
      selectedCrewById.set(selectedId, employee);
      crewSearch.value = '';
      setInlineMessage(crewError, '');
      setInlineMessage(crewInfo, '');
      renderCrewSelected();
      updateStartSubmitState();
    }
  });

  departureSelect.addEventListener('change', updateStartSubmitState);

  startForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);
    const data = new FormData(startForm);
    const reservationToken = text(data.get('reservationToken'));

    const officerOfWatchEmployeeId = Number(data.get('officerOfWatchEmployeeId') || currentEmployeeId);
    const crewComplementIds = data
      .getAll('crewComplementIds')
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value));
    if (!crewComplementIds.length) {
      showMessage(feedback, 'Crew complement requires at least one employee.', 'error');
      return;
    }
    if (crewComplementIds.includes(officerOfWatchEmployeeId)) {
      showMessage(feedback, 'Officer of the Watch (OOTW) cannot be added to crew.', 'error');
      return;
    }
    if (!reservationToken) {
      showMessage(feedback, 'Ship reservation missing. Reopen Start Voyage and try again.', 'error');
      return;
    }

    try {
      const departurePort = text(data.get('departurePort'));
      const payload = await startVoyage({
        departurePort,
        destinationPort: departurePort,
        reservationToken,
        officerOfWatchEmployeeId,
        crewComplementIds
      });

      clearReservationTimers();
      activeShipReservation = null;
      reservationTokenInput.value = '';
      closeModal('startVoyageModal');
      clearStartForm();
      showMessage(feedback, 'Voyage started.', 'success');
      window.location.href = `/voyage-details.html?voyageId=${payload.voyageId}`;
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to start voyage.', 'error');
    }
  });

  try {
    renderVoyageSkeleton(ongoingRoot, 3);
    renderVoyageSkeleton(archivedRoot, 3);
    await refreshBoard();
    startPolling();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      void autoRefreshBoard();
    });
    window.addEventListener('focus', () => {
      void autoRefreshBoard();
    });
    renderNotifySelectedUsers();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load voyages.', 'error');
    ongoingRoot.innerHTML = '<article class="voyage-empty-state"><h3>Unable to load data</h3><p>Please refresh and try again.</p></article>';
    archivedRoot.innerHTML = '<article class="voyage-empty-state voyage-empty-state-muted"><h3>Unable to load data</h3><p>Please refresh and try again.</p></article>';
    ongoingCountChip.textContent = '0';
    archivedCountChip.textContent = '0';
    archivedCta.classList.add('hidden');
  }
}
