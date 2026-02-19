import { listVoyages, startVoyage } from './admin-api.js';
import { hasPermission } from './intranet-page-guard.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const output = String(value ?? '').trim();
  return output || 'N/A';
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
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

function renderVoyageCards(target, voyages, isOngoing) {
  if (!target) return;
  if (!voyages.length) {
    target.innerHTML = `<p>${isOngoing ? 'No ongoing voyages.' : 'No archived voyages.'}</p>`;
    return;
  }

  target.innerHTML = voyages
    .map(
      (voyage) => `
        <article class="panel voyage-card">
          <div class="modal-header">
            <h3>${text(voyage.vessel_name)} | ${text(voyage.vessel_callsign)}</h3>
            <span class="voyage-status ${isOngoing ? 'voyage-status-active' : ''}">${isOngoing ? 'Underway' : 'Ended'}</span>
          </div>
          <p><strong>Route:</strong> ${text(voyage.departure_port)} -> ${text(voyage.destination_port)}</p>
          <p><strong>Officer of the Watch:</strong> ${text(voyage.officer_name)}</p>
          <p><strong>${isOngoing ? 'Started' : 'Ended'}:</strong> ${formatWhen(isOngoing ? voyage.started_at : voyage.ended_at)}</p>
          <a class="btn btn-secondary" href="voyage-details.html?voyageId=${voyage.id}">Open</a>
        </article>
      `
    )
    .join('');
}

function fillSelect(select, items, placeholder) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = [`<option value="">${placeholder}</option>`, ...items.map((item) => `<option value="${item.value}">${item.value}</option>`)]
    .join('');
  if (current) select.value = current;
}

function employeeSearchMatches(employee, query) {
  if (!query) return true;
  const serial = normalize(employee.serial_number);
  return serial.includes(query);
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
  let ongoingKeys = new Set();
  let selectedCrewIds = new Set();

  function renderOowResults() {
    const query = normalize(oowSearch.value);
    const matches = employees.filter((employee) => employeeSearchMatches(employee, query)).slice(0, 8);
    oowResults.innerHTML = matches
      .map(
        (employee) => `<button class="autocomplete-item" type="button" data-oow-id="${employee.id}">
          <span>${text(employee.roblox_username)}</span>
          <small>Serial: ${text(employee.serial_number)}</small>
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

  function renderCrewResults() {
    const query = normalize(crewSearch.value);
    const matches = employees
      .filter((employee) => !selectedCrewIds.has(Number(employee.id)))
      .filter((employee) => employeeSearchMatches(employee, query))
      .slice(0, 10);
    crewResults.innerHTML = matches
      .map(
        (employee) => `<button class="autocomplete-item" type="button" data-crew-id="${employee.id}">
          <span>${text(employee.roblox_username)}</span>
          <small>Serial: ${text(employee.serial_number)}</small>
        </button>`
      )
      .join('');

    crewResults.querySelectorAll('[data-crew-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const selectedId = Number(button.getAttribute('data-crew-id'));
        selectedCrewIds.add(selectedId);
        crewSearch.value = '';
        renderCrewResults();
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
    const payload = await listVoyages();
    employees = payload.employees || [];
    ongoingKeys = new Set(
      (payload.ongoing || []).map((voyage) => `${normalize(voyage.vessel_name)}::${normalize(voyage.vessel_callsign)}`)
    );

    if (hasPermission(session, 'voyages.create')) startBtn.classList.remove('hidden');
    else startBtn.classList.add('hidden');

    fillSelect(departureSelect, payload.voyageConfig?.ports || [], 'Select departure port');
    fillSelect(destinationSelect, payload.voyageConfig?.ports || [], 'Select destination port');
    fillSelect(vesselNameSelect, payload.voyageConfig?.vesselNames || [], 'Select vessel name');
    fillSelect(vesselClassSelect, payload.voyageConfig?.vesselClasses || [], 'Select vessel class');
    fillSelect(vesselCallsignSelect, payload.voyageConfig?.vesselCallsigns || [], 'Select vessel callsign');
    renderCrewSelected();
    renderVoyageCards(ongoingRoot, payload.ongoing || [], true);
    renderVoyageCards(archivedRoot, payload.archived || [], false);
  }

  startBtn.addEventListener('click', () => openModal('startVoyageModal'));
  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modalId = button.getAttribute('data-close-modal');
      if (modalId) closeModal(modalId);
    });
  });

  oowSearch.addEventListener('input', renderOowResults);
  oowSearch.addEventListener('focus', renderOowResults);
  crewSearch.addEventListener('input', renderCrewResults);
  crewSearch.addEventListener('focus', renderCrewResults);

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

    const crewComplementIds = data.getAll('crewComplementIds').map((value) => Number(value)).filter((value) => Number.isInteger(value));
    if (!crewComplementIds.length) {
      showMessage(feedback, 'Crew complement requires at least one employee.', 'error');
      return;
    }

    try {
      const payload = await startVoyage({
        departurePort: text(data.get('departurePort')),
        destinationPort: text(data.get('destinationPort')),
        vesselName,
        vesselClass: text(data.get('vesselClass')),
        vesselCallsign,
        officerOfWatchEmployeeId: Number(data.get('officerOfWatchEmployeeId')),
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
