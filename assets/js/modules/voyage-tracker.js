import { listVoyages, searchEmployees, startVoyage } from './admin-api.js';
import { hasPermission } from './intranet-page-guard.js';
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
  if (Number.isNaN(date.getTime())) return text(value);
  return date.toLocaleString();
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

function fillSelect(select, items, placeholder) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = [`<option value="">${placeholder}</option>`, ...items.map((item) => `<option value="${item.value}">${item.value}</option>`)]
    .join('');
  if (current) select.value = current;
}

function renderVoyageCards(target, voyages, isOngoing) {
  if (!target) return;
  if (!voyages.length) {
    target.innerHTML = `<p>${isOngoing ? 'No ongoing voyages.' : 'No archived voyages.'}</p>`;
    return;
  }

  target.innerHTML = voyages
    .map((voyage) => {
      const underway = voyage.ship_status === 'UNDERWAY';
      const shipStatusLabel = underway ? 'Ship Underway' : 'Ship In Port';
      return `
        <article class="panel voyage-card">
          <div class="modal-header">
            <h3>${text(voyage.vessel_name)} | ${text(voyage.vessel_callsign)}</h3>
            <span class="voyage-status ${isOngoing && underway ? 'voyage-status-active' : ''}">${isOngoing ? shipStatusLabel : 'Ended'}</span>
          </div>
          <p><strong>Route:</strong> ${text(voyage.departure_port)} -> ${text(voyage.destination_port)}</p>
          <p><strong>Officer of the Watch:</strong> ${text(voyage.officer_name)}</p>
          <p><strong>${isOngoing ? 'Started' : 'Ended'}:</strong> ${formatWhen(isOngoing ? voyage.started_at : voyage.ended_at)}</p>
          <div class="modal-actions">
            <a class="btn btn-secondary" href="voyage-details.html?voyageId=${voyage.id}">Open</a>
          </div>
        </article>
      `;
    })
    .join('');
}

