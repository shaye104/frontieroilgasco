function $(selector) {
  return document.querySelector(selector);
}

function hasPermission(session, key) {
  const permissions = Array.isArray(session?.permissions) ? session.permissions : [];
  return permissions.includes('super.admin') || permissions.includes('admin.override') || permissions.includes(key);
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

function setFeedback(message, type = 'error', withRetry = null) {
  const box = $('#financesFeedback');
  if (!box) return;
  box.className = `feedback is-visible ${type === 'error' ? 'is-error' : 'is-success'}`;
  box.innerHTML = '';
  const copy = document.createElement('span');
  copy.textContent = message;
  box.append(copy);
  if (typeof withRetry === 'function') {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'btn btn-secondary';
    retry.textContent = 'Retry';
    retry.style.marginLeft = '0.6rem';
    retry.addEventListener('click', async () => withRetry());
    box.append(retry);
  }
}

function clearFeedback() {
  const box = $('#financesFeedback');
  if (!box) return;
  box.className = 'feedback';
  box.textContent = '';
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed: ${response.status}`);
  }
  return payload;
}

function renderNavbar(session) {
  const nav = $('.site-nav');
  if (!nav) return;

  nav.innerHTML = '';
  const links = [
    { href: '/my-details', label: 'My Details' },
    { href: '/voyages/my', label: 'Voyages' },
    { href: '/my-fleet', label: 'My Fleet' },
    { href: '/forms', label: 'Forms' },
    { href: '/finances', label: 'Finances' }
  ];

  links.forEach((item) => {
    const a = document.createElement('a');
    a.href = item.href;
    a.textContent = item.label;
    if (item.href === '/finances') {
      a.classList.add('is-active');
      a.setAttribute('aria-current', 'page');
    }
    nav.append(a);
  });

  if (hasPermission(session, 'admin.access')) {
    const admin = document.createElement('a');
    admin.href = '/admin';
    admin.textContent = 'Admin Panel';
    nav.append(admin);
  }

  const spacer = document.createElement('span');
  spacer.className = 'nav-spacer';
  nav.append(spacer);

  if (session?.displayName) {
    const user = document.createElement('span');
    user.className = 'nav-user';
    user.textContent = session.displayName;
    nav.append(user);
  }

  const logout = document.createElement('button');
  logout.type = 'button';
  logout.className = 'btn btn-secondary';
  logout.textContent = 'Logout';
  logout.addEventListener('click', async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } finally {
      window.location.href = '/';
    }
  });
  nav.append(logout);
}

function renderSimpleLineChart(target, series, colorClass = 'line-primary', options = {}) {
  if (!target) return;
  const safeSeries = Array.isArray(series) ? series : [];
  if (!safeSeries.length) {
    target.innerHTML = '<p class="muted">No data for selected range</p>';
    return;
  }

  const width = Number(options.width || 560);
  const height = Number(options.height || 150);
  const paddingX = Number(options.paddingX || 18);
  const paddingY = Number(options.paddingY || 14);
  const max = Math.max(1, ...safeSeries.map((point) => Math.max(0, toMoney(point.value))));
  const stepX = safeSeries.length > 1 ? (width - paddingX * 2) / (safeSeries.length - 1) : 0;
  const points = safeSeries
    .map((point, index) => {
      const x = paddingX + stepX * index;
      const y = height - paddingY - ((Math.max(0, toMoney(point.value)) / max) * (height - paddingY * 2));
      return `${x},${y}`;
    })
    .join(' ');

  const labelStep = safeSeries.length > 9 ? Math.ceil(safeSeries.length / 7) : 1;
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

  const maxTotal = Math.max(1, ...safeSeries.map((point) => Math.max(0, toMoney(point.companyShare)) + Math.max(0, toMoney(point.crewShare))));
  const labelStep = safeSeries.length > 9 ? Math.ceil(safeSeries.length / 7) : 1;

  target.innerHTML = `
    <div class="finance-stacked-bars">
      ${safeSeries
        .map((point, index) => {
          const company = Math.max(0, toMoney(point.companyShare));
          const crew = Math.max(0, toMoney(point.crewShare));
          const total = company + crew;
          const heightPct = Math.max(6, (total / maxTotal) * 100);
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

function setDebug(range, tab) {
  const debug = $('#financeDebugState');
  if (!debug) return;
  debug.textContent = `Range: ${range} | Tab: ${tab}`;
}

function setActiveTab(tab) {
  document.querySelectorAll('[data-finance-tab]').forEach((button) => {
    const isActive = button.getAttribute('data-finance-tab') === tab;
    button.classList.toggle('is-active', isActive);
    if (isActive) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });

  document.querySelectorAll('[data-finance-panel]').forEach((panel) => {
    const isActive = panel.getAttribute('data-finance-panel') === tab;
    panel.classList.toggle('hidden', !isActive);
    panel.classList.toggle('is-active', isActive);
  });
}

function renderOverviewSkeleton() {
  ['#kpiNetProfit', '#kpiCompanyShare', '#kpiCrewShare', '#kpiLossValue', '#kpiCompletedVoyages', '#kpiUnsettled'].forEach((selector) => {
    const el = $(selector);
    if (el) el.innerHTML = '<span class="finance-value-skeleton"></span>';
  });

  ['#chartNetProfit', '#chartCompanyCrew', '#chartAvgProfit', '#analyticsChartNetProfit', '#analyticsChartCompanyCrew', '#analyticsChartLossTrend', '#analyticsChartAvgProfit'].forEach((selector) => {
    const el = $(selector);
    if (el) el.innerHTML = '<div class="finance-chart-skeleton"></div>';
  });

  const unsettledTotal = $('#unsettledOutstandingTotal');
  if (unsettledTotal) unsettledTotal.innerHTML = '<span class="finance-value-skeleton"></span>';

  const top = $('#unsettledTopList');
  if (top) {
    top.innerHTML =
      '<li class="finance-unsettled-item"><span class="finance-line-skeleton"></span></li>' +
      '<li class="finance-unsettled-item"><span class="finance-line-skeleton"></span></li>' +
      '<li class="finance-unsettled-item"><span class="finance-line-skeleton"></span></li>';
  }
}

function renderOverview(payload) {
  const k = payload?.kpis || {};
  const c = payload?.charts || {};

  const setMoney = (id, value) => {
    const el = $(id);
    if (el) el.textContent = formatGuilders(value);
  };

  setMoney('#kpiNetProfit', k.netProfit);
  setMoney('#kpiCompanyShare', k.companyShareEarnings);
  setMoney('#kpiCrewShare', k.crewShare);
  setMoney('#kpiLossValue', k.freightLossesValue);
  setMoney('#kpiUnsettled', k.unsettledCompanyShareOutstanding);

  const completed = $('#kpiCompletedVoyages');
  if (completed) completed.textContent = String(Number(k.completedVoyages || 0));

  renderSimpleLineChart($('#chartNetProfit'), c.netProfitTrend || [], 'line-primary');
  renderStackedShareChart($('#chartCompanyCrew'), c.companyVsCrew || []);
  renderSimpleLineChart($('#chartAvgProfit'), c.avgNetProfitTrend || [], 'line-muted', { height: 100 });

  renderSimpleLineChart($('#analyticsChartNetProfit'), c.netProfitTrend || [], 'line-primary');
  renderStackedShareChart($('#analyticsChartCompanyCrew'), c.companyVsCrew || []);
  renderSimpleLineChart($('#analyticsChartLossTrend'), c.freightLossValueTrend || [], 'line-accent');
  renderSimpleLineChart($('#analyticsChartAvgProfit'), c.avgNetProfitTrend || [], 'line-muted');

  const avgSeries = Array.isArray(c.avgNetProfitTrend) ? c.avgNetProfitTrend : [];
  const avgValue = avgSeries.length ? toMoney(avgSeries[avgSeries.length - 1].value) : 0;
  const avgMini = $('#avgMiniValue');
  if (avgMini) avgMini.textContent = formatGuilders(avgValue);

  const unsettled = payload?.unsettled || {};
  const unsettledTotal = $('#unsettledOutstandingTotal');
  if (unsettledTotal) unsettledTotal.textContent = `Total outstanding: ${formatGuilders(unsettled.totalOutstanding || 0)}`;

  const top = $('#unsettledTopList');
  const rows = Array.isArray(unsettled.topDebtors) ? unsettled.topDebtors : [];
  if (top) {
    if (!rows.length) {
      top.innerHTML = '<li class="finance-unsettled-item"><span class="muted">No outstanding company share</span></li>';
    } else {
      top.innerHTML = rows
        .slice(0, 5)
        .map((row) => `<li class="finance-unsettled-item"><span class="finance-unsettled-name">${text(row.officerName)}${
          row.officerSerial ? ` (${text(row.officerSerial)})` : ''
        }</span><strong class="finance-unsettled-amount">${formatGuilders(row.outstanding)}</strong></li>`)
        .join('');
    }
  }
}

function renderDebtsSkeleton() {
  const groups = $('#financeDebtsGroups');
  if (!groups) return;
  groups.innerHTML =
    '<article class="finance-debt-group"><span class="finance-line-skeleton"></span></article>' +
    '<article class="finance-debt-group"><span class="finance-line-skeleton"></span></article>';
}

function renderDebtGroups(groupsForPage, canSettle, onSettle) {
  const groups = $('#financeDebtsGroups');
  if (!groups) return;
  if (!groupsForPage.length) {
    groups.innerHTML = '<article class="finance-debt-group"><p class="muted">No unsettled debts found.</p></article>';
    return;
  }

  groups.innerHTML = groupsForPage
    .map(
      (group) => `<details class="finance-debt-group">
        <summary><span>${text(group.officerName)}${group.officerSerial ? ` (${text(group.officerSerial)})` : ''}</span><strong>${formatGuilders(
          group.outstandingTotal
        )}</strong></summary>
        <div class="table-wrap">
          <table class="data-table finance-data-table">
            <thead>
              <tr>
                <th>Vessel</th>
                <th>Route</th>
                <th>Ended</th>
                <th class="align-right">Company Share (10%)</th>
                <th>Status</th>
                ${canSettle ? '<th>Action</th>' : ''}
              </tr>
            </thead>
            <tbody>
              ${(Array.isArray(group.voyages) ? group.voyages : [])
                .map(
                  (voyage) => `<tr>
                    <td>${text(voyage.vesselName)} | ${text(voyage.vesselCallsign)}</td>
                    <td>${text(voyage.departurePort)} \u2192 ${text(voyage.destinationPort)}</td>
                    <td>${formatWhen(voyage.endedAt)}</td>
                    <td class="align-right">${formatGuilders(voyage.companyShareAmount)}</td>
                    <td>${text(voyage.companyShareStatus)}</td>
                    ${
                      canSettle
                        ? `<td><button type="button" class="btn btn-primary" data-settle-voyage="${Number(voyage.voyageId || 0)}">Settle</button></td>`
                        : ''
                    }
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </details>`
    )
    .join('');

  if (!canSettle) return;
  groups.querySelectorAll('[data-settle-voyage]').forEach((button) => {
    button.addEventListener('click', async () => {
      const voyageId = Number(button.getAttribute('data-settle-voyage'));
      if (!Number.isInteger(voyageId) || voyageId <= 0) return;
      button.disabled = true;
      try {
        await onSettle(voyageId);
      } finally {
        button.disabled = false;
      }
    });
  });
}

function renderAuditSkeleton() {
  const tbody = $('#financeAuditBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="7"><div class="finance-chart-skeleton"></div></td></tr>';
}

async function init() {
  document.documentElement.classList.add('intranet-no-scroll');
  document.body.classList.add('intranet-no-scroll');

  const state = {
    session: null,
    range: 'week',
    activeTab: 'overview',
    overviewData: null,
    overviewLoading: false,
    debtsLoading: false,
    debtsError: null,
    debtsLoaded: false,
    debtGroups: [],
    debtPage: 1,
    debtTotalPages: 1,
    debtPageSize: 3,
    canSettleDebts: false,
    auditLoading: false,
    auditLoaded: false,
    auditPage: 1,
    auditTotalPages: 1,
    auditPageSize: 10
  };

  const loadSession = async () => {
    try {
      const session = await fetchJson('/api/auth/session');
      if (!session?.loggedIn) {
        window.location.href = '/login?auth=denied&reason=login_required';
        return null;
      }
      state.session = session;
      renderNavbar(session);
      return session;
    } catch (error) {
      console.error('finances session error', error);
      window.location.href = '/login?auth=denied&reason=login_required';
      return null;
    }
  };

  const renderDebtPage = () => {
    state.debtTotalPages = Math.max(1, Math.ceil(state.debtGroups.length / state.debtPageSize));
    state.debtPage = Math.max(1, Math.min(state.debtPage, state.debtTotalPages));

    const pageInfo = $('#financeDebtsPageInfo');
    const prev = $('#financeDebtsPrev');
    const next = $('#financeDebtsNext');
    if (pageInfo) pageInfo.textContent = `Page ${state.debtPage} of ${state.debtTotalPages}`;
    if (prev) prev.disabled = state.debtPage <= 1;
    if (next) next.disabled = state.debtPage >= state.debtTotalPages;

    const start = (state.debtPage - 1) * state.debtPageSize;
    const groupsForPage = state.debtGroups.slice(start, start + state.debtPageSize);
    renderDebtGroups(groupsForPage, state.canSettleDebts, async (voyageId) => {
      try {
        await fetchJson(`/api/finances/debts/${encodeURIComponent(String(voyageId))}/settle`, { method: 'POST' });
        await loadDebts();
      } catch (error) {
        console.error('finances settle error', error);
        setFeedback(error.message || 'Failed to settle debt.', 'error');
      }
    });
  };

  const loadOverview = async () => {
    state.overviewLoading = true;
    renderOverviewSkeleton();
    try {
      console.log('fetch finances', state.range);
      const data = await fetchJson(`/api/finances/overview?range=${encodeURIComponent(state.range)}&unsettledScope=all`);
      console.log('response', data);
      state.overviewData = data || {};
      renderOverview(state.overviewData);
      clearFeedback();
    } catch (err) {
      console.error('finances fetch error', err);
      setFeedback(`Failed to load finance data: ${err.message || 'Unknown error'}`, 'error', loadOverview);
    } finally {
      state.overviewLoading = false;
    }
  };

  const loadDebts = async () => {
    state.debtsLoading = true;
    renderDebtsSkeleton();
    try {
      const search = $('#debtSearch')?.value || '';
      const min = $('#debtMinOutstanding')?.value || '';
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (String(min).trim() !== '') params.set('minOutstanding', String(min));
      const data = await fetchJson(`/api/finances/debts${params.toString() ? `?${params.toString()}` : ''}`);
      console.log('response', data);
      state.debtGroups = Array.isArray(data?.groups) ? data.groups : [];
      state.canSettleDebts = Boolean(data?.permissions?.canSettle);
      const totals = $('#debtTotals');
      if (totals) {
        totals.textContent = `Outstanding: ${formatGuilders(data?.totals?.unsettledOutstanding || 0)} | Voyages: ${
          Number(data?.totals?.unsettledVoyages || 0)
        }`;
      }
      state.debtsLoaded = true;
      renderDebtPage();
      clearFeedback();
    } catch (err) {
      console.error('finances fetch error', err);
      setFeedback(`Failed to load finance debts: ${err.message || 'Unknown error'}`, 'error', loadDebts);
      const groups = $('#financeDebtsGroups');
      if (groups) groups.innerHTML = '<article class="finance-debt-group"><p class="muted">Unable to load data</p></article>';
    } finally {
      state.debtsLoading = false;
    }
  };

  const loadAudit = async () => {
    state.auditLoading = true;
    renderAuditSkeleton();
    try {
      const data = await fetchJson(
        `/api/finances/audit?page=${encodeURIComponent(String(state.auditPage))}&pageSize=${encodeURIComponent(String(state.auditPageSize))}`
      );
      console.log('response', data);
      const rows = Array.isArray(data?.rows) ? data.rows : [];
      const pagination = data?.pagination || {};
      state.auditTotalPages = Math.max(1, Number(pagination.totalPages || 1));
      state.auditPage = Math.max(1, Math.min(state.auditPage, state.auditTotalPages));

      const pageInfo = $('#financeAuditPageInfo');
      const prev = $('#financeAuditPrev');
      const next = $('#financeAuditNext');
      if (pageInfo) pageInfo.textContent = `Page ${state.auditPage} of ${state.auditTotalPages}`;
      if (prev) prev.disabled = state.auditPage <= 1;
      if (next) next.disabled = state.auditPage >= state.auditTotalPages;

      const tbody = $('#financeAuditBody');
      if (tbody) {
        if (!rows.length) {
          tbody.innerHTML = '<tr><td colspan="7">No audit entries found.</td></tr>';
        } else {
          tbody.innerHTML = rows
            .map(
              (row) => `<tr>
                <td>${formatWhen(row.createdAt)}</td>
                <td>${text(row.action)}</td>
                <td>${text(row.settledByName)}${row.settledByDiscordId ? ` (${text(row.settledByDiscordId)})` : ''}</td>
                <td>${text(row.vesselName)} | ${text(row.vesselCallsign)}</td>
                <td>${text(row.departurePort)} \u2192 ${text(row.destinationPort)}</td>
                <td class="align-right">${formatGuilders(row.amount)}</td>
                <td>${text(row.oowName)}${row.oowSerial ? ` (${text(row.oowSerial)})` : ''}</td>
              </tr>`
            )
            .join('');
        }
      }
      state.auditLoaded = true;
      clearFeedback();
    } catch (err) {
      console.error('finances fetch error', err);
      setFeedback(`Failed to load finance audit: ${err.message || 'Unknown error'}`, 'error', loadAudit);
      const tbody = $('#financeAuditBody');
      if (tbody) tbody.innerHTML = '<tr><td colspan="7">Unable to load data</td></tr>';
    } finally {
      state.auditLoading = false;
    }
  };

  const switchTab = async (tab) => {
    state.activeTab = tab;
    setActiveTab(tab);
    setDebug(state.range, state.activeTab);

    if (tab === 'overview' && !state.overviewData && !state.overviewLoading) await loadOverview();
    if (tab === 'analytics' && !state.overviewData && !state.overviewLoading) await loadOverview();
    if (tab === 'debts' && !state.debtsLoaded && !state.debtsLoading) await loadDebts();
    if (tab === 'audit' && !state.auditLoaded && !state.auditLoading) await loadAudit();
  };

  const setRange = async (range) => {
    state.range = range;
    document.querySelectorAll('[data-finance-range]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-finance-range') === range);
    });
    setDebug(state.range, state.activeTab);
    await loadOverview();
  };

  document.querySelectorAll('[data-finance-tab]').forEach((button) => {
    button.addEventListener('click', async () => {
      const tab = button.getAttribute('data-finance-tab') || 'overview';
      await switchTab(tab);
    });
  });

  document.querySelectorAll('[data-finance-open-tab]').forEach((link) => {
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      const tab = link.getAttribute('data-finance-open-tab') || 'debts';
      await switchTab(tab);
    });
  });

  document.querySelectorAll('[data-finance-range]').forEach((button) => {
    button.addEventListener('click', async () => {
      const range = button.getAttribute('data-finance-range') || 'week';
      await setRange(range);
    });
  });

  const scopeSelect = $('#unsettledScopeSelect');
  if (scopeSelect) {
    scopeSelect.addEventListener('change', async () => {
      await loadOverview();
    });
  }

  const debtPrev = $('#financeDebtsPrev');
  const debtNext = $('#financeDebtsNext');
  if (debtPrev) {
    debtPrev.addEventListener('click', () => {
      if (state.debtPage <= 1) return;
      state.debtPage -= 1;
      renderDebtPage();
    });
  }
  if (debtNext) {
    debtNext.addEventListener('click', () => {
      if (state.debtPage >= state.debtTotalPages) return;
      state.debtPage += 1;
      renderDebtPage();
    });
  }

  let debtDebounce = null;
  const scheduleDebtReload = () => {
    state.debtPage = 1;
    if (debtDebounce) window.clearTimeout(debtDebounce);
    debtDebounce = window.setTimeout(() => {
      loadDebts();
    }, 280);
  };
  const debtSearch = $('#debtSearch');
  const debtMin = $('#debtMinOutstanding');
  if (debtSearch) debtSearch.addEventListener('input', scheduleDebtReload);
  if (debtMin) debtMin.addEventListener('input', scheduleDebtReload);

  const auditPrev = $('#financeAuditPrev');
  const auditNext = $('#financeAuditNext');
  if (auditPrev) {
    auditPrev.addEventListener('click', async () => {
      if (state.auditPage <= 1) return;
      state.auditPage -= 1;
      await loadAudit();
    });
  }
  if (auditNext) {
    auditNext.addEventListener('click', async () => {
      if (state.auditPage >= state.auditTotalPages) return;
      state.auditPage += 1;
      await loadAudit();
    });
  }

  const session = await loadSession();
  if (!session) return;

  const hasFinance = hasPermission(session, 'finances.view');
  if (!hasFinance) {
    setFeedback('Failed to load finance data: missing finances.view permission', 'error');
    return;
  }

  if (!hasPermission(session, 'finances.audit.view')) {
    const auditTab = document.querySelector('[data-finance-tab="audit"]');
    if (auditTab) auditTab.classList.add('hidden');
  }

  setActiveTab(state.activeTab);
  setDebug(state.range, state.activeTab);
  await loadOverview();
}

init().catch((err) => {
  console.error('finances init error', err);
  setFeedback(`Failed to load finance data: ${err.message || 'Unknown error'}`, 'error');
});
