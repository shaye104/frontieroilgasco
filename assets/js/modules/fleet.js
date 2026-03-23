import { assignEmployeeVessel, getFleetLeaderboard, listShipyardShips, searchEmployees } from './admin-api.js?v=20260308b';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const out = String(value ?? '').trim();
  return out || 'N/A';
}

function formatMoney(value) {
  const amount = Number(value || 0);
  return `ƒ ${Math.round(amount).toLocaleString()}`;
}

function sortShips(ships) {
  return [...ships].sort((a, b) => {
    const aCrew = Number((a?.employees || []).length);
    const bCrew = Number((b?.employees || []).length);
    if (aCrew !== bCrew) return bCrew - aCrew;
    return String(a?.vesselName || '').localeCompare(String(b?.vesselName || ''));
  });
}

function shipSummaryCard(ship, shipId) {
  return `
    <article class="panel fleet-summary-card" data-ship-id="${shipId}">
      <header class="fleet-summary-head">
        <div>
          <h2>${text(ship.vesselName)}</h2>
          <p class="finance-inline-caption">${text(ship.vesselCallsign)} | ${text(ship.vesselType)} | ${text(ship.vesselClass)}</p>
        </div>
        <button class="btn btn-secondary btn-compact" type="button" data-open-ship="${shipId}">Expand</button>
      </header>
      <div class="fleet-summary-grid">
        <div class="fleet-summary-item"><span>Voyages</span><strong>${Number(ship.shipTotalVoyages || 0)}</strong></div>
        <div class="fleet-summary-item"><span>Total Crew</span><strong>${Number((ship.employees || []).length)}</strong></div>
        <div class="fleet-summary-item"><span>Earnings</span><strong>${formatMoney(ship.shipTotalProfit || 0)}</strong></div>
      </div>
    </article>
  `;
}

function crewRowsMarkup(ship, canViewDrawer) {
  const employees = Array.isArray(ship?.employees) ? ship.employees : [];
  if (!employees.length) {
    return '<tr><td colspan="4">No assigned employees.</td></tr>';
  }
  return employees
    .map((row) => {
      const user = canViewDrawer
        ? `<button type="button" class="fleet-employee-link" data-open-employee="${Number(row.employeeId)}">${text(row.robloxUsername)}</button>`
        : `<span>${text(row.robloxUsername)}</span>`;
      return `
        <tr>
          <td>${user}</td>
          <td>${text(row.rank)}</td>
          <td>${Number(row.voyageCount || 0)}</td>
          <td class="align-right">${formatMoney(row.earnedTotal)}</td>
        </tr>
      `;
    })
    .join('');
}

