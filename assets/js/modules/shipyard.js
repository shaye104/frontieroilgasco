import { archiveShipyardShip, createShipyardShip, listShipyardShips, updateShipyardShip } from './admin-api.js?v=20260308b';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export async function initShipyardPage(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const listRoot = document.querySelector(config.listSelector);
  const form = document.querySelector(config.formSelector);
  if (!feedback || !listRoot || !form) return;

  let ships = [];

  async function load() {
    const payload = await listShipyardShips(true);
    ships = Array.isArray(payload?.ships) ? payload.ships : [];
    render();
    clearMessage(feedback);
  }

  async function onCreate(event) {
    event.preventDefault();
    const fd = new FormData(form);
    const shipName = text(fd.get('shipName'));
    const vesselCallsign = text(fd.get('vesselCallsign'));
    const vesselClass = text(fd.get('vesselClass'));
    if (!shipName || !vesselCallsign || !vesselClass) {
      showMessage(feedback, 'Ship name, callsign, and class are required.', 'error');
      return;
    }
    try {
      await createShipyardShip({ shipName, vesselCallsign, vesselType: 'Freight', vesselClass, isActive: 1 });
      form.reset();
      showMessage(feedback, 'Ship added.', 'success');
      await load();
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to add ship.', 'error');
    }
  }

  function render() {
    listRoot.innerHTML = `
      <div class="table-wrap shipyard-table-wrap">
        <table class="data-table shipyard-table">
          <thead>
            <tr>
              <th>Ship Name</th>
              <th>Callsign</th>
              <th>Class</th>
              <th>Status</th>
              <th>Updated</th>
              <th class="align-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${
              ships.length
                ? ships
                    .map(
                      (row) => `
                        <tr>
                          <td>${escapeHtml(text(row.ship_name))}</td>
                          <td>${escapeHtml(text(row.vessel_callsign))}</td>
                          <td>${escapeHtml(text(row.vessel_class))}</td>
                          <td><span class="badge badge-status ${Number(row.is_active || 0) ? 'is-active' : 'is-inactive'}">${Number(row.is_active || 0) ? 'ACTIVE' : 'INACTIVE'}</span></td>
                          <td>${escapeHtml(text(row.updated_at || row.created_at || 'N/A'))}</td>
                          <td class="align-right">
                            <details class="shipyard-actions-menu">
                              <summary class="btn btn-secondary btn-compact">Manage</summary>
                              <div class="shipyard-actions-popover">
                                <button class="btn btn-secondary btn-compact" type="button" data-edit-ship="${Number(row.id)}">Edit Ship</button>
                                ${
                                  Number(row.is_active || 0)
                                    ? `<button class="btn btn-secondary btn-compact" type="button" data-archive-ship="${Number(row.id)}">Archive Ship</button>`
                                    : ''
                                }
                                <button class="btn btn-danger btn-compact" type="button" data-delete-ship="${Number(row.id)}">Delete Ship</button>
                              </div>
                            </details>
                          </td>
                        </tr>
                      `
                    )
                    .join('')
                : '<tr><td colspan="6">No ships configured yet.</td></tr>'
            }
          </tbody>
        </table>
      </div>
    `;
  }

  listRoot.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    const editButton = target.closest('[data-edit-ship]');
    if (editButton) {
      const shipId = Number(editButton.getAttribute('data-edit-ship'));
      const row = ships.find((item) => Number(item.id) === shipId);
      if (!row) return;
      const nextName = window.prompt('Ship name:', text(row.ship_name));
      if (nextName === null) return;
      const nextCallsign = window.prompt('Vessel callsign:', text(row.vessel_callsign));
      if (nextCallsign === null) return;
      const nextClass = window.prompt('Vessel class:', text(row.vessel_class));
      if (nextClass === null) return;
      void (async () => {
        try {
          await updateShipyardShip(shipId, {
            shipName: nextName,
            vesselCallsign: nextCallsign,
            vesselType: text(row.vessel_type || 'Freight') || 'Freight',
            vesselClass: nextClass,
            isActive: Number(row.is_active || 0) ? 1 : 0
          });
          showMessage(feedback, 'Ship updated.', 'success');
          await load();
        } catch (error) {
          showMessage(feedback, error.message || 'Unable to update ship.', 'error');
        }
      })();
      return;
    }

    const archiveButton = target.closest('[data-archive-ship]');
    if (archiveButton) {
      const shipId = Number(archiveButton.getAttribute('data-archive-ship'));
      if (!shipId) return;
      void (async () => {
        try {
          await archiveShipyardShip(shipId);
          showMessage(feedback, 'Ship archived.', 'success');
          await load();
        } catch (error) {
          showMessage(feedback, error.message || 'Unable to archive ship.', 'error');
        }
      })();
      return;
    }

    const deleteButton = target.closest('[data-delete-ship]');
    if (deleteButton) {
      const shipId = Number(deleteButton.getAttribute('data-delete-ship'));
      const row = ships.find((item) => Number(item.id) === shipId);
      if (!row) return;
      const confirmWord = window.prompt(`Type DELETE to remove ship "${text(row.ship_name)}".`);
      if (confirmWord !== 'DELETE') return;
      void (async () => {
        try {
          await archiveShipyardShip(shipId);
          showMessage(feedback, 'Ship deleted.', 'success');
          await load();
        } catch (error) {
          showMessage(feedback, error.message || 'Unable to delete ship.', 'error');
        }
      })();
    }
  });

  form.addEventListener('submit', onCreate);

  try {
    await load();
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load Shipyard.', 'error');
  }
}
