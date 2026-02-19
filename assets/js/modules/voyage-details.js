import {
  createVoyageLog,
  endVoyage,
  getVoyage,
  updateVoyageDetails,
  updateVoyageLog,
  updateVoyageManifest
} from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const output = String(value ?? '').trim();
  return output || 'N/A';
}

function normalize(value) {
  return String(value || '').trim().toLowerCase();
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

function fillSelect(select, items, placeholder) {
  if (!select) return;
  const current = select.value;
  select.innerHTML = [`<option value="">${placeholder}</option>`, ...items.map((item) => `<option value="${item.value}">${item.value}</option>`)]
    .join('');
  if (current) select.value = current;
}

function employeeSearchMatches(employee, query) {
  if (!query) return true;
  return normalize(employee.serial_number).includes(query);
}

export async function initVoyageDetails(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const heading = document.querySelector(config.headingSelector);
  const metaRoot = document.querySelector(config.metaSelector);
  const manifestBody = document.querySelector(config.manifestBodySelector);
  const buyTotalText = document.querySelector(config.buyTotalSelector);
  const saveManifestBtn = document.querySelector(config.saveManifestButtonSelector);
  const endVoyageBtn = document.querySelector(config.endButtonSelector);
  const addLogForm = document.querySelector(config.addLogFormSelector);
  const logList = document.querySelector(config.logListSelector);
  const endForm = document.querySelector(config.endFormSelector);
  const cargoLostEditor = document.querySelector(config.cargoLostEditorSelector);
  const detailsForm = document.querySelector(config.detailsFormSelector);
  const addCargoBtn = document.querySelector(config.addCargoButtonSelector);
  const addCargoForm = document.querySelector(config.addCargoFormSelector);
  const addCargoTypeSelect = document.querySelector(config.addCargoTypeSelector);

  const editDeparture = document.querySelector(config.editDepartureSelector);
  const editDestination = document.querySelector(config.editDestinationSelector);
  const editVesselName = document.querySelector(config.editVesselNameSelector);
  const editVesselClass = document.querySelector(config.editVesselClassSelector);
  const editVesselCallsign = document.querySelector(config.editVesselCallsignSelector);
  const editOowSearch = document.querySelector(config.editOowSearchSelector);
  const editOowResults = document.querySelector(config.editOowResultsSelector);
  const editOowHidden = document.querySelector(config.editOowHiddenSelector);
  const editOowSelected = document.querySelector(config.editOowSelectedSelector);
  const editCrewSearch = document.querySelector(config.editCrewSearchSelector);
  const editCrewResults = document.querySelector(config.editCrewResultsSelector);
  const editCrewSelected = document.querySelector(config.editCrewSelectedSelector);

  if (
    !feedback ||
    !heading ||
    !metaRoot ||
    !manifestBody ||
    !buyTotalText ||
    !saveManifestBtn ||
    !endVoyageBtn ||
    !addLogForm ||
    !logList ||
    !endForm ||
    !cargoLostEditor ||
    !detailsForm ||
    !addCargoBtn ||
    !addCargoForm ||
    !addCargoTypeSelect ||
    !editDeparture ||
    !editDestination ||
    !editVesselName ||
    !editVesselClass ||
    !editVesselCallsign ||
    !editOowSearch ||
    !editOowResults ||
    !editOowHidden ||
    !editOowSelected ||
    !editCrewSearch ||
    !editCrewResults ||
    !editCrewSelected
  ) {
    return;
  }

  const voyageId = parseVoyageId();
  if (!voyageId) {
    showMessage(feedback, 'Invalid voyage route.', 'error');
    return;
  }

  let detail = null;
  let selectedCrewIds = new Set();

  function currentManifestLines() {
    return [...manifestBody.querySelectorAll('tr[data-cargo-id]')].map((row) => {
      const qtyInput = row.querySelector('input[data-field="quantity"]');
      const buyInput = row.querySelector('input[data-field="buyPrice"]');
      return {
        cargoTypeId: Number(row.getAttribute('data-cargo-id')),
        quantity: Number(qtyInput?.value || 0),
        buyPrice: Number(buyInput?.value || 0)
      };
    });
  }

  function renderMeta() {
    const voyage = detail.voyage;
    const crewNames = (detail.crew || []).map((member) => text(member.roblox_username)).join(', ') || 'N/A';
    metaRoot.innerHTML = `
      <p><strong>Status:</strong> ${text(voyage.status)}</p>
      <p><strong>Route:</strong> ${text(voyage.departure_port)} -> ${text(voyage.destination_port)}</p>
      <p><strong>Vessel:</strong> ${text(voyage.vessel_name)} | ${text(voyage.vessel_class)} | ${text(voyage.vessel_callsign)}</p>
      <p><strong>Officer of the Watch:</strong> ${text(voyage.officer_name)}</p>
      <p><strong>Crew:</strong> ${crewNames}</p>
      <p><strong>Started:</strong> ${formatWhen(voyage.started_at)}</p>
      ${voyage.status === 'ENDED' ? `<p><strong>Ended:</strong> ${formatWhen(voyage.ended_at)}</p>` : ''}
    `;

    if (voyage.status === 'ENDED') {
      const cargoLost = Array.isArray(detail.cargoLost) ? detail.cargoLost : [];
      const lossLines = cargoLost.length
        ? cargoLost.map((item) => `<li>${text(item.cargoName)} | Lost ${item.lostQuantity} of ${item.manifestQuantity}</li>`).join('')
        : '<li>No cargo loss recorded.</li>';
      metaRoot.insertAdjacentHTML(
        'beforeend',
        `<p><strong>Buy Total:</strong> ${formatGuilders(voyage.buy_total)}</p>
         <p><strong>Effective Sell:</strong> ${formatGuilders(voyage.effective_sell)}</p>
         <p><strong>Profit:</strong> ${formatGuilders(voyage.profit)}</p>
         <p><strong>Company Share (10%):</strong> ${formatGuilders(voyage.company_share)}</p>
         <p><strong>Cargo Lost Summary:</strong></p>
         <ul>${lossLines}</ul>`
      );
    }
  }

  function renderManifest() {
    const canEdit = Boolean(detail.permissions?.canEdit);
    manifestBody.innerHTML = (detail.manifest || [])
      .map(
        (line) => `<tr data-cargo-id="${line.cargo_type_id}">
          <td>${text(line.cargo_name)}</td>
          <td><input data-field="quantity" type="number" min="0" step="1" value="${Number(line.quantity || 0)}" ${
            canEdit ? '' : 'disabled'
          } /></td>
          <td><input data-field="buyPrice" type="number" min="0" step="0.01" value="${Number(line.buy_price || 0)}" ${
            canEdit ? '' : 'disabled'
          } /></td>
          <td>${formatGuilders(line.line_total)}</td>
          <td>${
            canEdit ? `<button class="btn btn-secondary" type="button" data-remove-line="${line.cargo_type_id}">Remove</button>` : '-'
          }</td>
        </tr>`
      )
      .join('');

    manifestBody.querySelectorAll('[data-remove-line]').forEach((button) => {
      button.addEventListener('click', () => {
        const cargoId = Number(button.getAttribute('data-remove-line'));
        detail.manifest = (detail.manifest || []).filter((line) => Number(line.cargo_type_id) !== cargoId);
        renderManifest();
        renderCargoLostEditor();
      });
    });

    buyTotalText.textContent = formatGuilders(detail.buyTotal);
    if (canEdit) {
      saveManifestBtn.classList.remove('hidden');
      addCargoBtn.classList.remove('hidden');
    } else {
      saveManifestBtn.classList.add('hidden');
      addCargoBtn.classList.add('hidden');
    }

    if (detail.permissions?.canEnd) endVoyageBtn.classList.remove('hidden');
    else endVoyageBtn.classList.add('hidden');
  }

  function renderLogs() {
    if (!detail.logs?.length) {
      logList.innerHTML = '<li class="role-item"><span class="role-id">No ship log entries yet.</span></li>';
      return;
    }

    const canEdit = Boolean(detail.permissions?.canEdit);
    logList.innerHTML = detail.logs
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
            await refresh();
          } catch (error) {
            showMessage(feedback, error.message || 'Unable to edit ship log entry.', 'error');
          }
        });
      });
    }
  }

  function renderCrewSelected() {
    if (!selectedCrewIds.size) {
      editCrewSelected.innerHTML = '<span class="muted">No crew selected.</span>';
      return;
    }

    editCrewSelected.innerHTML = [...selectedCrewIds]
      .map((employeeId) => {
        const employee = (detail.employees || []).find((item) => Number(item.id) === Number(employeeId));
        if (!employee) return '';
        return `<span class="pill">
            ${text(employee.roblox_username)}
            <button type="button" class="pill-close" data-remove-crew="${employee.id}" aria-label="Remove crew member">x</button>
            <input type="hidden" name="crewComplementIds" value="${employee.id}" />
          </span>`;
      })
      .join('');

    editCrewSelected.querySelectorAll('[data-remove-crew]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = Number(button.getAttribute('data-remove-crew'));
        selectedCrewIds.delete(id);
        renderCrewSelected();
      });
    });
  }

  function renderOowResults() {
    const query = normalize(editOowSearch.value);
    const matches = (detail.employees || []).filter((employee) => employeeSearchMatches(employee, query)).slice(0, 8);
    editOowResults.innerHTML = matches
      .map(
        (employee) => `<button class="autocomplete-item" type="button" data-oow-id="${employee.id}">
          <span>${text(employee.roblox_username)}</span>
          <small>Serial: ${text(employee.serial_number)}</small>
        </button>`
      )
      .join('');

    editOowResults.querySelectorAll('[data-oow-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const selectedId = Number(button.getAttribute('data-oow-id'));
        const selected = (detail.employees || []).find((employee) => Number(employee.id) === selectedId);
        if (!selected) return;
        editOowHidden.value = String(selected.id);
        editOowSelected.textContent = `Selected OOW: ${text(selected.roblox_username)}`;
        editOowResults.innerHTML = '';
        editOowSearch.value = '';
      });
    });
  }

  function renderCrewResults() {
    const query = normalize(editCrewSearch.value);
    const matches = (detail.employees || [])
      .filter((employee) => !selectedCrewIds.has(Number(employee.id)))
      .filter((employee) => employeeSearchMatches(employee, query))
      .slice(0, 10);
    editCrewResults.innerHTML = matches
      .map(
        (employee) => `<button class="autocomplete-item" type="button" data-crew-id="${employee.id}">
          <span>${text(employee.roblox_username)}</span>
          <small>Serial: ${text(employee.serial_number)}</small>
        </button>`
      )
      .join('');

    editCrewResults.querySelectorAll('[data-crew-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const selectedId = Number(button.getAttribute('data-crew-id'));
        selectedCrewIds.add(selectedId);
        editCrewSearch.value = '';
        renderCrewResults();
        renderCrewSelected();
      });
    });
  }

  function renderDetailsEditor() {
    const canEdit = Boolean(detail.permissions?.canEdit);
    if (!canEdit) {
      detailsForm.classList.add('hidden');
      return;
    }
    detailsForm.classList.remove('hidden');

    fillSelect(editDeparture, detail.voyageConfig?.ports || [], 'Select departure port');
    fillSelect(editDestination, detail.voyageConfig?.ports || [], 'Select destination port');
    fillSelect(editVesselName, detail.voyageConfig?.vesselNames || [], 'Select vessel name');
    fillSelect(editVesselClass, detail.voyageConfig?.vesselClasses || [], 'Select vessel class');
    fillSelect(editVesselCallsign, detail.voyageConfig?.vesselCallsigns || [], 'Select vessel callsign');

    editDeparture.value = detail.voyage.departure_port || '';
    editDestination.value = detail.voyage.destination_port || '';
    editVesselName.value = detail.voyage.vessel_name || '';
    editVesselClass.value = detail.voyage.vessel_class || '';
    editVesselCallsign.value = detail.voyage.vessel_callsign || '';
    editOowHidden.value = String(detail.voyage.officer_of_watch_employee_id || '');
    editOowSelected.textContent = `Selected OOW: ${text(detail.voyage.officer_name)}`;
    selectedCrewIds = new Set((detail.crew || []).map((member) => Number(member.id)));
    renderCrewSelected();

    const availableCargo = detail.voyageConfig?.cargoTypes || [];
    addCargoTypeSelect.innerHTML = ['<option value="">Select cargo type</option>', ...availableCargo.map((cargo) => `<option value="${cargo.id}">${cargo.name}</option>`)].join('');
  }

  function renderEndSection() {
    const canEdit = Boolean(detail.permissions?.canEdit);
    if (canEdit) addLogForm.classList.remove('hidden');
    else addLogForm.classList.add('hidden');
  }

  function renderCargoLostEditor() {
    cargoLostEditor.innerHTML = (detail.manifest || [])
      .map(
        (line) => `<div>
          <label>${text(line.cargo_name)} (max ${Number(line.quantity || 0)})</label>
          <input type="number" min="0" max="${Number(line.quantity || 0)}" step="1" data-loss-cargo-id="${line.cargo_type_id}" value="0" />
        </div>`
      )
      .join('');
  }

  async function refresh() {
    detail = await getVoyage(voyageId);
    heading.textContent = `${text(detail.voyage.vessel_name)} | ${text(detail.voyage.vessel_callsign)} | ${text(detail.voyage.status)}`;
    renderMeta();
    renderManifest();
    renderLogs();
    renderDetailsEditor();
    renderEndSection();
    renderCargoLostEditor();
  }

  detailsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(detailsForm);
    const crewIds = data
      .getAll('crewComplementIds')
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0);

    try {
      await updateVoyageDetails(voyageId, {
        departurePort: text(data.get('departurePort')),
        destinationPort: text(data.get('destinationPort')),
        vesselName: text(data.get('vesselName')),
        vesselClass: text(data.get('vesselClass')),
        vesselCallsign: text(data.get('vesselCallsign')),
        officerOfWatchEmployeeId: Number(data.get('officerOfWatchEmployeeId')),
        crewComplementIds: crewIds
      });
      await refresh();
      showMessage(feedback, 'Voyage details saved and logged.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to save voyage details.', 'error');
    }
  });

  saveManifestBtn.addEventListener('click', async () => {
    try {
      await updateVoyageManifest(voyageId, currentManifestLines());
      await refresh();
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
    const cargoType = (detail.voyageConfig?.cargoTypes || []).find((cargo) => Number(cargo.id) === cargoTypeId);
    if (!cargoType || !Number.isInteger(cargoTypeId) || cargoTypeId <= 0) {
      showMessage(feedback, 'Select a valid cargo type.', 'error');
      return;
    }
    if (!Number.isInteger(quantity) || quantity < 0) {
      showMessage(feedback, 'Quantity must be an integer >= 0.', 'error');
      return;
    }
    if (!Number.isFinite(buyPrice) || buyPrice < 0) {
      showMessage(feedback, 'Buy price must be >= 0.', 'error');
      return;
    }

    const existing = (detail.manifest || []).find((line) => Number(line.cargo_type_id) === cargoTypeId);
    if (existing) {
      existing.quantity = quantity;
      existing.buy_price = buyPrice;
      existing.line_total = quantity * buyPrice;
    } else {
      detail.manifest = [
        ...(detail.manifest || []),
        {
          cargo_type_id: cargoTypeId,
          cargo_name: cargoType.name,
          quantity,
          buy_price: buyPrice,
          line_total: quantity * buyPrice
        }
      ];
    }

    renderManifest();
    renderCargoLostEditor();
    closeModal('addCargoModal');
    addCargoForm.reset();
  });

  addLogForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(addLogForm);
    try {
      await createVoyageLog(voyageId, text(data.get('message')));
      addLogForm.reset();
      await refresh();
      showMessage(feedback, 'Ship log entry added.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to add ship log entry.', 'error');
    }
  });

  endVoyageBtn.addEventListener('click', () => openModal('endVoyageModal'));
  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modalId = button.getAttribute('data-close-modal');
      if (modalId) closeModal(modalId);
    });
  });

  editOowSearch.addEventListener('input', renderOowResults);
  editOowSearch.addEventListener('focus', renderOowResults);
  editCrewSearch.addEventListener('input', renderCrewResults);
  editCrewSearch.addEventListener('focus', renderCrewResults);

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
      await refresh();
      showMessage(feedback, 'Voyage ended and archived.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to end voyage.', 'error');
    }
  });

  try {
    await refresh();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load voyage details.', 'error');
  }
}