export async function initFleetPage(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const totalsRoot = document.querySelector(config.totalsSelector);
  const toggleEmptyButton = document.querySelector(config.toggleEmptySelector);
  const shipsRoot = document.querySelector(config.shipsSelector);

  const drawerModal = document.querySelector(config.drawerModalSelector);
  const drawerFrame = document.querySelector(config.drawerFrameSelector);
  const drawerClose = document.querySelector(config.drawerCloseSelector);

  const shipModal = document.querySelector(config.shipModalSelector);
  const shipModalBody = document.querySelector(config.shipModalBodySelector);
  const shipModalTitle = document.querySelector(config.shipModalTitleSelector);
  const shipModalClose = document.querySelector(config.shipModalCloseSelector);

  if (
    !feedback ||
    !totalsRoot ||
    !shipsRoot ||
    !drawerModal ||
    !drawerFrame ||
    !drawerClose ||
    !shipModal ||
    !shipModalBody ||
    !shipModalTitle ||
    !shipModalClose
  ) {
    return;
  }

  let payload = null;
  let showEmptyShips = true;
  let activeShipId = null;
  let shipAssignDraft = null;
  let searchDebounce = null;

  function openEmployeeDrawer(employeeId) {
    drawerFrame.src = `/manage-employees?employeeId=${Number(employeeId)}`;
    drawerModal.classList.remove('hidden');
    drawerModal.setAttribute('aria-hidden', 'false');
  }

  function closeEmployeeDrawer() {
    drawerModal.classList.add('hidden');
    drawerModal.setAttribute('aria-hidden', 'true');
    drawerFrame.src = 'about:blank';
  }

  function openShipModal(shipId) {
    activeShipId = Number(shipId);
    renderShipModal();
    shipModal.classList.remove('hidden');
    shipModal.setAttribute('aria-hidden', 'false');
  }

  function closeShipModal() {
    shipModal.classList.add('hidden');
    shipModal.setAttribute('aria-hidden', 'true');
    activeShipId = null;
    shipAssignDraft = null;
    if (searchDebounce) {
      window.clearTimeout(searchDebounce);
      searchDebounce = null;
    }
  }

  function updateToggleButton() {
    if (!toggleEmptyButton) return;
    toggleEmptyButton.textContent = showEmptyShips ? 'Hide Empty Ships' : 'Show Empty Ships';
  }

  function currentShips() {
    const ships = Array.isArray(payload?.ships) ? payload.ships : [];
    const sorted = sortShips(ships);
    return showEmptyShips ? sorted : sorted.filter((ship) => Number((ship.employees || []).length) > 0);
  }

  function renderTotals() {
    const totals = payload?.totals || {};
    const totalShips = Number(totals.totalShips || 0);
    const totalCrew = Number(totals.totalEmployeesAssigned || 0);
    const totalUnassigned = Number((payload?.unassignedEmployees || []).length);
    const totalEmployees = totalCrew + totalUnassigned;
    const totalVoyages = (Array.isArray(payload?.ships) ? payload.ships : []).reduce(
      (sum, ship) => sum + Number(ship?.shipTotalVoyages || 0),
      0
    );
    totalsRoot.innerHTML = `
      <article class="metric-card"><p>Ships</p><h3>${totalShips}</h3></article>
      <article class="metric-card"><p>Total Employees</p><h3>${totalEmployees}</h3></article>
      <article class="metric-card"><p>Voyages</p><h3>${totalVoyages}</h3></article>
      <article class="metric-card"><p>Total Crew</p><h3>${totalCrew}</h3></article>
      <article class="metric-card metric-card-emphasis metric-card-primary"><p>Earnings</p><h3>${formatMoney(totals.fleetTotalProfit || 0)}</h3></article>
    `;
  }

  function renderShips() {
    const ships = currentShips();
    if (!ships.length) {
      shipsRoot.innerHTML = '<article class="panel fleet-summary-card"><p class="finance-inline-caption">No ships currently have assigned crew. Use "Show Empty Ships" to view all ships.</p></article>';
      return;
    }
    shipsRoot.innerHTML = ships
      .map((ship) => shipSummaryCard(ship, Number(ship.shipId || 0)))
      .join('');
  }

  function renderShipModal() {
    const ships = Array.isArray(payload?.ships) ? payload.ships : [];
    const ship = ships.find((row) => Number(row.shipId) === Number(activeShipId));
    if (!ship) {
      shipModalTitle.textContent = 'Ship';
      shipModalBody.innerHTML = '<p class="finance-inline-caption">Ship not found.</p>';
      return;
    }

    const canManage = Boolean(payload?.permissions?.canManageAssignments);
    const canViewDrawer = Boolean(payload?.permissions?.canViewEmployeeDrawer);
    const shipOptions = ships
      .filter((row) => Number(row.shipId) > 0)
      .map(
        (row) =>
          `<option value="${Number(row.shipId)}">${text(row.vesselName)} | ${text(row.vesselCallsign)} | ${text(row.vesselType)} | ${text(row.vesselClass)}</option>`
      )
      .join('');

    shipModalTitle.textContent = `${text(ship.vesselName)} (${text(ship.vesselCallsign)}) Crew`;
    shipModalBody.innerHTML = `
      <div class="finance-inline-caption" style="margin-bottom:.65rem;">
        <strong>Vessel Name:</strong> ${text(ship.vesselName)} |
        <strong>Vessel Callsign:</strong> ${text(ship.vesselCallsign)} |
        <strong>Vessel Type:</strong> ${text(ship.vesselType)} |
        <strong>Vessel Class:</strong> ${text(ship.vesselClass)}
      </div>
      <div class="fleet-ship-modal-summary">
        <article class="fleet-summary-item"><span>Voyages</span><strong>${Number(ship.shipTotalVoyages || 0)}</strong></article>
        <article class="fleet-summary-item"><span>Total Crew</span><strong>${Number((ship.employees || []).length)}</strong></article>
        <article class="fleet-summary-item"><span>Earnings</span><strong>${formatMoney(ship.shipTotalProfit || 0)}</strong></article>
      </div>
      ${
        canManage
          ? `<div class="fleet-ship-modal-assign">
               <div class="combobox-wrap">
                 <input type="text" id="fleetShipAssignSearch" placeholder="Search username to add/move crew..." autocomplete="off" />
                 <div class="autocomplete-list" id="fleetShipAssignResults"></div>
               </div>
               <button id="fleetShipAssignBtn" class="btn btn-primary" type="button" disabled>Add To Ship</button>
             </div>`
          : ''
      }
      <div class="table-wrap">
        <table class="data-table">
          <thead>
            <tr><th>Employee</th><th>Rank</th><th>Voyages</th><th class="align-right">Earned</th></tr>
          </thead>
          <tbody>${crewRowsMarkup(ship, canViewDrawer)}</tbody>
        </table>
      </div>
      <div id="fleetShipModalFeedback" class="feedback" role="status" aria-live="polite"></div>
    `;

    if (!canManage) return;
    const searchInput = shipModalBody.querySelector('#fleetShipAssignSearch');
    const results = shipModalBody.querySelector('#fleetShipAssignResults');
    const assignBtn = shipModalBody.querySelector('#fleetShipAssignBtn');

    function closeResults() {
      if (!results) return;
      results.classList.remove('is-open');
      results.innerHTML = '';
    }

    function renderResults(rows) {
      if (!results) return;
      if (!rows.length) {
        results.innerHTML = '<div class="autocomplete-empty">No users found</div>';
        results.classList.add('is-open');
        return;
      }
      results.innerHTML = rows
        .map(
          (row) => `
            <button class="autocomplete-item" type="button" data-pick-employee="${Number(row.id)}">
              <span>${text(row.roblox_username)}</span>
              <small>${text(row.rank)}</small>
            </button>
          `
        )
        .join('');
      results.classList.add('is-open');
    }

    searchInput?.addEventListener('input', () => {
      const query = String(searchInput.value || '').trim();
      shipAssignDraft = null;
      if (assignBtn) assignBtn.disabled = true;
      if (searchDebounce) window.clearTimeout(searchDebounce);
      if (query.length < 2) {
        closeResults();
        return;
      }
      searchDebounce = window.setTimeout(async () => {
        try {
          const res = await searchEmployees({ username: query, limit: 10 });
          renderResults(res?.employees || []);
        } catch {
          closeResults();
        }
      }, 220);
    });

    results?.addEventListener('click', (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      const pick = target.closest('[data-pick-employee]');
      if (!pick) return;
      const employeeId = Number(pick.getAttribute('data-pick-employee'));
      const label = String(pick.querySelector('span')?.textContent || '').trim();
      if (!Number.isInteger(employeeId) || employeeId <= 0) return;
      shipAssignDraft = { employeeId, label };
      if (searchInput) searchInput.value = label;
      if (assignBtn) assignBtn.disabled = false;
      closeResults();
    });

    assignBtn?.addEventListener('click', async () => {
      const employeeId = Number(shipAssignDraft?.employeeId || 0);
      if (!Number.isInteger(employeeId) || employeeId <= 0) return;
      try {
        await assignEmployeeVessel(employeeId, { shipId: Number(ship.shipId) });
        showMessage(feedback, 'Crew assignment saved.', 'success');
        const oldShipId = Number(ship.shipId);
        await load();
        activeShipId = oldShipId;
        renderShipModal();
      } catch (error) {
        const feedbackNode = shipModalBody.querySelector('#fleetShipModalFeedback');
        if (feedbackNode) showMessage(feedbackNode, error.message || 'Unable to assign crew.', 'error');
      }
    });
  }

  shipsRoot.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const openShip = target.closest('[data-open-ship]');
    if (openShip) {
      const shipId = Number(openShip.getAttribute('data-open-ship'));
      if (Number.isInteger(shipId) && shipId > 0) openShipModal(shipId);
      return;
    }
  });

  shipModalBody.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const open = target.closest('[data-open-employee]');
    if (!open || !payload?.permissions?.canViewEmployeeDrawer) return;
    const employeeId = Number(open.getAttribute('data-open-employee'));
    if (!Number.isInteger(employeeId) || employeeId <= 0) return;
    openEmployeeDrawer(employeeId);
  });

  toggleEmptyButton?.addEventListener('click', () => {
    showEmptyShips = !showEmptyShips;
    updateToggleButton();
    renderShips();
  });
  drawerClose.addEventListener('click', closeEmployeeDrawer);
  shipModalClose.addEventListener('click', closeShipModal);

  async function load() {
    payload = await getFleetLeaderboard();
    if (!Array.isArray(payload?.ships) || payload.ships.length === 0) {
      try {
        const shipyard = await listShipyardShips(true);
        const rows = Array.isArray(shipyard?.ships) ? shipyard.ships : [];
        if (rows.length) {
          const synthesized = rows.map((row) => ({
            shipId: Number(row.id || 0),
            vesselName: text(row.ship_name),
            vesselCallsign: text(row.vessel_callsign || row.ship_name),
            vesselType: text(row.vessel_type || 'Freight'),
            vesselClass: text(row.vessel_class),
            shipTotalProfit: 0,
            shipTotalVoyages: 0,
            employees: []
          }));
          payload = {
            ...(payload || {}),
            ships: synthesized,
            totals: {
              totalShips: synthesized.length,
              totalEmployeesAssigned: 0,
              fleetTotalProfit: 0
            }
          };
        }
      } catch {
        // Keep original payload when shipyard fallback fails.
      }
    }
    updateToggleButton();
    renderTotals();
    renderShips();
    clearMessage(feedback);
  }

  try {
    await load();
  } catch (error) {
    showMessage(feedback, error.message || 'Unable to load fleet leaderboard.', 'error');
  }
}
