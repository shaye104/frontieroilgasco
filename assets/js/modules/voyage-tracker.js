import { listVoyages, startVoyage } from './admin-api.js';
import { hasPermission } from './intranet-page-guard.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const output = String(value ?? '').trim();
  return output || 'N/A';
}

function formatWhen(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text(value);
  return date.toLocaleString();
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

function fillEmployeeSelect(select, employees, multiple = false) {
  if (!select) return;
  const current = multiple ? new Set([...select.selectedOptions].map((option) => option.value)) : select.value;
  select.innerHTML = `${multiple ? '' : '<option value="">Select employee</option>'}${employees
    .map((employee) => `<option value="${employee.id}">${text(employee.roblox_username)} (#${employee.id})</option>`)
    .join('')}`;
  if (multiple) {
    [...select.options].forEach((option) => {
      if (current.has(option.value)) option.selected = true;
    });
  } else if (current) {
    select.value = current;
  }
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

export async function initVoyageTracker(config, session) {
  const feedback = document.querySelector(config.feedbackSelector);
  const ongoingRoot = document.querySelector(config.ongoingSelector);
  const archivedRoot = document.querySelector(config.archivedSelector);
  const startBtn = document.querySelector(config.startButtonSelector);
  const startForm = document.querySelector(config.startFormSelector);
  const oowSelect = document.querySelector(config.officerSelector);
  const crewSelect = document.querySelector(config.crewSelector);

  if (!feedback || !ongoingRoot || !archivedRoot || !startBtn || !startForm || !oowSelect || !crewSelect) return;

  let employees = [];

  async function refreshBoard() {
    const payload = await listVoyages();
    employees = payload.employees || [];

    if (hasPermission(session, 'voyages.create')) startBtn.classList.remove('hidden');
    else startBtn.classList.add('hidden');

    fillEmployeeSelect(oowSelect, employees, false);
    fillEmployeeSelect(crewSelect, employees, true);
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

  startForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessage(feedback);
    const data = new FormData(startForm);

    try {
      const payload = await startVoyage({
        departurePort: text(data.get('departurePort')),
        destinationPort: text(data.get('destinationPort')),
        vesselName: text(data.get('vesselName')),
        vesselClass: text(data.get('vesselClass')),
        vesselCallsign: text(data.get('vesselCallsign')),
        officerOfWatchEmployeeId: Number(data.get('officerOfWatchEmployeeId')),
        crewComplementIds: data.getAll('crewComplementIds').map((value) => Number(value))
      });

      closeModal('startVoyageModal');
      startForm.reset();
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
