import { createCargoType, deleteCargoType, listCargoTypesAdmin, updateCargoType } from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const output = String(value ?? '').trim();
  return output || '';
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

export async function initCargoAdmin(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const tableBody = document.querySelector(config.tableBodySelector);
  const openModalBtn = document.querySelector(config.openModalButtonSelector);
  const form = document.querySelector(config.formSelector);
  const modalTitle = document.querySelector(config.modalTitleSelector);
  if (!feedback || !tableBody || !openModalBtn || !form || !modalTitle) return;

  let cargoTypes = [];

  function renderTable() {
    if (!cargoTypes.length) {
      tableBody.innerHTML = '<tr><td colspan="4">No cargo types configured.</td></tr>';
      return;
    }
    tableBody.innerHTML = cargoTypes
      .map(
        (cargo) => `<tr>
          <td>${text(cargo.name)}</td>
          <td>${Number(cargo.active) === 1 ? 'Yes' : 'No'}</td>
          <td>${cargo.default_price === null || cargo.default_price === undefined ? 'N/A' : Number(cargo.default_price).toFixed(2)}</td>
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

  async function refresh() {
    const payload = await listCargoTypesAdmin();
    cargoTypes = payload.cargoTypes || [];
    renderTable();
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

  try {
    await refresh();
    clearMessage(feedback);
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to initialize cargo management.', 'error');
  }
}