export async function initVoyageTracker(config, session) {
  const feedback = document.querySelector(config.feedbackSelector);
  const ongoingRoot = document.querySelector(config.ongoingSelector);
  const archivedRoot = document.querySelector(config.archivedSelector);
  const startBtn = document.querySelector(config.startButtonSelector);
  const startForm = document.querySelector(config.startFormSelector);
  const departureSelect = document.querySelector(config.departureSelector);
  const destinationSelect = document.querySelector(config.destinationSelector);
  const vesselNameSelect = document.querySelector(config.vesselNameSelector);
  const vesselClassSelect = document.querySelector(config.vesselClassSelector);
  const vesselCallsignSelect = document.querySelector(config.vesselCallsignSelector);
  const oowSearch = document.querySelector(config.officerSearchSelector);
  const oowResults = document.querySelector(config.officerResultsSelector);
  const oowHidden = document.querySelector(config.officerHiddenSelector);
  const oowSelected = document.querySelector(config.officerSelectedSelector);
  const crewSearch = document.querySelector(config.crewSearchSelector);
  const crewResults = document.querySelector(config.crewResultsSelector);
  const crewSelected = document.querySelector(config.crewSelectedSelector);

  if (
    !feedback ||
    !ongoingRoot ||
    !archivedRoot ||
    !startBtn ||
    !startForm ||
    !departureSelect ||
    !destinationSelect ||
    !vesselNameSelect ||
    !vesselClassSelect ||
    !vesselCallsignSelect ||
    !oowSearch ||
    !oowResults ||
    !oowHidden ||
    !oowSelected ||
    !crewSearch ||
    !crewResults ||
    !crewSelected
  ) {
    return;
  }

  let employees = [];
  let ongoing = [];
  let archived = [];
  let ongoingKeys = new Set();
  let selectedCrewIds = new Set();
  const searchCache = new Map();

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

  async function renderOowResults() {
    const matches = await lookupEmployees('username', oowSearch.value);
    oowResults.innerHTML = matches
      .map(
        (employee) => `<button class="autocomplete-item" type="button" data-oow-id="${employee.id}">
          <span>${text(employee.roblox_username)}</span>
          <small>${text(employee.serial_number)}</small>
        </button>`
      )
      .join('');

    oowResults.querySelectorAll('[data-oow-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const selectedId = Number(button.getAttribute('data-oow-id'));
        const selected = employees.find((employee) => Number(employee.id) === selectedId);
        if (!selected) return;
        oowHidden.value = String(selected.id);
        oowSelected.textContent = `Selected OOW: ${text(selected.roblox_username)}`;
        if (selectedCrewIds.has(selectedId)) {
          selectedCrewIds.delete(selectedId);
          renderCrewSelected();
          showMessage(feedback, 'Officer of the Watch cannot be added to crew.', 'error');
        }
        oowResults.innerHTML = '';
        oowSearch.value = '';
      });
    });
  }

  function renderCrewSelected() {
    if (!selectedCrewIds.size) {
      crewSelected.innerHTML = '<span class="muted">No crew selected.</span>';
      return;
    }

    crewSelected.innerHTML = [...selectedCrewIds]
      .map((employeeId) => {
        const employee = employees.find((item) => Number(item.id) === Number(employeeId));
        if (!employee) return '';
        return `<span class="pill">
            ${text(employee.roblox_username)}
            <button type="button" class="pill-close" data-remove-crew="${employee.id}" aria-label="Remove crew member">x</button>
            <input type="hidden" name="crewComplementIds" value="${employee.id}" />
          </span>`;
      })
      .join('');

    crewSelected.querySelectorAll('[data-remove-crew]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = Number(button.getAttribute('data-remove-crew'));
        selectedCrewIds.delete(id);
        renderCrewSelected();
      });
    });
  }

  async function renderCrewResults() {
    const oowId = Number(oowHidden.value || 0);
    const matches = (await lookupEmployees('username', crewSearch.value))
      .filter((employee) => !selectedCrewIds.has(Number(employee.id)))
      .filter((employee) => Number(employee.id) !== oowId)
      .slice(0, 10);

    crewResults.innerHTML = matches
      .map(
        (employee) => `<button class="autocomplete-item" type="button" data-crew-id="${employee.id}">
          <span>${text(employee.roblox_username)}</span>
          <small>${text(employee.serial_number)}</small>
        </button>`
      )
      .join('');

    crewResults.querySelectorAll('[data-crew-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const selectedId = Number(button.getAttribute('data-crew-id'));
        if (selectedId === oowId) {
          showMessage(feedback, 'Officer of the Watch cannot be added to crew.', 'error');
          return;
        }
        selectedCrewIds.add(selectedId);
        crewSearch.value = '';
        void renderCrewResults();
        renderCrewSelected();
      });
    });
  }

  function clearStartForm() {
    startForm.reset();
    oowHidden.value = '';
    oowSelected.textContent = 'No officer selected.';
    oowSearch.value = '';
    oowResults.innerHTML = '';
    crewSearch.value = '';
    crewResults.innerHTML = '';
    selectedCrewIds = new Set();
    renderCrewSelected();
  }

  async function refreshBoard() {
    const [ongoingPayload, archivedPayload] = await Promise.all([
      listVoyages({ includeSetup: true, status: 'ONGOING', page: 1, pageSize: 100 }),
      listVoyages({ status: 'ENDED', page: 1, pageSize: 20 })
    ]);
    employees = ongoingPayload.employees || [];
    ongoing = ongoingPayload.voyages || ongoingPayload.ongoing || [];
    archived = archivedPayload.voyages || archivedPayload.archived || [];
    ongoingKeys = new Set(ongoing.map((voyage) => `${normalize(voyage.vessel_name)}::${normalize(voyage.vessel_callsign)}`));

    if (hasPermission(session, 'voyages.create')) startBtn.classList.remove('hidden');
    else startBtn.classList.add('hidden');

    fillSelect(departureSelect, ongoingPayload.voyageConfig?.ports || [], 'Select departure port');
    fillSelect(destinationSelect, ongoingPayload.voyageConfig?.ports || [], 'Select destination port');
    fillSelect(vesselNameSelect, ongoingPayload.voyageConfig?.vesselNames || [], 'Select vessel name');
    fillSelect(vesselClassSelect, ongoingPayload.voyageConfig?.vesselClasses || [], 'Select vessel class');
    fillSelect(vesselCallsignSelect, ongoingPayload.voyageConfig?.vesselCallsigns || [], 'Select vessel callsign');
    renderCrewSelected();
    renderVoyageCards(ongoingRoot, ongoing, true);
    renderVoyageCards(archivedRoot, archived, false);
  }

  startBtn.addEventListener('click', () => openModal('startVoyageModal'));
  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modalId = button.getAttribute('data-close-modal');
      if (modalId) closeModal(modalId);
    });
  });

  oowSearch.addEventListener('input', debounce(() => void renderOowResults(), 250));
  oowSearch.addEventListener('focus', () => void renderOowResults());
  crewSearch.addEventListener('input', debounce(() => void renderCrewResults(), 250));
  crewSearch.addEventListener('focus', () => void renderCrewResults());

  startForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);
    const data = new FormData(startForm);

    const vesselName = text(data.get('vesselName'));
    const vesselCallsign = text(data.get('vesselCallsign'));
    const duplicateKey = `${normalize(vesselName)}::${normalize(vesselCallsign)}`;
    if (ongoingKeys.has(duplicateKey)) {
      showMessage(feedback, 'That vessel and callsign are already underway on another ongoing voyage.', 'error');
      return;
    }

    const officerOfWatchEmployeeId = Number(data.get('officerOfWatchEmployeeId'));
    const crewComplementIds = data
      .getAll('crewComplementIds')
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value));
    if (!crewComplementIds.length) {
      showMessage(feedback, 'Crew complement requires at least one employee.', 'error');
      return;
    }
    if (crewComplementIds.includes(officerOfWatchEmployeeId)) {
      showMessage(feedback, 'Officer of the Watch cannot be added to crew.', 'error');
      return;
    }

    try {
      const payload = await startVoyage({
        departurePort: text(data.get('departurePort')),
        destinationPort: text(data.get('destinationPort')),
        vesselName,
        vesselClass: text(data.get('vesselClass')),
        vesselCallsign,
        officerOfWatchEmployeeId,
        crewComplementIds
      });

      closeModal('startVoyageModal');
      clearStartForm();
      showMessage(feedback, 'Voyage started.', 'success');
      window.location.href = `voyage-details.html?voyageId=${payload.voyageId}`;
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to start voyage.', 'error');
    }
  });

  try {
    await refreshBoard();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load voyages.', 'error');
  }
}
