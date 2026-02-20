import { listActivityTracker } from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const s = String(value ?? '').trim();
  return s || 'N/A';
}

function renderRows(target, rows) {
  if (!target) return;
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="5">No employees match the current filter.</td></tr>';
    return;
  }

  target.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${text(row.roblox_username)}</td>
        <td>${text(row.serial_number)}</td>
        <td>${text(row.rank)}</td>
        <td>${Number(row.total_voyages || 0)}</td>
        <td>${Number(row.monthly_voyages || 0)}</td>
      </tr>`
    )
    .join('');
}

export async function initActivityTracker(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const tableBody = document.querySelector(config.tableBodySelector);
  const searchInput = document.querySelector(config.searchSelector);
  const lessThanInput = document.querySelector(config.lessThanSelector);
  const scopeSelect = document.querySelector(config.scopeSelector);

  if (!feedback || !tableBody || !searchInput || !lessThanInput || !scopeSelect) return;

  let debounceTimer = null;

  const refresh = async () => {
    try {
      const payload = await listActivityTracker({
        search: searchInput.value,
        lessThan: lessThanInput.value,
        scope: scopeSelect.value
      });
      renderRows(tableBody, payload.employees || []);
      clearMessage(feedback);
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to load activity tracker.', 'error');
      tableBody.innerHTML = '<tr><td colspan="5">Unable to load data</td></tr>';
    }
  };

  const scheduleRefresh = () => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => refresh(), 250);
  };

  searchInput.addEventListener('input', scheduleRefresh);
  lessThanInput.addEventListener('input', scheduleRefresh);
  scopeSelect.addEventListener('change', refresh);

  await refresh();
}
