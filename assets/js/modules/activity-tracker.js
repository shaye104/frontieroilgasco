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

function startOfWeekIsoToday() {
  const now = new Date();
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = local.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  local.setDate(local.getDate() + diff);
  return local.toISOString().slice(0, 10);
}

function todayIso() {
  const now = new Date();
  const local = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return local.toISOString().slice(0, 10);
}

function statusClass(row) {
  if (!row) return 'is-inactive';
  if (!row.meetsQuota && Number(row.totalVoyages || 0) === 0) return 'is-rejected';
  if (!row.meetsQuota) return 'is-pending';
  return 'is-active';
}

function rowClass(row) {
  if (!row) return '';
  if (Number(row.totalVoyages || 0) === 0) return 'row-alert row-critical';
  if (!row.meetsQuota) return 'row-alert';
  return '';
}

function renderSummary(target, summary = {}) {
  if (!target) return;
  const cards = [
    ['Under Quota', Number(summary.atRisk || 0)],
    ['No Voyages', Number(summary.noVoyages || 0)],
    ['Inactive 14+ Days', Number(summary.inactive14Plus || 0)]
  ];
  target.innerHTML = cards
    .map(
      ([label, value]) => `<article class="activity-summary-stat">
        <p class="activity-summary-label">${escapeHtml(label)}</p>
        <strong class="activity-summary-value">${numberFormatter.format(value)}</strong>
      </article>`
    )
    .join('');
}

function renderRows(target, rows) {
  if (!target) return;
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="8">No activity found for the selected filters.</td></tr>';
    return;
  }

  target.innerHTML = rows
    .map(
      (row) => `
      <tr class="${rowClass(row)}">
        <td>${escapeHtml(text(row.robloxUsername))}</td>
        <td>${escapeHtml(text(row.rank))}</td>
        <td><span class="badge badge-status ${statusClass(row)}">${escapeHtml(text(row.employeeStatus || row.activationStatus || 'ACTIVE'))}</span></td>
        <td>${numberFormatter.format(Number(row.totalVoyages || 0))}</td>
        <td>${numberFormatter.format(Number(row.quotaTarget || 0))}</td>
        <td>${numberFormatter.format(Number(row.oowVoyages || 0))} / ${numberFormatter.format(Number(row.crewVoyages || 0))}</td>
        <td>${escapeHtml(formatDate(row.lastVoyageAt))}</td>
        <td>${row.daysSinceLastVoyage === null ? 'Never' : numberFormatter.format(Number(row.daysSinceLastVoyage || 0))}</td>
      </tr>`
    )
    .join('');
}

function skeletonRows(count = 8) {
  return Array.from({ length: count }, () => `<tr>
    <td><span class="skeleton-line skeleton-w-70"></span></td>
    <td><span class="skeleton-line skeleton-w-80"></span></td>
    <td><span class="skeleton-line skeleton-w-45"></span></td>
    <td><span class="skeleton-line skeleton-w-45"></span></td>
    <td><span class="skeleton-line skeleton-w-45"></span></td>
    <td><span class="skeleton-line skeleton-w-55"></span></td>
    <td><span class="skeleton-line skeleton-w-90"></span></td>
    <td><span class="skeleton-line skeleton-w-45"></span></td>
  </tr>`).join('');
}

export async function initActivityTracker(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const tableBody = document.querySelector(config.tableBodySelector);
  const searchInput = document.querySelector(config.searchSelector);
  const dateFromInput = document.querySelector(config.dateFromSelector);
  const dateToInput = document.querySelector(config.dateToSelector);
  const quotaTargetInput = document.querySelector(config.quotaTargetSelector);
  const quotaFilterInput = document.querySelector(config.quotaFilterSelector);
  const activeOnlyInput = document.querySelector(config.activeOnlySelector);
  const exportCsvBtn = document.querySelector(config.exportCsvBtnSelector);
  const prevPageBtn = document.querySelector(config.prevPageBtnSelector);
  const nextPageBtn = document.querySelector(config.nextPageBtnSelector);
  const pageInfo = document.querySelector(config.pageInfoSelector);
  const summaryGrid = document.querySelector(config.summaryGridSelector);

  if (!feedback || !tableBody) return;

  const state = {
    page: 1,
    pageSize: 25,
    totalPages: 1
  };
  let debounceTimer = null;

  if (dateFromInput && !dateFromInput.value) dateFromInput.value = startOfWeekIsoToday();
  if (dateToInput && !dateToInput.value) dateToInput.value = todayIso();
  if (quotaTargetInput && !quotaTargetInput.value) quotaTargetInput.value = '4';
  if (quotaFilterInput && !quotaFilterInput.value) quotaFilterInput.value = 'not_met';
  if (activeOnlyInput) activeOnlyInput.checked = true;

  function collectFilters() {
    return {
      search: searchInput?.value || '',
      dateFrom: dateFromInput?.value || '',
      dateTo: dateToInput?.value || '',
      quotaTarget: quotaTargetInput?.value || '',
      quotaFilter: quotaFilterInput?.value || '',
      activeOnly: Boolean(activeOnlyInput?.checked),
      page: state.page,
      pageSize: state.pageSize
    };
  }

  const refresh = async () => {
    tableBody.innerHTML = skeletonRows();
    try {
      const payload = await listActivityTracker(collectFilters());
      renderSummary(summaryGrid, payload.summary || {});
      renderRows(tableBody, payload.rows || []);
      const pagination = payload.pagination || {};
      state.totalPages = Math.max(1, Number(pagination.totalPages || 1));
      state.page = Math.min(state.totalPages, Math.max(1, Number(pagination.page || 1)));
      if (pageInfo) {
        pageInfo.textContent = `Page ${state.page} of ${state.totalPages} • ${numberFormatter.format(Number(pagination.total || 0))} employees`;
      }
      if (prevPageBtn) prevPageBtn.disabled = state.page <= 1;
      if (nextPageBtn) nextPageBtn.disabled = state.page >= state.totalPages;
      clearMessage(feedback);
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to load activity tracker.', 'error');
      tableBody.innerHTML = '<tr><td colspan="8">Unable to load activity data.</td></tr>';
    }
  };

  const scheduleRefresh = () => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      state.page = 1;
      refresh();
    }, 250);
  };

  [searchInput, dateFromInput, dateToInput, quotaTargetInput, quotaFilterInput, activeOnlyInput].forEach((input) => {
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
