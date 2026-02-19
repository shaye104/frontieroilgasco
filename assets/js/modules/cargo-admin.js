import {
  createCargoType,
  createVoyageConfigValue,
  deleteCargoType,
  deleteVoyageConfigValue,
  listCargoTypesAdmin,
  listVoyageConfigAdmin,
  updateCargoType,
  updateVoyageConfigValue
} from './admin-api.js';
import { hasPermission } from './intranet-page-guard.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  return String(value ?? '').trim();
}

function openModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function closeModal(id) {
  const modal = document.getElementById(id);
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

function renderConfigList(target, type, items, feedback, refresh) {
  if (!target) return;
  if (!items.length) {
    target.innerHTML = '<li class="role-item"><span class="role-id">No entries configured.</span></li>';
    return;
  }

  target.innerHTML = items
    .map(
      (item) => `<li class="role-item">
        <span class="role-id">${text(item.value)}</span>
        <span class="modal-actions">
          <button class="btn btn-secondary" type="button" data-edit-config="${type}:${item.id}">Edit</button>
          <button class="btn btn-danger" type="button" data-delete-config="${type}:${item.id}">Delete</button>
        </span>
      </li>`
    )
    .join('');

  target.querySelectorAll('[data-edit-config]').forEach((button) => {
    button.addEventListener('click', async () => {
      const [entryType, idValue] = String(button.getAttribute('data-edit-config') || '').split(':');
      const id = Number(idValue);
      const existing = items.find((row) => Number(row.id) === id);
      const next = window.prompt('Update value', existing?.value || '');
      if (!next || !next.trim()) return;
      try {
        await updateVoyageConfigValue(entryType, id, next.trim());
        await refresh();
        showMessage(feedback, 'Config updated.', 'success');
      } catch (error) {
        showMessage(feedback, error.message || 'Unable to update config.', 'error');
      }
    });
  });

  target.querySelectorAll('[data-delete-config]').forEach((button) => {
    button.addEventListener('click', async () => {
      const [entryType, idValue] = String(button.getAttribute('data-delete-config') || '').split(':');
      const id = Number(idValue);
      if (!window.confirm('Delete this config item?')) return;
      try {
        await deleteVoyageConfigValue(entryType, id);
        await refresh();
        showMessage(feedback, 'Config deleted.', 'success');
      } catch (error) {
        showMessage(feedback, error.message || 'Unable to delete config.', 'error');
      }
    });
  });
}

export async function initCargoAdmin(config, session) {
  const feedback = document.querySelector(config.feedbackSelector);
  const tableBody = document.querySelector(config.tableBodySelector);
  const openModalBtn = document.querySelector(config.openModalButtonSelector);
  const form = document.querySelector(config.formSelector);
  const modalTitle = document.querySelector(config.modalTitleSelector);
  const configListsRoot = document.querySelector(config.voyageConfigSectionSelector);
  const cargoSection = document.querySelector(config.cargoSectionSelector);
  const listPorts = document.querySelector(config.listPortsSelector);
  const listNames = document.querySelector(config.listVesselNamesSelector);
  const listClasses = document.querySelector(config.listVesselClassesSelector);
  const listCallsigns = document.querySelector(config.listVesselCallsignsSelector);

  if (
    !feedback ||
    !tableBody ||
    !openModalBtn ||
    !form ||
    !modalTitle ||
    !configListsRoot ||
    !cargoSection ||
    !listPorts ||
    !listNames ||
    !listClasses ||
    !listCallsigns
  ) {
    return;
  }

  const canManageVoyageConfig = hasPermission(session, 'voyages.config.manage') || hasPermission(session, 'config.manage');
  const canManageCargo = hasPermission(session, 'cargo.manage');

  if (!canManageVoyageConfig && !canManageCargo) {
    showMessage(feedback, 'Missing permission to manage voyage configuration.', 'error');
    return;
  }

  if (canManageVoyageConfig) configListsRoot.classList.remove('hidden');
  if (canManageCargo) cargoSection.classList.remove('hidden');

  let cargoTypes = [];
  let listData = { ports: [], vessel_names: [], vessel_classes: [], vessel_callsigns: [] };

  function renderCargoTable() {
    if (!canManageCargo) {
      tableBody.innerHTML = '<tr><td colspan="4">No cargo permission.</td></tr>';
      return;
    }
    if (!cargoTypes.length) {
      tableBody.innerHTML = '<tr><td colspan="4">No cargo types configured.</td></tr>';
      return;
    }
    tableBody.innerHTML = cargoTypes
      .map(
        (cargo) => `<tr>
          <td>${text(cargo.name)}</td>
          <td>${Number(cargo.active) === 1 ? 'Yes' : 'No'}</td>
          <td>${cargo.default_price === null || cargo.default_price === undefined ? 'N/A' : `ƒ ${Number(cargo.default_price).toLocaleString(undefined, { maximumFractionDigits: 2 })}`}</td>
          <td>
            <button class="btn btn-secondary" type="button" data-edit-cargo="${cargo.id}">Edit</button>
            <button class="btn btn-danger" type="button" data-delete-cargo="${cargo.id}">Delete</button>
          </td>
        </tr>`
      )
      .join('');

    tableBody.querySelectorAll('[data-edit-cargo]').forEach((button) => {
      button.addEventListener('click', () => {
        const id = Number(button.getAttribute('data-edit-cargo'));
        const cargo = cargoTypes.find((item) => Number(item.id) === id);
        if (!cargo) return;
        modalTitle.textContent = 'Edit Cargo Type';
        form.querySelector('[name="id"]').value = String(cargo.id);
        form.querySelector('[name="name"]').value = cargo.name || '';
        form.querySelector('[name="defaultPrice"]').value =
          cargo.default_price === null || cargo.default_price === undefined ? '' : String(cargo.default_price);
        form.querySelector('[name="active"]').checked = Number(cargo.active) === 1;
        openModal('cargoModal');
      });
    });

    tableBody.querySelectorAll('[data-delete-cargo]').forEach((button) => {
      button.addEventListener('click', async () => {
        const id = Number(button.getAttribute('data-delete-cargo'));
        if (!window.confirm('Delete this cargo type?')) return;
        try {
          await deleteCargoType(id);
          await refresh();
          showMessage(feedback, 'Cargo type deleted.', 'success');
        } catch (error) {
          showMessage(feedback, error.message || 'Unable to delete cargo type.', 'error');
        }
      });
    });
  }

  function renderConfigLists() {
    renderConfigList(listPorts, 'ports', listData.ports, feedback, refresh);
    renderConfigList(listNames, 'vessel_names', listData.vessel_names, feedback, refresh);
    renderConfigList(listClasses, 'vessel_classes', listData.vessel_classes, feedback, refresh);
    renderConfigList(listCallsigns, 'vessel_callsigns', listData.vessel_callsigns, feedback, refresh);
  }

  async function refresh() {
    const tasks = [];
    if (canManageCargo) tasks.push(listCargoTypesAdmin());
    else tasks.push(Promise.resolve({ cargoTypes: [] }));
    if (canManageVoyageConfig) {
      tasks.push(
        Promise.all([
          listVoyageConfigAdmin('ports'),
          listVoyageConfigAdmin('vessel_names'),
          listVoyageConfigAdmin('vessel_classes'),
          listVoyageConfigAdmin('vessel_callsigns')
        ])
      );
    } else {
      tasks.push(Promise.resolve([{ items: [] }, { items: [] }, { items: [] }, { items: [] }]));
    }

    const [cargoPayload, configPayloads] = await Promise.all(tasks);
    cargoTypes = cargoPayload.cargoTypes || [];
    const [ports, names, classes, callsigns] = configPayloads;
    listData = {
      ports: ports.items || [],
      vessel_names: names.items || [],
      vessel_classes: classes.items || [],
      vessel_callsigns: callsigns.items || []
    };

    renderCargoTable();
    renderConfigLists();
  }

  openModalBtn.addEventListener('click', () => {
    modalTitle.textContent = 'Create Cargo Type';
    form.reset();
    form.querySelector('[name="id"]').value = '';
    form.querySelector('[name="active"]').checked = true;
    openModal('cargoModal');
  });

  document.querySelectorAll('[data-close-modal]').forEach((button) => {
    button.addEventListener('click', () => {
      const modalId = button.getAttribute('data-close-modal');
      if (modalId) closeModal(modalId);
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const id = Number(data.get('id'));
    const payload = {
      name: text(data.get('name')),
      defaultPrice: text(data.get('defaultPrice')),
      active: data.get('active') === 'on'
    };

    try {
      if (Number.isInteger(id) && id > 0) await updateCargoType({ id, ...payload });
      else await createCargoType(payload);
      closeModal('cargoModal');
      await refresh();
      showMessage(feedback, 'Cargo type saved.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to save cargo type.', 'error');
    }
  });

  if (canManageVoyageConfig) {
    document.querySelectorAll('[data-config-create]').forEach((formNode) => {
      formNode.addEventListener('submit', async (event) => {
        event.preventDefault();
        const type = formNode.getAttribute('data-config-create');
        const data = new FormData(formNode);
        const value = text(data.get('value'));
        if (!type || !value) return;
        try {
          await createVoyageConfigValue(type, value);
          formNode.reset();
          await refresh();
          showMessage(feedback, 'Config item added.', 'success');
        } catch (error) {
          showMessage(feedback, error.message || 'Unable to add config item.', 'error');
        }
      });
    });
  }

  try {
    await refresh();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to initialize voyage config.', 'error');
  }
}
