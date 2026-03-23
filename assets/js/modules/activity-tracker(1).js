import { getActivityTrackerCsvUrl, listActivityTracker } from './admin-api.js';
import { formatLocalDateTime } from './local-datetime.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const s = String(value ?? '').trim();
  return s || 'N/A';
}

const numberFormatter = new Intl.NumberFormat('nl-NL');
function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'N/A';
  return formatLocalDateTime(raw, { fallback: raw });
}

function renderRows(target, rows) {
  if (!target) return;
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="7">No activity found for the selected filters.</td></tr>';
    return;
  }

  target.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${Number(row.employeeId || 0)}</td>
        <td>${escapeHtml(text(row.robloxUsername))}</td>
        <td>${escapeHtml(text(row.rank))}</td>
        <td>${numberFormatter.format(Number(row.totalVoyages || 0))}</td>
        <td>${numberFormatter.format(Number(row.oowVoyages || 0))}</td>
        <td>${numberFormatter.format(Number(row.crewVoyages || 0))}</td>
        <td>${escapeHtml(formatDate(row.lastVoyageAt))}</td>
      </tr>`
    )
    .join('');
}

function skeletonRows(count = 8) {
  return Array.from({ length: count }, () => `<tr>
    <td><span class="skeleton-line skeleton-w-45"></span></td>
    <td><span class="skeleton-line skeleton-w-70"></span></td>
    <td><span class="skeleton-line skeleton-w-80"></span></td>
    <td><span class="skeleton-line skeleton-w-45"></span></td>
    <td><span class="skeleton-line skeleton-w-45"></span></td>
    <td><span class="skeleton-line skeleton-w-45"></span></td>
    <td><span class="skeleton-line skeleton-w-90"></span></td>
  </tr>`).join('');
}

export async function initActivityTracker(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const tableBody = document.querySelector(config.tableBodySelector);
  const searchInput = document.querySelector(config.searchSelector);
  const dateFromInput = document.querySelector(config.dateFromSelector);
  const dateToInput = document.querySelector(config.dateToSelector);
  const minVoyagesInput = document.querySelector(config.minVoyagesSelector);
  const quotaFilterInput = document.querySelector(config.quotaFilterSelector);
  const exportCsvBtn = document.querySelector(config.exportCsvBtnSelector);
  const prevPageBtn = document.querySelector(config.prevPageBtnSelector);
  const nextPageBtn = document.querySelector(config.nextPageBtnSelector);
  const pageInfo = document.querySelector(config.pageInfoSelector);

  if (!feedback || !tableBody) return;

  const state = {
    page: 1,
    pageSize: 25,
    totalPages: 1
  };
  let debounceTimer = null;

  function collectFilters() {
    return {
      search: searchInput?.value || '',
      dateFrom: dateFromInput?.value || '',
      dateTo: dateToInput?.value || '',
      minVoyages: minVoyagesInput?.value || '',
      quotaFilter: quotaFilterInput?.value || '',
      page: state.page,
      pageSize: state.pageSize
    };
  }

  const refresh = async () => {
    tableBody.innerHTML = skeletonRows();
    try {
      const payload = await listActivityTracker(collectFilters());
      renderRows(tableBody, payload.rows || []);
      const pagination = payload.pagination || {};
      state.totalPages = Math.max(1, Number(pagination.totalPages || 1));
      state.page = Math.min(state.totalPages, Math.max(1, Number(pagination.page || 1)));
      if (pageInfo) {
        pageInfo.textContent = `Pagina ${state.page} van ${state.totalPages} • ${numberFormatter.format(Number(pagination.total || 0))} totaal`;
      }
      if (prevPageBtn) prevPageBtn.disabled = state.page <= 1;
      if (nextPageBtn) nextPageBtn.disabled = state.page >= state.totalPages;
      clearMessage(feedback);
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to load activity tracker.', 'error');
      tableBody.innerHTML = '<tr><td colspan="7">Unable to load activity data.</td></tr>';
    }
  };

  const scheduleRefresh = () => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      state.page = 1;
      refresh();
    }, 250);
  };

  [searchInput, dateFromInput, dateToInput, minVoyagesInput, quotaFilterInput].forEach((input) => {
    input?.addEventListener('input', scheduleRefresh);
    input?.addEventListener('change', scheduleRefresh);
  });

  prevPageBtn?.addEventListener('click', () => {
    if (state.page <= 1) return;
    state.page -= 1;
    refresh();
  });
  nextPageBtn?.addEventListener('click', () => {
    if (state.page >= state.totalPages) return;
    state.page += 1;
    refresh();
  });

  exportCsvBtn?.addEventListener('click', () => {
    const url = getActivityTrackerCsvUrl(collectFilters());
    window.location.href = url;
  });

  await refresh();
}
