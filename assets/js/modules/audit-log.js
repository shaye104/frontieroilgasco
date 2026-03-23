import { getAuditLogCsvUrl, listAuditLog } from './admin-api.js';
import { formatLocalDateTime } from './local-datetime.js';
import { clearMessage, showMessage } from './notice.js';

function text(value) {
  const s = String(value ?? '').trim();
  return s || 'N/A';
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const numberFormatter = new Intl.NumberFormat('nl-NL');

function formatDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'N/A';
  return formatLocalDateTime(raw, { fallback: raw });
}

function actorDisplay(row) {
  return text(row?.actorRobloxUsername || row?.actorName || row?.actorDiscordId || 'System');
}

function renderRows(target, rows) {
  if (!target) return;
  if (!rows.length) {
    target.innerHTML = '<tr><td colspan="6">Geen auditregels gevonden voor de geselecteerde filters.</td></tr>';
    return;
  }

  target.innerHTML = rows
    .map(
      (row) => `
      <tr>
        <td>${Number(row.id || 0)}</td>
        <td>${escapeHtml(formatDate(row.createdAt))}</td>
        <td>${escapeHtml(text(row.actionType))}</td>
        <td>${escapeHtml(actorDisplay(row))}</td>
        <td>${row.targetEmployeeId ? Number(row.targetEmployeeId) : 'N/A'}</td>
        <td>${escapeHtml(text(row.summary))}</td>
      </tr>`
    )
    .join('');
}

function skeletonRows(count = 8) {
  return Array.from({ length: count }, () => `<tr>
    <td><span class="skeleton-line skeleton-w-45"></span></td>
    <td><span class="skeleton-line skeleton-w-70"></span></td>
    <td><span class="skeleton-line skeleton-w-60"></span></td>
    <td><span class="skeleton-line skeleton-w-80"></span></td>
    <td><span class="skeleton-line skeleton-w-45"></span></td>
    <td><span class="skeleton-line skeleton-w-90"></span></td>
  </tr>`).join('');
}

export async function initAuditLog(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const tableBody = document.querySelector(config.tableBodySelector);
  const searchInput = document.querySelector(config.searchSelector);
  const actionTypeInput = document.querySelector(config.actionTypeSelector);
  const actorInput = document.querySelector(config.actorSelector);
  const targetEmployeeInput = document.querySelector(config.targetEmployeeSelector);
  const dateFromInput = document.querySelector(config.dateFromSelector);
  const dateToInput = document.querySelector(config.dateToSelector);
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
      actionType: actionTypeInput?.value || '',
      actor: actorInput?.value || '',
      targetEmployeeId: targetEmployeeInput?.value || '',
      dateFrom: dateFromInput?.value || '',
      dateTo: dateToInput?.value || '',
      page: state.page,
      pageSize: state.pageSize
    };
  }

  const refresh = async () => {
    tableBody.innerHTML = skeletonRows();
    try {
      const payload = await listAuditLog(collectFilters());
      renderRows(tableBody, payload.events || []);
      const pagination = payload.pagination || {};
      state.totalPages = Math.max(1, Number(pagination.totalPages || 1));
      state.page = Math.min(state.totalPages, Math.max(1, Number(pagination.page || 1)));
      if (pageInfo) pageInfo.textContent = `Pagina ${state.page} van ${state.totalPages} • ${numberFormatter.format(Number(pagination.total || 0))} totaal`;
      if (prevPageBtn) prevPageBtn.disabled = state.page <= 1;
      if (nextPageBtn) nextPageBtn.disabled = state.page >= state.totalPages;
      clearMessage(feedback);
    } catch (error) {
      showMessage(feedback, error.message || 'Auditlog kon niet worden geladen.', 'error');
      tableBody.innerHTML = '<tr><td colspan="6">Auditlog kon niet worden geladen.</td></tr>';
    }
  };

  const scheduleRefresh = () => {
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => {
      state.page = 1;
      refresh();
    }, 250);
  };

  [searchInput, actionTypeInput, actorInput, targetEmployeeInput, dateFromInput, dateToInput].forEach((input) => {
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
    const url = getAuditLogCsvUrl(collectFilters());
    window.location.href = url;
  });

  await refresh();
}
