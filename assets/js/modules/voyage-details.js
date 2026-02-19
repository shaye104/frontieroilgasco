import { createVoyageLog, endVoyage, getVoyage, updateVoyageLog, updateVoyageManifest } from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const output = String(value ?? '').trim();
  return output || 'N/A';
}

function money(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? num.toLocaleString(undefined, { style: 'currency', currency: 'USD' }) : '$0.00';
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
  const metaRoot = document.querySelector(config.metaSelector);
  const manifestBody = document.querySelector(config.manifestBodySelector);
  const buyTotalText = document.querySelector(config.buyTotalSelector);
  const saveManifestBtn = document.querySelector(config.saveManifestButtonSelector);
  const endVoyageBtn = document.querySelector(config.endButtonSelector);
  const addLogForm = document.querySelector(config.addLogFormSelector);
  const logList = document.querySelector(config.logListSelector);
  const endForm = document.querySelector(config.endFormSelector);
  const cargoLostEditor = document.querySelector(config.cargoLostEditorSelector);

  if (!feedback || !heading || !metaRoot || !manifestBody || !buyTotalText || !saveManifestBtn || !endVoyageBtn || !addLogForm || !logList || !endForm || !cargoLostEditor) return;

  const voyageId = parseVoyageId();
  if (!voyageId) {
    showMessage(feedback, 'Invalid voyage route.', 'error');
    return;
  }

  let detail = null;

  function manifestPayloadFromTable() {
    return [...manifestBody.querySelectorAll('tr[data-cargo-id]')].map((row) => ({
      cargoTypeId: Number(row.getAttribute('data-cargo-id')),
      quantity: Number(row.querySelector('input[data-field="quantity"]')?.value || 0),
      buyPrice: Number(row.querySelector('input[data-field="buyPrice"]')?.value || 0)
    }));
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
  }

  function renderManifest() {
    const canEdit = Boolean(detail.permissions?.canEdit);
    manifestBody.innerHTML = (detail.manifest || [])
      .map((line) => {
        return `
          <tr data-cargo-id="${line.cargo_type_id}">
            <td>${text(line.cargo_name)}</td>
            <td><input data-field="quantity" type="number" min="0" step="1" value="${Number(line.quantity || 0)}" ${
              canEdit ? '' : 'disabled'
            } /></td>
            <td><input data-field="buyPrice" type="number" min="0" step="0.01" value="${Number(line.buy_price || 0)}" ${
              canEdit ? '' : 'disabled'
            } /></td>
            <td>${money(line.line_total)}</td>
          </tr>
        `;
      })
      .join('');

    buyTotalText.textContent = money(detail.buyTotal);
    if (canEdit) saveManifestBtn.classList.remove('hidden');
    else saveManifestBtn.classList.add('hidden');

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

  function renderEndSection() {
    const canEdit = Boolean(detail.permissions?.canEdit);
    if (canEdit) addLogForm.classList.remove('hidden');
    else addLogForm.classList.add('hidden');

    if (detail.voyage.status === 'ENDED') {
      const cargoLost = Array.isArray(detail.cargoLost) ? detail.cargoLost : [];
      const lossLines = cargoLost.length
        ? cargoLost.map((item) => `<li>${text(item.cargoName)} | Lost ${item.lostQuantity} of ${item.manifestQuantity}</li>`).join('')
        : '<li>No cargo loss recorded.</li>';

      metaRoot.insertAdjacentHTML(
        'beforeend',
        `<hr />
         <p><strong>Buy Total:</strong> ${money(detail.voyage.buy_total)}</p>
         <p><strong>Effective Sell:</strong> ${money(detail.voyage.effective_sell)}</p>
         <p><strong>Profit:</strong> ${money(detail.voyage.profit)}</p>
         <p><strong>Company Share (10%):</strong> ${money(detail.voyage.company_share)}</p>
         <p><strong>Cargo Lost Summary:</strong></p>
         <ul>${lossLines}</ul>`
      );
    }
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
    renderEndSection();
    renderCargoLostEditor();
  }

  saveManifestBtn.addEventListener('click', async () => {
    try {
      await updateVoyageManifest(voyageId, manifestPayloadFromTable());
      await refresh();
      showMessage(feedback, 'Manifest saved.', 'success');
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to save manifest.', 'error');
    }
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
