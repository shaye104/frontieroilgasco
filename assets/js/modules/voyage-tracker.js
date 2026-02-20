import { getVoyageOverview, searchEmployees, startVoyage } from './admin-api.js';
import { hasPermission } from './nav.js';
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

function renderVoyageCards(target, voyages, isOngoing) {
  if (!target) return;
  if (!voyages.length) {
    if (isOngoing) {
      target.innerHTML = `<article class="voyage-empty-state">
        <span class="voyage-empty-icon" aria-hidden="true">⛵</span>
        <h3>No ongoing voyages</h3>
        <p>Start a new voyage to begin tracking fleet activity.</p>
      </article>`;
      return;
    }
    target.innerHTML = `<article class="voyage-empty-state voyage-empty-state-muted">
      <span class="voyage-empty-icon" aria-hidden="true">⌁</span>
      <h3>No archived voyages</h3>
      <p>Ended voyages will appear here.</p>
    </article>`;
    return;
  }

  target.innerHTML = voyages
    .map((voyage) => {
      const underway = voyage.ship_status === 'UNDERWAY';
      const shipStatusLabel = underway ? 'Ship Underway' : 'Ship In Port';
      const statusClass = isOngoing
        ? underway
          ? 'status-pill status-pill-underway'
          : 'status-pill status-pill-in-port'
        : 'status-pill status-pill-ended';
      return `
        <a class="voyage-card ${isOngoing ? 'voyage-card-ongoing' : 'voyage-card-archived'}" href="/voyage-details.html?voyageId=${voyage.id}">
          <div class="voyage-card-head">
            <h3>${text(voyage.vessel_name)} | ${text(voyage.vessel_callsign)}</h3>
            <span class="${statusClass}">${isOngoing ? shipStatusLabel : 'Ended'}</span>
          </div>
          <p class="voyage-route-line">${text(voyage.departure_port)} → ${text(voyage.destination_port)}</p>
          <div class="voyage-card-meta">
            <p class="voyage-meta-line"><span>OOW</span>${text(voyage.officer_name)}</p>
            <p class="voyage-meta-line"><span>${isOngoing ? 'Started' : 'Ended'}</span>${formatWhen(isOngoing ? voyage.started_at : voyage.ended_at)}</p>
          </div>
        </a>
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
  const destinationSelect = document.querySelector(config.destinationSelector);
  const vesselNameSelect = document.querySelector(config.vesselNameSelector);
  const vesselClassSelect = document.querySelector(config.vesselClassSelector);
  const vesselCallsignSelect = document.querySelector(config.vesselCallsignSelector);
  const oowSearch = document.querySelector(config.officerSearchSelector);
  const oowResults = document.querySelector(config.officerResultsSelector);
  const oowHidden = document.querySelector(config.officerHiddenSelector);
  const oowSelected = document.querySelector(config.officerSelectedSelector);
  const oowError = document.querySelector(config.officerErrorSelector);
  const crewSearch = document.querySelector(config.crewSearchSelector);
  const crewResults = document.querySelector(config.crewResultsSelector);
  const crewSelected = document.querySelector(config.crewSelectedSelector);
  const crewInfo = document.querySelector(config.crewInfoSelector);
  const crewError = document.querySelector(config.crewErrorSelector);

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
    !destinationSelect ||
    !vesselNameSelect ||
    !vesselClassSelect ||
    !vesselCallsignSelect ||
    !oowSearch ||
    !oowResults ||
    !oowHidden ||
    !oowSelected ||
    !oowError ||
    !crewSearch ||
    !crewResults ||
    !crewSelected ||
    !crewInfo ||
    !crewError
  ) {
    return;
  }

  let employees = [];
  let ongoing = [];
  let archived = [];
  let archivedTotal = 0;
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

  function clearStartForm() {
    startForm.reset();
    oowHidden.value = '';
    oowSelected.textContent = 'No officer selected.';
    setInlineMessage(oowError, '');
    setInlineMessage(crewError, '');
    setInlineMessage(crewInfo, '');
    oowSearch.value = '';
    oowResults.innerHTML = '';
    oowResults.classList.remove('is-open');
    crewSearch.value = '';
    crewResults.innerHTML = '';
    crewResults.classList.remove('is-open');
    selectedCrewIds = new Set();
    renderCrewSelected();
  }

  async function refreshBoard() {
    const payload = await getVoyageOverview({ includeSetup: true, archivedLimit: 6 });
    employees = payload.employees || [];
    ongoing = payload.ongoing || [];
    archived = payload.archived || [];
    archivedTotal = Number(payload?.counts?.archived || archived.length || 0);
    console.info('[voyages] loaded', { ongoing: ongoing.length, archived: archived.length });
    ongoingKeys = new Set(ongoing.map((voyage) => `${normalize(voyage.vessel_name)}::${normalize(voyage.vessel_callsign)}`));

    if (hasPermission(session, 'voyages.create')) startBtn.classList.remove('hidden');
    else startBtn.classList.add('hidden');

    fillSelect(departureSelect, payload.voyageConfig?.ports || [], 'Select departure port');
    fillSelect(destinationSelect, payload.voyageConfig?.ports || [], 'Select destination port');
    fillSelect(vesselNameSelect, payload.voyageConfig?.vesselNames || [], 'Select vessel name');
    fillSelect(vesselClassSelect, payload.voyageConfig?.vesselClasses || [], 'Select vessel class');
    fillSelect(vesselCallsignSelect, payload.voyageConfig?.vesselCallsigns || [], 'Select vessel callsign');
    renderCrewSelected();
    renderVoyageCards(ongoingRoot, ongoing, true);
    renderVoyageCards(archivedRoot, archived, false);
    ongoingCountChip.textContent = String(ongoing.length);
    archivedCountChip.textContent = String(archivedTotal);
    archivedCta.classList.toggle('hidden', archivedTotal <= 6);
    if (startedAt) {
      const elapsed = Math.round(performance.now() - startedAt);
      console.info('[perf] voyage tracker first data render', { ms: elapsed });
    }
  }

  startBtn.addEventListener('click', () => openModal('startVoyageModal'));
  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modalId = button.getAttribute('data-close-modal');
      if (modalId) closeModal(modalId);
    });
  });

  setupCombobox({
    input: oowSearch,
    dropdown: oowResults,
    errorTarget: oowError,
    onSearch: (query) => lookupEmployees('username', query),
    onSelect: (employee) => {
      const selectedId = Number(employee.id);
      oowHidden.value = String(selectedId);
      oowSelected.textContent = `Selected OOW: ${text(employee.roblox_username)}`;
      oowSearch.value = '';
      setInlineMessage(oowError, '');
      if (selectedCrewIds.has(selectedId)) {
        selectedCrewIds.delete(selectedId);
        renderCrewSelected();
        setInlineMessage(crewInfo, `Removed ${text(employee.roblox_username)} from crew because they are OOW.`, 'success');
      }
    }
  });

  setupCombobox({
    input: crewSearch,
    dropdown: crewResults,
    errorTarget: crewError,
    onSearch: async (query) =>
      (await lookupEmployees('username', query))
        .filter((employee) => !selectedCrewIds.has(Number(employee.id)))
        .filter((employee) => Number(employee.id) !== Number(oowHidden.value || 0)),
    onSelect: (employee) => {
      const selectedId = Number(employee.id);
      const oowId = Number(oowHidden.value || 0);
      if (selectedId === oowId) {
        setInlineMessage(crewError, 'Officer of the Watch cannot be added to crew.');
        return;
      }
      selectedCrewIds.add(selectedId);
      crewSearch.value = '';
      setInlineMessage(crewError, '');
      setInlineMessage(crewInfo, '');
      renderCrewSelected();
    }
  });

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
      window.location.href = `/voyage-details.html?voyageId=${payload.voyageId}`;
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to start voyage.', 'error');
    }
  });

  try {
    renderVoyageSkeleton(ongoingRoot, 3);
    renderVoyageSkeleton(archivedRoot, 3);
    await refreshBoard();
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
