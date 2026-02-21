import { hasPermission, performLogout, renderIntranetNavbar } from '../modules/nav.js?v=20260221h';

function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return [...document.querySelectorAll(selector)];
}

function text(value) {
  const output = String(value ?? '').trim();
  return output || 'N/A';
}

function toMoney(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? Math.round(num) : 0;
}

function formatGuilders(value) {
  return `\u0192 ${toMoney(value).toLocaleString()}`;
}

function formatWhen(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return text(value);
  return date.toLocaleString();
}

function normalizePathname(pathname) {
  return String(pathname || '').replace(/\/+$/, '') || '/';
}

function renderNavbar(session) {
  renderIntranetNavbar(session);
  const current = '/finances';
  $$('.site-nav a[href]').forEach((link) => {
    const href = link.getAttribute('href') || '/';
    const path = normalizePathname(new URL(href, window.location.origin).pathname);
    const isActive = path === current;
    link.classList.toggle('is-active', isActive);
    if (isActive) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  const logout = $('.site-nav button.btn.btn-secondary');
  if (!logout) return;
  logout.onclick = async () => {
    try {
      await performLogout('/');
    } catch {
      window.location.href = '/';
    }
  };
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: {
      accept: 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  let payload = {};
  try {
    payload = await response.json();
  } catch {
    payload = {};
  }

  if (!response.ok) {
    throw new Error(payload.error || `Request failed (${response.status})`);
  }

  return payload;
}

function setFeedback(message, type = 'error', retryFn = null) {
  const box = $('#financesFeedback');
  if (!box) return;
  box.className = `feedback is-visible ${type === 'error' ? 'is-error' : 'is-success'}`;
  box.innerHTML = '';

  const copy = document.createElement('span');
  copy.textContent = message;
  box.append(copy);

  if (typeof retryFn === 'function') {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-secondary';
    retry.textContent = 'Retry';
    retry.style.marginLeft = '0.6rem';
    retry.addEventListener('click', async () => {
      await retryFn();
    });
    box.append(retry);
  }
}

function clearFeedback() {
  const box = $('#financesFeedback');
  if (!box) return;
  box.className = 'feedback';
  box.textContent = '';
}

function setActiveRange(range) {
  $$('[data-finance-range]').forEach((button) => {
    button.classList.toggle('is-active', button.getAttribute('data-finance-range') === range);
  });
}

function setActiveTab(tab) {
  $$('[data-finance-tab]').forEach((button) => {
    const isActive = button.getAttribute('data-finance-tab') === tab;
    button.classList.toggle('is-active', isActive);
    if (isActive) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });

  $$('[data-finance-panel]').forEach((panel) => {
    const isActive = panel.getAttribute('data-finance-panel') === tab;
    panel.classList.toggle('hidden', !isActive);
    panel.classList.toggle('is-active', isActive);
  });
}

function normalizeFinanceTab(input) {
  const value = String(input || '').trim().toLowerCase();
  if (value === 'overview' || value === 'trends' || value === 'debts' || value === 'audit') return value;
  return 'overview';
}

function renderSimpleLineChart(target, series, colorClass = 'line-primary', options = {}) {
  if (!target) return;
  const safeSeries = Array.isArray(series) ? series : [];
  if (!safeSeries.length) {
    target.innerHTML = '<p class="muted">No data for selected range</p>';
    return;
  }

  const width = Number(options.width || 560);
  const height = Number(options.height || 170);
  const paddingX = Number(options.paddingX || 22);
  const paddingY = Number(options.paddingY || 18);
  const max = Math.max(1, ...safeSeries.map((point) => Math.max(0, toMoney(point.value))));
  const stepX = safeSeries.length > 1 ? (width - paddingX * 2) / (safeSeries.length - 1) : 0;
  const points = safeSeries
    .map((point, index) => {
      const x = paddingX + stepX * index;
      const y = height - paddingY - (Math.max(0, toMoney(point.value)) / max) * (height - paddingY * 2);
      return `${x},${y}`;
    })
    .join(' ');

  const labelStep = safeSeries.length > 10 ? Math.ceil(safeSeries.length / 7) : 1;
  target.innerHTML = `
    <svg class="finance-line-svg ${colorClass}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${points}" />
    </svg>
    <div class="finance-chart-label-row">
      ${safeSeries
        .map((point, index) => `<span>${index % labelStep === 0 || index === safeSeries.length - 1 ? text(point.label) : ''}</span>`)
        .join('')}
    </div>
  `;
}

function renderStackedShareChart(target, series) {
  if (!target) return;
  const safeSeries = Array.isArray(series) ? series : [];
  if (!safeSeries.length) {
    target.innerHTML = '<p class="muted">No data for selected range</p>';
    return;
  }

  const maxTotal = Math.max(
    1,
    ...safeSeries.map((point) => Math.max(0, toMoney(point.companyShare)) + Math.max(0, toMoney(point.crewShare)))
  );
  const labelStep = safeSeries.length > 10 ? Math.ceil(safeSeries.length / 7) : 1;

  target.innerHTML = `
    <div class="finance-stacked-bars">
      ${safeSeries
        .map((point, index) => {
          const company = Math.max(0, toMoney(point.companyShare));
          const crew = Math.max(0, toMoney(point.crewShare));
          const total = company + crew;
          const heightPct = Math.max(8, (total / maxTotal) * 100);
          const companyPct = total > 0 ? (company / total) * 100 : 0;
          const label = index % labelStep === 0 || index === safeSeries.length - 1 ? text(point.label) : '';
          return `<div class="finance-stacked-col">
            <div class="finance-stacked-track" style="height:${heightPct}%">
              <span class="finance-stacked-segment finance-stacked-company" style="height:${companyPct}%"></span>
              <span class="finance-stacked-segment finance-stacked-crew" style="height:${Math.max(0, 100 - companyPct)}%"></span>
            </div>
            <small>${label}</small>
          </div>`;
        })
        .join('')}
    </div>
  `;
}

function renderOverviewSkeleton() {
  ['#kpiNetProfit', '#kpiCompanyShare', '#kpiCrewShare', '#kpiLossValue', '#kpiCompletedVoyages', '#kpiUnsettled'].forEach((selector) => {
    const el = $(selector);
    if (el) el.innerHTML = '<span class="finance-value-skeleton"></span>';
  });

  ['#chartNetProfit', '#trendsChartNetProfit', '#trendsChartCompanyCrew', '#trendsChartLossTrend', '#trendsChartAvgProfit'].forEach((selector) => {
    const el = $(selector);
    if (el) el.innerHTML = '<div class="finance-chart-skeleton"></div>';
  });

  const unsettledAmount = $('#unsettledOutstandingTotal');
  if (unsettledAmount) unsettledAmount.innerHTML = '<span class="finance-value-skeleton"></span>';

  const top = $('#unsettledTopList');
  if (top) {
    top.innerHTML =
      '<li class="finance-unsettled-item"><span class="finance-line-skeleton"></span></li>' +
      '<li class="finance-unsettled-item"><span class="finance-line-skeleton"></span></li>' +
      '<li class="finance-unsettled-item"><span class="finance-line-skeleton"></span></li>';
  }

  const companyMini = $('#overviewCompanyMini');
  const crewMini = $('#overviewCrewMini');
  if (companyMini) companyMini.innerHTML = '<span class="finance-value-skeleton"></span>';
  if (crewMini) crewMini.innerHTML = '<span class="finance-value-skeleton"></span>';
}

function renderOverview(data) {
  const kpis = data?.kpis || {};
  const charts = data?.charts || {};
  const unsettled = data?.unsettled || {};

  const writeMoney = (selector, value) => {
    const el = $(selector);
    if (!el) return;
    el.textContent = formatGuilders(value);
  };

  writeMoney('#kpiNetProfit', kpis.netProfit);
  writeMoney('#kpiCompanyShare', kpis.companyShareEarnings);
  writeMoney('#kpiCrewShare', kpis.crewShare);
  writeMoney('#kpiLossValue', kpis.freightLossesValue);
  writeMoney('#kpiUnsettled', kpis.unsettledCompanyShareOutstanding);

  const completed = $('#kpiCompletedVoyages');
  if (completed) completed.textContent = String(Number(kpis.completedVoyages || 0));

  writeMoney('#overviewCompanyMini', kpis.companyShareEarnings);
  writeMoney('#overviewCrewMini', kpis.crewShare);

  renderSimpleLineChart($('#chartNetProfit'), charts.netProfitTrend || [], 'line-primary');
  renderSimpleLineChart($('#trendsChartNetProfit'), charts.netProfitTrend || [], 'line-primary');
  renderStackedShareChart($('#trendsChartCompanyCrew'), charts.companyVsCrew || []);
  renderSimpleLineChart($('#trendsChartLossTrend'), charts.freightLossValueTrend || [], 'line-accent');
  renderSimpleLineChart($('#trendsChartAvgProfit'), charts.avgNetProfitTrend || [], 'line-muted');

  const unsettledTotal = $('#unsettledOutstandingTotal');
  if (unsettledTotal) unsettledTotal.textContent = formatGuilders(unsettled.totalOutstanding || 0);

  const unsettledCount = $('#unsettledVoyageCount');
  if (unsettledCount) {
    unsettledCount.textContent = `Unsettled Voyages: ${Number(unsettled.totalVoyages || 0)}`;
  }

  const top = $('#unsettledTopList');
  const topDebtors = Array.isArray(unsettled.topDebtors) ? unsettled.topDebtors : [];
  if (top) {
    if (!topDebtors.length) {
      top.innerHTML = '<li class="finance-unsettled-item"><span class="muted">No outstanding company share</span></li>';
    } else {
      top.innerHTML = topDebtors
        .slice(0, 5)
        .map((row) => {
          const officer = row.officerSerial ? `${text(row.officerName)} (${text(row.officerSerial)})` : text(row.officerName);
          return `<li class="finance-unsettled-item"><span class="finance-unsettled-name">${officer}</span><strong class="finance-unsettled-amount">${formatGuilders(
            row.outstanding
          )}</strong></li>`;
        })
        .join('');
    }
  }
}

function rangeWindow(range) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);

  const start = new Date(end);
  if (range === 'week') {
    start.setDate(end.getDate() - 6);
  } else if (range === 'month') {
    start.setDate(1);
  } else if (range === '3m') {
    start.setMonth(end.getMonth() - 2, 1);
  } else if (range === '6m') {
    start.setMonth(end.getMonth() - 5, 1);
  } else {
    start.setMonth(0, 1);
  }
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function isInRange(value, start, end) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return date >= start && date <= end;
}

function renderDebtsSkeleton() {
  const groups = $('#financeDebtsGroups');
  if (!groups) return;
  groups.innerHTML =
    '<article class="finance-debt-group"><span class="finance-line-skeleton"></span><span class="finance-line-skeleton"></span></article>' +
    '<article class="finance-debt-group"><span class="finance-line-skeleton"></span><span class="finance-line-skeleton"></span></article>';
}

function toDebtSummary(groups) {
  const safe = Array.isArray(groups) ? groups : [];
  const outstanding = safe.reduce((sum, group) => sum + toMoney(group.outstandingTotal || 0), 0);
  const voyages = safe.reduce((sum, group) => sum + Number(group.voyageCount || 0), 0);
  const unique = safe.length;
  return { outstanding: toMoney(outstanding), voyages, unique };
}

function renderDebtsPagination(state) {
  const pageInfo = $('#financeDebtsPageInfo');
  const prev = $('#financeDebtsPrev');
  const next = $('#financeDebtsNext');

  state.debtTotalPages = Math.max(1, Math.ceil(state.debtGroups.length / state.debtPageSize));
  state.debtPage = Math.max(1, Math.min(state.debtPage, state.debtTotalPages));

  if (pageInfo) pageInfo.textContent = `Page ${state.debtPage} of ${state.debtTotalPages}`;
  if (prev) prev.disabled = state.debtPage <= 1;
  if (next) next.disabled = state.debtPage >= state.debtTotalPages;
}

function renderDebts(state) {
  const scope = $('#debtScope')?.value || 'all';
  const groups = Array.isArray(state.debtGroupsRaw) ? state.debtGroupsRaw : [];
  const filtered = groups
    .map((group) => {
      const voyages = Array.isArray(group.voyages) ? group.voyages : [];
      const scopedVoyages =
        scope === 'range'
          ? (() => {
              const { start, end } = rangeWindow(state.range);
              return voyages.filter((voyage) => isInRange(voyage.endedAt, start, end));
            })()
          : voyages;

      if (!scopedVoyages.length) return null;

      const outstandingTotal = toMoney(scopedVoyages.reduce((sum, voyage) => sum + toMoney(voyage.companyShareAmount || 0), 0));
      return {
        ...group,
        voyages: scopedVoyages,
        outstandingTotal,
        voyageCount: scopedVoyages.length
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.outstandingTotal - a.outstandingTotal || b.voyageCount - a.voyageCount || text(a.officerName).localeCompare(text(b.officerName)));

  state.debtGroups = filtered;
  const summary = toDebtSummary(filtered);

  const summaryOutstanding = $('#debtSummaryOutstanding');
  const summaryVoyages = $('#debtSummaryVoyages');
  const summaryOotw = $('#debtSummaryOotw');
  if (summaryOutstanding) summaryOutstanding.textContent = formatGuilders(summary.outstanding);
  if (summaryVoyages) summaryVoyages.textContent = String(summary.voyages);
  if (summaryOotw) summaryOotw.textContent = String(summary.unique);

  renderDebtsPagination(state);

  const groupsHost = $('#financeDebtsGroups');
  if (!groupsHost) return;

  if (!filtered.length) {
    groupsHost.innerHTML = '<article class="finance-debt-group"><p class="muted">No employees match the current filter.</p></article>';
    return;
  }

  const start = (state.debtPage - 1) * state.debtPageSize;
  const pageRows = filtered.slice(start, start + state.debtPageSize);

  groupsHost.innerHTML = pageRows
    .map((group, groupIndex) => {
      const groupId = `debt-group-${state.debtPage}-${groupIndex}`;
      return `<details class="finance-debt-group" ${groupIndex === 0 ? 'open' : ''}>
        <summary>
          <span>${text(group.officerName)}${group.officerSerial ? ` (${text(group.officerSerial)})` : ''}</span>
          <strong>${formatGuilders(group.outstandingTotal)} · ${group.voyageCount} voyage${group.voyageCount === 1 ? '' : 's'}</strong>
        </summary>
        <div class="table-wrap" id="${groupId}">
          <table class="data-table finance-data-table">
            <thead>
              <tr>
                <th>Vessel</th>
                <th>Route</th>
                <th>Ended</th>
                <th class="align-right">Amount ƒ</th>
                ${state.canSettle ? '<th>Action</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${group.voyages
                .map((voyage) => {
                  const settable = state.canSettle && String(voyage.companyShareStatus || '').toUpperCase() === 'UNSETTLED';
                  return `<tr>
                    <td>${text(voyage.vesselName)} | ${text(voyage.vesselCallsign)}</td>
                    <td>${text(voyage.departurePort)} → ${text(voyage.destinationPort)}</td>
                    <td>${formatWhen(voyage.endedAt)}</td>
                    <td class="align-right">${formatGuilders(voyage.companyShareAmount)}</td>
                    ${
                      state.canSettle
                        ? `<td>${
                            settable
                              ? `<button type="button" class="btn btn-primary btn-compact" data-settle-voyage="${Number(voyage.voyageId || 0)}">Settle</button>`
                              : '<span class="muted">Settled</span>'
                          }</td>`
                        : ''
                    }
                  </tr>`;
                })
                .join('')}
            </tbody>
          </table>
        </div>
      </details>`;
    })
    .join('');

  if (!state.canSettle) return;

  groupsHost.querySelectorAll('[data-settle-voyage]').forEach((button) => {
    button.addEventListener('click', async () => {
      const voyageId = Number(button.getAttribute('data-settle-voyage') || 0);
      if (!Number.isInteger(voyageId) || voyageId <= 0) return;
      button.disabled = true;
      try {
        await fetchJson(`/api/finances/debts/${encodeURIComponent(String(voyageId))}/settle`, { method: 'POST' });
        await Promise.all([loadDebts(state), loadOverview(state)]);
      } catch (error) {
        console.error('finances settle error', error);
        setFeedback(error.message || 'Failed to settle voyage debt.', 'error');
      } finally {
        button.disabled = false;
      }
    });
  });
}

async function loadDebts(state) {
  state.debtsLoading = true;
  renderDebtsSkeleton();
  try {
    const params = new URLSearchParams();
    const search = ($('#debtSearch')?.value || '').trim();
    const minOutstanding = ($('#debtMinOutstanding')?.value || '').trim();
    if (search) params.set('search', search);
    if (minOutstanding !== '') params.set('minOutstanding', minOutstanding);

    const query = params.toString();
    const data = await fetchJson(`/api/finances/debts${query ? `?${query}` : ''}`);
    console.log('finances debts response', data);

    state.debtGroupsRaw = Array.isArray(data?.groups) ? data.groups : [];
    state.canSettle = Boolean(data?.permissions?.canSettle);
    state.debtsLoaded = true;
    renderDebts(state);
    clearFeedback();
  } catch (error) {
    console.error('finances debts fetch error', error);
    const groupsHost = $('#financeDebtsGroups');
    if (groupsHost) {
      groupsHost.innerHTML = '<article class="finance-debt-group"><p class="muted">Unable to load debts data.</p></article>';
    }
    setFeedback(`Failed to load debt data: ${error.message || 'Unknown error'}`, 'error', async () => loadDebts(state));
  } finally {
    state.debtsLoading = false;
  }
}

function renderAuditSkeleton() {
  const tbody = $('#financeAuditBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6"><div class="finance-chart-skeleton"></div></td></tr>';
  const empty = $('#financeAuditEmpty');
  if (empty) empty.classList.add('hidden');
}

function renderAuditRows(state) {
  const tbody = $('#financeAuditBody');
  const empty = $('#financeAuditEmpty');
  if (!tbody) return;

  const rows = Array.isArray(state.auditRows) ? state.auditRows : [];
  if (!rows.length) {
    tbody.innerHTML = '';
    if (empty) empty.classList.remove('hidden');
    return;
  }

  if (empty) empty.classList.add('hidden');

  tbody.innerHTML = rows
    .map(
      (row) => `<tr>
        <td>${formatWhen(row.createdAt)}</td>
        <td>${text(row.vesselName)} | ${text(row.vesselCallsign)}</td>
        <td>${text(row.departurePort)} → ${text(row.destinationPort)}</td>
        <td class="align-right">${formatGuilders(row.amount)}</td>
        <td>${text(row.oowName)}${row.oowSerial ? ` (${text(row.oowSerial)})` : ''}</td>
        <td>${text(row.settledByName)}${row.settledByDiscordId ? ` (${text(row.settledByDiscordId)})` : ''}</td>
      </tr>`
    )
    .join('');
}

function renderAuditPagination(state) {
  const info = $('#financeAuditPageInfo');
  const prev = $('#financeAuditPrev');
  const next = $('#financeAuditNext');
  if (info) info.textContent = `Page ${state.auditPage} of ${state.auditTotalPages}`;
  if (prev) prev.disabled = state.auditPage <= 1;
  if (next) next.disabled = state.auditPage >= state.auditTotalPages;
}

async function loadAudit(state) {
  state.auditLoading = true;
  renderAuditSkeleton();
  try {
    const params = new URLSearchParams();
    params.set('page', String(state.auditPage));
    params.set('pageSize', String(state.auditPageSize));

    const settledBy = ($('#auditSettledBy')?.value || '').trim();
    const dateFrom = ($('#auditDateFrom')?.value || '').trim();
    const dateTo = ($('#auditDateTo')?.value || '').trim();

    if (settledBy) params.set('settledBy', settledBy);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    const data = await fetchJson(`/api/finances/audit?${params.toString()}`);
    console.log('finances audit response', data);

    state.auditRows = Array.isArray(data?.rows) ? data.rows : [];
    const pagination = data?.pagination || {};
    state.auditTotalPages = Math.max(1, Number(pagination.totalPages || 1));
    state.auditPage = Math.max(1, Math.min(state.auditPage, state.auditTotalPages));
    state.auditLoaded = true;

    renderAuditRows(state);
    renderAuditPagination(state);
    clearFeedback();
  } catch (error) {
    console.error('finances audit fetch error', error);
    const tbody = $('#financeAuditBody');
    if (tbody) {
      tbody.innerHTML = '<tr><td colspan="6">Unable to load audit data.</td></tr>';
    }
    const empty = $('#financeAuditEmpty');
    if (empty) empty.classList.add('hidden');
    setFeedback(`Failed to load audit data: ${error.message || 'Unknown error'}`, 'error', async () => loadAudit(state));
  } finally {
    state.auditLoading = false;
  }
}

async function loadOverview(state) {
  state.overviewLoading = true;
  renderOverviewSkeleton();
  try {
    console.log('fetch finances', state.range);
    const data = await fetchJson(`/api/finances/overview?range=${encodeURIComponent(state.range)}&unsettledScope=all`);
    console.log('finances overview response', data);
    state.overview = data || {};
    renderOverview(state.overview);
    clearFeedback();

    if (state.debtsLoaded && ($('#debtScope')?.value || 'all') === 'range') {
      renderDebts(state);
    }
  } catch (error) {
    console.error('finances overview fetch error', error);
    setFeedback(`Failed to load finance data: ${error.message || 'Unknown error'}`, 'error', async () => loadOverview(state));
  } finally {
    state.overviewLoading = false;
  }
}

async function handleTabChange(state, tab) {
  state.activeTab = normalizeFinanceTab(tab);
  setActiveTab(state.activeTab);
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set('tab', state.activeTab);
  window.history.replaceState({}, '', nextUrl.toString());

  if (state.activeTab === 'overview' || state.activeTab === 'trends') {
    if (!state.overview && !state.overviewLoading) {
      await loadOverview(state);
    }
    return;
  }

  if (state.activeTab === 'debts' && !state.debtsLoaded && !state.debtsLoading) {
    await loadDebts(state);
    return;
  }

  if (state.activeTab === 'audit' && !state.auditLoaded && !state.auditLoading) {
    await loadAudit(state);
  }
}

async function init() {
  document.documentElement.classList.add('intranet-no-scroll');
  document.body.classList.add('intranet-no-scroll');

  const state = {
    session: null,
    range: 'week',
    activeTab: normalizeFinanceTab(new URL(window.location.href).searchParams.get('tab')),
    overview: null,
    overviewLoading: false,
    debtsLoaded: false,
    debtsLoading: false,
    debtGroupsRaw: [],
    debtGroups: [],
    debtPage: 1,
    debtTotalPages: 1,
    debtPageSize: 3,
    canSettle: false,
    auditLoaded: false,
    auditLoading: false,
    auditRows: [],
    auditPage: 1,
    auditTotalPages: 1,
    auditPageSize: 12
  };

  let session;
  try {
    session = await fetchJson('/api/auth/session');
  } catch {
    window.location.href = '/login?auth=denied&reason=login_required';
    return;
  }

  if (!session?.loggedIn) {
    window.location.href = '/login?auth=denied&reason=login_required';
    return;
  }

  state.session = session;
  renderNavbar(session);

  if (!hasPermission(session, 'finances.view')) {
    setFeedback('You do not have permission to view this page.', 'error');
    return;
  }

  if (!hasPermission(session, 'finances.audit.view')) {
    const auditTab = document.querySelector('[data-finance-tab="audit"]');
    const auditPanel = document.querySelector('[data-finance-panel="audit"]');
    if (auditTab) auditTab.remove();
    if (auditPanel) auditPanel.remove();
    if (state.activeTab === 'audit') state.activeTab = 'overview';
  }

  setActiveRange(state.range);
  setActiveTab(state.activeTab);

  $$('[data-finance-range]').forEach((button) => {
    button.addEventListener('click', async () => {
      const range = button.getAttribute('data-finance-range') || 'week';
      if (state.range === range && state.overview) return;
      state.range = range;
      setActiveRange(range);
      await loadOverview(state);
    });
  });

  $$('[data-finance-tab]').forEach((button) => {
    button.addEventListener('click', async () => {
      const tab = button.getAttribute('data-finance-tab') || 'overview';
      await handleTabChange(state, tab);
    });
  });

  $$('[data-finance-open-tab]').forEach((link) => {
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      const tab = link.getAttribute('data-finance-open-tab') || 'debts';
      await handleTabChange(state, tab);
    });
  });

  const debtPrev = $('#financeDebtsPrev');
  const debtNext = $('#financeDebtsNext');
  if (debtPrev) {
    debtPrev.addEventListener('click', () => {
      if (state.debtPage <= 1) return;
      state.debtPage -= 1;
      renderDebts(state);
    });
  }
  if (debtNext) {
    debtNext.addEventListener('click', () => {
      if (state.debtPage >= state.debtTotalPages) return;
      state.debtPage += 1;
      renderDebts(state);
    });
  }

  let debtDebounce;
  const scheduleDebtReload = () => {
    state.debtPage = 1;
    if (debtDebounce) window.clearTimeout(debtDebounce);
    debtDebounce = window.setTimeout(async () => {
      await loadDebts(state);
    }, 320);
  };

  const debtSearch = $('#debtSearch');
  const debtMin = $('#debtMinOutstanding');
  const debtScope = $('#debtScope');
  if (debtSearch) debtSearch.addEventListener('input', scheduleDebtReload);
  if (debtMin) debtMin.addEventListener('input', scheduleDebtReload);
  if (debtScope) {
    debtScope.addEventListener('change', () => {
      state.debtPage = 1;
      if (state.debtsLoaded) renderDebts(state);
    });
  }

  const auditPrev = $('#financeAuditPrev');
  const auditNext = $('#financeAuditNext');
  if (auditPrev) {
    auditPrev.addEventListener('click', async () => {
      if (state.auditPage <= 1) return;
      state.auditPage -= 1;
      await loadAudit(state);
    });
  }
  if (auditNext) {
    auditNext.addEventListener('click', async () => {
      if (state.auditPage >= state.auditTotalPages) return;
      state.auditPage += 1;
      await loadAudit(state);
    });
  }

  let auditDebounce;
  const scheduleAuditReload = () => {
    state.auditPage = 1;
    if (auditDebounce) window.clearTimeout(auditDebounce);
    auditDebounce = window.setTimeout(async () => {
      await loadAudit(state);
    }, 320);
  };

  const auditSettledBy = $('#auditSettledBy');
  const auditDateFrom = $('#auditDateFrom');
  const auditDateTo = $('#auditDateTo');
  if (auditSettledBy) auditSettledBy.addEventListener('input', scheduleAuditReload);
  if (auditDateFrom) auditDateFrom.addEventListener('change', scheduleAuditReload);
  if (auditDateTo) auditDateTo.addEventListener('change', scheduleAuditReload);

  await loadOverview(state);
}

init().catch((error) => {
  console.error('finances init error', error);
  setFeedback(`Failed to load finance module: ${error.message || 'Unknown error'}`, 'error');
});
