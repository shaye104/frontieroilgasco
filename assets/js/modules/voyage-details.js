import {
  createVoyageLog,
  endVoyage,
  getVoyage,
  getVoyageManifest,
  listVoyageLogs,
  searchEmployees,
  updateVoyageDetails,
  updateVoyageLog,
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

function formatGuilders(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 'ƒ 0';
  return `ƒ ${num.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function formatWhen(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text(value) : date.toLocaleString();
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
  const manifestBody = document.querySelector(config.manifestBodySelector);
  const buyTotalText = document.querySelector(config.buyTotalSelector);
  const saveManifestBtn = document.querySelector(config.saveManifestButtonSelector);
  const endVoyageBtn = document.querySelector(config.endButtonSelector);
  const addLogForm = document.querySelector(config.addLogFormSelector);
  const logList = document.querySelector(config.logListSelector);
  const endForm = document.querySelector(config.endFormSelector);
  const cargoLostEditor = document.querySelector(config.cargoLostEditorSelector);
  const addCargoBtn = document.querySelector(config.addCargoButtonSelector);
  const addCargoForm = document.querySelector(config.addCargoFormSelector);
  const addCargoTypeSelect = document.querySelector(config.addCargoTypeSelector);
  const shipStatusControls = document.querySelector(config.shipStatusControlsSelector);
  const shipInPortBtn = document.querySelector(config.shipInPortSelector);
  const shipUnderwayBtn = document.querySelector(config.shipUnderwaySelector);
  const updateFieldForm = document.querySelector(config.updateFieldFormSelector);
  const updateFieldTitle = document.querySelector(config.updateFieldTitleSelector);
  const updateFieldKey = document.querySelector(config.updateFieldKeySelector);
  const updateFieldControls = document.querySelector(config.updateFieldControlsSelector);

  if (
    !feedback ||
    !heading ||
    !fieldList ||
    !manifestBody ||
    !buyTotalText ||
    !saveManifestBtn ||
    !endVoyageBtn ||
    !addLogForm ||
    !logList ||
    !endForm ||
    !cargoLostEditor ||
    !addCargoBtn ||
    !addCargoForm ||
    !addCargoTypeSelect ||
    !shipStatusControls ||
    !shipInPortBtn ||
    !shipUnderwayBtn ||
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

  async function lookupEmployees(queryKind, query) {
    const clean = normalize(query);
    if (!clean) return [];
    const key = `${queryKind}:${clean}`;
    if (searchCache.has(key)) return searchCache.get(key);
    const payload = await searchEmployees(queryKind === 'serial' ? { serial: clean, limit: 12 } : { username: clean, limit: 12 });
    const results = payload.employees || [];
    searchCache.set(key, results);
    return results;
  }

  function getCurrentCrewIds() {
    return (detail?.crew || []).map((member) => Number(member.id)).filter((id) => Number.isInteger(id));
  }

  function renderStatusControls() {
    const canEdit = Boolean(detail.permissions?.canEdit);
    if (!canEdit) {
      shipStatusControls.classList.add('hidden');
      return;
    }
    shipStatusControls.classList.remove('hidden');
    const status = String(detail.voyage.ship_status || 'IN_PORT');
    shipInPortBtn.disabled = status === 'IN_PORT';
    shipUnderwayBtn.disabled = status === 'UNDERWAY';
  }

  function renderFieldList() {
    const voyage = detail.voyage;
    const crewNames = (detail.crew || []).map((entry) => text(entry.roblox_username)).join(', ') || 'N/A';
    const canEdit = Boolean(detail.permissions?.canEdit);
    const rows = [
      { key: 'departurePort', label: 'Port of Departure', value: text(voyage.departure_port) },
      { key: 'destinationPort', label: 'Port of Destination', value: text(voyage.destination_port) },
      { key: 'vesselName', label: 'Vessel Name', value: text(voyage.vessel_name) },
      { key: 'vesselClass', label: 'Vessel Class', value: text(voyage.vessel_class) },
      { key: 'vesselCallsign', label: 'Vessel Callsign', value: text(voyage.vessel_callsign) },
      { key: 'officerOfWatchEmployeeId', label: 'Officer of the Watch', value: text(voyage.officer_name) },
      { key: 'crewComplementIds', label: 'Crew Complement', value: crewNames },
      { key: 'shipStatus', label: 'Ship Status', value: voyage.ship_status === 'UNDERWAY' ? 'Ship Underway' : 'Ship In Port' },
      { key: 'status', label: 'Voyage State', value: text(voyage.status) },
      { key: 'startedAt', label: 'Started', value: formatWhen(voyage.started_at) },
      { key: 'endedAt', label: 'Ended', value: voyage.status === 'ENDED' ? formatWhen(voyage.ended_at) : 'N/A' }
    ];

    fieldList.innerHTML = rows
      .map(
        (row) => `<div class="voyage-field-row">
          <div>
            <p class="voyage-field-label">${row.label}</p>
            <p class="voyage-field-value">${row.value}</p>
          </div>
          ${
            canEdit &&
            ['departurePort', 'destinationPort', 'vesselName', 'vesselClass', 'vesselCallsign', 'officerOfWatchEmployeeId', 'crewComplementIds'].includes(
              row.key
            )
              ? `<button class="btn btn-secondary btn-pencil" type="button" data-edit-field="${row.key}" aria-label="Edit ${row.label}">✏</button>`
              : ''
          }
        </div>`
      )
      .join('');

    fieldList.querySelectorAll('[data-edit-field]').forEach((button) => {
      button.addEventListener('click', () => {
        const fieldKey = button.getAttribute('data-edit-field');
        if (fieldKey) openFieldModal(fieldKey);
      });
    });
  }

  function renderManifest() {
    const canEdit = Boolean(detail.permissions?.canEdit);
    manifestBody.innerHTML = manifest
      .map(
        (line) => `<tr data-cargo-id="${line.cargo_type_id}">
          <td>${text(line.cargo_name)}</td>
          <td><input data-field="quantity" type="number" min="0" step="1" value="${Number(line.quantity || 0)}" ${canEdit ? '' : 'disabled'} /></td>
          <td><input data-field="buyPrice" type="number" min="0" step="0.01" value="${Number(line.buy_price || 0)}" ${canEdit ? '' : 'disabled'} /></td>
          <td>${formatGuilders(line.line_total)}</td>
          <td>${canEdit ? `<button class="btn btn-secondary" type="button" data-remove-line="${line.cargo_type_id}">Remove</button>` : '-'}</td>
        </tr>`
      )
      .join('');

    manifestBody.querySelectorAll('[data-remove-line]').forEach((button) => {
      button.addEventListener('click', () => {
        const cargoId = Number(button.getAttribute('data-remove-line'));
        manifest = manifest.filter((line) => Number(line.cargo_type_id) !== cargoId);
        renderManifest();
        renderCargoLostEditor();
      });
    });

    const buyTotal = manifest.reduce((acc, line) => acc + Number(line.line_total || Number(line.quantity || 0) * Number(line.buy_price || 0)), 0);
    buyTotalText.textContent = formatGuilders(buyTotal);
    if (canEdit) {
      saveManifestBtn.classList.remove('hidden');
      addCargoBtn.classList.remove('hidden');
    } else {
      saveManifestBtn.classList.add('hidden');
      addCargoBtn.classList.add('hidden');
    }
  }

  function renderLogs() {
    if (!logs.length) {
      logList.innerHTML = '<li class="role-item"><span class="role-id">No ship log entries yet.</span></li>';
      return;
    }

    const canEdit = Boolean(detail.permissions?.canEdit);
    logList.innerHTML = logs
      .map(
        (entry) => `<li class="role-item">
          <span class="role-id">${formatWhen(entry.created_at)} | ${text(entry.author_name)} | ${text(entry.message)}</span>
          ${
            canEdit
              ? `<button class="btn btn-secondary" type="button" data-edit-log="${entry.id}" data-current-message="${encodeURIComponent(
                  entry.message || ''
                )}">Edit</button>`
              : ''
          }
        </li>`
      )
      .join('');

    if (canEdit) {
      logList.querySelectorAll('[data-edit-log]').forEach((button) => {
        button.addEventListener('click', async () => {
          const logId = Number(button.getAttribute('data-edit-log'));
          const current = decodeURIComponent(button.getAttribute('data-current-message') || '');
          const next = window.prompt('Edit ship log entry', current);
          if (!next || !next.trim()) return;
          try {
            await updateVoyageLog(voyageId, logId, next.trim());
            await loadLogs();
          } catch (error) {
            showMessage(feedback, error.message || 'Unable to edit ship log entry.', 'error');
          }
        });
      });
    }
  }

  function renderCargoLostEditor() {
    cargoLostEditor.innerHTML = manifest
      .map(
        (line) => `<div>
          <label>${text(line.cargo_name)} (max ${Number(line.quantity || 0)})</label>
          <input type="number" min="0" max="${Number(line.quantity || 0)}" step="1" data-loss-cargo-id="${line.cargo_type_id}" value="0" />
        </div>`
      )
      .join('');
  }

  async function loadManifest() {
    const payload = await getVoyageManifest(voyageId);
    manifest = payload.manifest || [];
    renderManifest();
    renderCargoLostEditor();
  }

  async function loadLogs() {
    const payload = await listVoyageLogs(voyageId, { page: 1, pageSize: 80 });
    logs = payload.logs || [];
    renderLogs();
  }

  async function refreshSummary() {
    detail = await getVoyage(voyageId, { includeSetup: true, includeManifest: false, includeLogs: false });
    heading.textContent = `${text(detail.voyage.vessel_name)} | ${text(detail.voyage.vessel_callsign)} | ${text(detail.voyage.status)}`;
    renderStatusControls();
    renderFieldList();

    const availableCargo = detail.voyageConfig?.cargoTypes || [];
    addCargoTypeSelect.innerHTML = ['<option value="">Select cargo type</option>', ...availableCargo.map((cargo) => `<option value="${cargo.id}">${cargo.name}</option>`)].join('');

    if (detail.permissions?.canEnd) endVoyageBtn.classList.remove('hidden');
    else endVoyageBtn.classList.add('hidden');
    if (detail.permissions?.canEdit) addLogForm.classList.remove('hidden');
    else addLogForm.classList.add('hidden');
  }

  function openFieldModal(fieldKey) {
    updateFieldKey.value = fieldKey;
    const voyage = detail.voyage;
    const ports = detail.voyageConfig?.ports || [];
    const vesselNames = detail.voyageConfig?.vesselNames || [];
    const vesselClasses = detail.voyageConfig?.vesselClasses || [];
    const vesselCallsigns = detail.voyageConfig?.vesselCallsigns || [];

    if (fieldKey === 'departurePort' || fieldKey === 'destinationPort') {
      const current = fieldKey === 'departurePort' ? voyage.departure_port : voyage.destination_port;
      updateFieldTitle.textContent = `Update ${fieldKey === 'departurePort' ? 'Port of Departure' : 'Port of Destination'}`;
      updateFieldControls.innerHTML = `<label>Port</label><select name="value" required>${ports
        .map((item) => `<option value="${item.value}" ${item.value === current ? 'selected' : ''}>${item.value}</option>`)
        .join('')}</select>`;
    } else if (fieldKey === 'vesselName' || fieldKey === 'vesselClass' || fieldKey === 'vesselCallsign') {
      const map = {
        vesselName: { label: 'Vessel Name', items: vesselNames, current: voyage.vessel_name },
        vesselClass: { label: 'Vessel Class', items: vesselClasses, current: voyage.vessel_class },
        vesselCallsign: { label: 'Vessel Callsign', items: vesselCallsigns, current: voyage.vessel_callsign }
      };
      const info = map[fieldKey];
      updateFieldTitle.textContent = `Update ${info.label}`;
      updateFieldControls.innerHTML = `<label>${info.label}</label><select name="value" required>${info.items
        .map((item) => `<option value="${item.value}" ${item.value === info.current ? 'selected' : ''}>${item.value}</option>`)
        .join('')}</select>`;
    } else if (fieldKey === 'officerOfWatchEmployeeId') {
      updateFieldTitle.textContent = 'Update Officer of the Watch';
      updateFieldControls.innerHTML = `
        <label>Serial Number Search</label>
        <input name="search" id="fieldOowSearch" type="text" autocomplete="off" placeholder="Search by serial number" />
        <input name="selectedId" id="fieldOowSelectedId" type="hidden" value="${voyage.officer_of_watch_employee_id}" />
        <p id="fieldOowSelected" class="muted">Selected: ${text(voyage.officer_name)}</p>
        <div id="fieldOowResults" class="autocomplete-list"></div>`;
      const search = updateFieldControls.querySelector('#fieldOowSearch');
      const results = updateFieldControls.querySelector('#fieldOowResults');
      const selectedId = updateFieldControls.querySelector('#fieldOowSelectedId');
      const selectedText = updateFieldControls.querySelector('#fieldOowSelected');
      const runSearch = debounce(async () => {
        const items = await lookupEmployees('serial', search.value);
        results.innerHTML = items
          .map(
            (employee) => `<button class="autocomplete-item" type="button" data-pick-id="${employee.id}">
              <span>${text(employee.roblox_username)}</span>
              <small>Serial: ${text(employee.serial_number)}</small>
            </button>`
          )
          .join('');
        results.querySelectorAll('[data-pick-id]').forEach((button) => {
          button.addEventListener('click', () => {
            const id = Number(button.getAttribute('data-pick-id'));
            const employee = (detail.employees || []).find((entry) => Number(entry.id) === id);
            selectedId.value = String(id);
            selectedText.textContent = `Selected: ${text(employee?.roblox_username || `#${id}`)}`;
            search.value = '';
            results.innerHTML = '';
          });
        });
      }, 250);
      search.addEventListener('input', runSearch);
      search.addEventListener('focus', runSearch);
    } else if (fieldKey === 'crewComplementIds') {
      updateFieldTitle.textContent = 'Update Crew Complement';
      const currentCrewIds = getCurrentCrewIds();
      const currentCrewHtml = currentCrewIds
        .map((id) => {
          const employee = (detail.employees || []).find((entry) => Number(entry.id) === id);
          return `<span class="pill">${text(employee?.roblox_username || `#${id}`)} <button class="pill-close" type="button" data-remove-crew="${id}">x</button></span>`;
        })
        .join('');
      updateFieldControls.innerHTML = `
        <label>Username Search</label>
        <input id="fieldCrewSearch" type="text" autocomplete="off" placeholder="Search by Roblox username" />
        <div id="fieldCrewResults" class="autocomplete-list"></div>
        <div id="fieldCrewSelected" class="pill-list">${currentCrewHtml || '<span class="muted">No crew selected.</span>'}</div>`;
      const selectedCrew = new Set(currentCrewIds);
      const search = updateFieldControls.querySelector('#fieldCrewSearch');
      const results = updateFieldControls.querySelector('#fieldCrewResults');
      const selected = updateFieldControls.querySelector('#fieldCrewSelected');
      const oowId = Number(detail.voyage.officer_of_watch_employee_id || 0);

      const renderSelected = () => {
        updateFieldControls.setAttribute('data-crew-values', JSON.stringify([...selectedCrew]));
        if (!selectedCrew.size) {
          selected.innerHTML = '<span class="muted">No crew selected.</span>';
          return;
        }
        selected.innerHTML = [...selectedCrew]
          .map((id) => {
            const employee = (detail.employees || []).find((entry) => Number(entry.id) === id);
            return `<span class="pill">${text(employee?.roblox_username || `#${id}`)} <button class="pill-close" type="button" data-remove-crew="${id}">x</button></span>`;
          })
          .join('');
        selected.querySelectorAll('[data-remove-crew]').forEach((button) => {
          button.addEventListener('click', () => {
            const id = Number(button.getAttribute('data-remove-crew'));
            selectedCrew.delete(id);
            renderSelected();
          });
        });
      };
      const runSearch = debounce(async () => {
        const items = (await lookupEmployees('username', search.value))
          .filter((employee) => !selectedCrew.has(Number(employee.id)))
          .filter((employee) => Number(employee.id) !== oowId);
        results.innerHTML = items
          .map(
            (employee) => `<button class="autocomplete-item" type="button" data-pick-id="${employee.id}">
              <span>${text(employee.roblox_username)}</span>
              <small>Serial: ${text(employee.serial_number)}</small>
            </button>`
          )
          .join('');
        results.querySelectorAll('[data-pick-id]').forEach((button) => {
          button.addEventListener('click', () => {
            const id = Number(button.getAttribute('data-pick-id'));
            if (id === oowId) {
              showMessage(feedback, 'Officer of the Watch cannot be added to crew.', 'error');
              return;
            }
            selectedCrew.add(id);
            search.value = '';
            results.innerHTML = '';
            renderSelected();
          });
        });
      }, 250);
      search.addEventListener('input', runSearch);
      search.addEventListener('focus', runSearch);
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
    if (fieldKey === 'officerOfWatchEmployeeId') {
      payload.officerOfWatchEmployeeId = Number(updateFieldControls.querySelector('#fieldOowSelectedId')?.value || 0);
    }
    if (fieldKey === 'crewComplementIds') {
      const raw = String(updateFieldControls.getAttribute('data-crew-values') || '[]');
      payload.crewComplementIds = JSON.parse(raw);
    }

    await updateVoyageDetails(voyageId, payload);
    closeModal('updateFieldModal');
    await refreshSummary();
    showMessage(feedback, 'Voyage detail updated.', 'success');
  }

  updateFieldForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      await saveFieldModal();
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to update field.', 'error');
    }
  });

  saveManifestBtn.addEventListener('click', async () => {
    const lines = [...manifestBody.querySelectorAll('tr[data-cargo-id]')].map((row) => {
      const cargoTypeId = Number(row.getAttribute('data-cargo-id'));
      const quantity = Number(row.querySelector('input[data-field="quantity"]')?.value || 0);
      const buyPrice = Number(row.querySelector('input[data-field="buyPrice"]')?.value || 0);
      return { cargoTypeId, quantity, buyPrice };
    });
    try {
      await updateVoyageManifest(voyageId, lines);
      await loadManifest();
      showMessage(feedback, 'Manifest saved.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to save manifest.', 'error');
    }
  });

  addCargoBtn.addEventListener('click', () => openModal('addCargoModal'));
  addCargoForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const data = new FormData(addCargoForm);
    const cargoTypeId = Number(data.get('cargoTypeId'));
    const quantity = Number(data.get('quantity'));
    const buyPrice = Number(data.get('buyPrice'));
    if (!Number.isInteger(cargoTypeId) || cargoTypeId <= 0) return;
    const cargoType = (detail.voyageConfig?.cargoTypes || []).find((entry) => Number(entry.id) === cargoTypeId);
    const existing = manifest.find((line) => Number(line.cargo_type_id) === cargoTypeId);
    const next = {
      cargo_type_id: cargoTypeId,
      cargo_name: cargoType?.name || `Cargo #${cargoTypeId}`,
      quantity,
      buy_price: buyPrice,
      line_total: quantity * buyPrice
    };
    manifest = existing ? manifest.map((line) => (Number(line.cargo_type_id) === cargoTypeId ? next : line)) : [...manifest, next];
    renderManifest();
    renderCargoLostEditor();
    closeModal('addCargoModal');
    addCargoForm.reset();
  });

  addLogForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(addLogForm);
    try {
      await createVoyageLog(voyageId, String(data.get('message') || '').trim());
      addLogForm.reset();
      await loadLogs();
      showMessage(feedback, 'Ship log entry added.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to add ship log entry.', 'error');
    }
  });

  shipInPortBtn.addEventListener('click', async () => {
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
  shipUnderwayBtn.addEventListener('click', async () => {
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

  endVoyageBtn.addEventListener('click', () => openModal('endVoyageModal'));
  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modalId = button.getAttribute('data-close-modal');
      if (modalId) closeModal(modalId);
    });
  });

  endForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(endForm);
    const cargoLost = [...cargoLostEditor.querySelectorAll('[data-loss-cargo-id]')].map((input) => ({
      cargoTypeId: Number(input.getAttribute('data-loss-cargo-id')),
      lostQuantity: Number(input.value || 0)
    }));
    try {
      await endVoyage(voyageId, {
        sellMultiplier: Number(data.get('sellMultiplier')),
        baseSellPrice: Number(data.get('baseSellPrice')),
        cargoLost
      });
      closeModal('endVoyageModal');
      endForm.reset();
      await refreshSummary();
      await loadManifest();
      await loadLogs();
      showMessage(feedback, 'Voyage ended and archived.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to end voyage.', 'error');
    }
  });

  try {
    await refreshSummary();
    await Promise.all([loadManifest(), loadLogs()]);
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load voyage details.', 'error');
  }
}
