import { getFinancesOverview, listFinanceAudit, listFinanceDebts, settleFinanceDebt } from './admin-api.js';
import { clearMessage, showMessage } from './notice.js';

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

function renderKpiValue(element, value, asUnits = false) {
  if (!element) return;
  element.textContent = asUnits ? `${toMoney(value)}` : formatGuilders(value);
}

function renderChartSkeleton(selector) {
  if (!selector) return;
  const el = document.querySelector(selector);
  if (!el) return;
  el.innerHTML = '<div class="finance-chart-skeleton"></div>';
}

function renderSimpleLineChart(target, series, colorClass = 'line-primary', options = {}) {
  if (!target) return;
  const safeSeries = Array.isArray(series) ? series : [];
  if (!safeSeries.length) {
    target.innerHTML = '<p class="muted">No data available for this range.</p>';
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
    target.innerHTML = '<p class="muted">No data available for this range.</p>';
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

function renderTopDebtors(target, rows) {
  if (!target) return;
  const safeRows = Array.isArray(rows) ? rows : [];
  if (!safeRows.length) {
    target.innerHTML = '<li class="finance-unsettled-item"><span class="muted">No outstanding company share</span></li>';
    return;
  }

  target.innerHTML = safeRows
    .slice(0, 5)
    .map(
      (row) => `<li class="finance-unsettled-item">
        <span class="finance-unsettled-name">${text(row.officerName)}${row.officerSerial ? ` (${text(row.officerSerial)})` : ''}</span>
        <strong class="finance-unsettled-amount">${formatGuilders(row.outstanding)}</strong>
      </li>`
    )
    .join('');
}

function renderUnsettledTotal(target, amount) {
  if (!target) return;
  target.textContent = `Total outstanding: ${formatGuilders(amount)}`;
}

function showRetryMessage(feedback, message, onRetry) {
  if (!feedback) return;
  feedback.className = 'feedback is-visible is-error';
  feedback.innerHTML = '';
  const copy = document.createElement('span');
  copy.textContent = message;
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn btn-secondary';
  retry.textContent = 'Retry';
  retry.style.marginLeft = '0.6rem';
  retry.addEventListener('click', async () => {
    await onRetry();
  });
  feedback.append(copy, retry);
}

function renderOverviewSkeleton(config) {
  [
    config.netProfitSelector,
    config.companyShareSelector,
    config.crewShareSelector,
    config.lossesSelector,
    config.unsettledSelector,
    config.completedSelector
  ].forEach((selector) => {
    if (!selector) return;
    const el = document.querySelector(selector);
    if (el) el.innerHTML = '<span class="finance-value-skeleton"></span>';
  });

  [config.netProfitChartSelector, config.shareChartSelector, config.avgChartSelector].forEach((selector) => {
    renderChartSkeleton(selector);
  });

  const unsettledTotal = document.querySelector(config.unsettledTotalSelector);
  if (unsettledTotal) unsettledTotal.innerHTML = '<span class="finance-value-skeleton"></span>';

  const topDebtors = document.querySelector(config.topDebtorsSelector);
  if (topDebtors) {
    topDebtors.innerHTML =
      '<li class="finance-unsettled-item"><span class="finance-line-skeleton"></span></li>' +
      '<li class="finance-unsettled-item"><span class="finance-line-skeleton"></span></li>' +
      '<li class="finance-unsettled-item"><span class="finance-line-skeleton"></span></li>';
  }
}

function setupRangeButtons(rangeButtons, onSelect) {
  rangeButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const range = String(button.getAttribute('data-finance-range') || 'month');
      rangeButtons.forEach((btn) => btn.classList.toggle('is-active', btn === button));
      await onSelect(range);
    });
  });
}

export async function initFinancesOverview(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const rangeButtons = [...document.querySelectorAll(config.rangeButtonsSelector)];
  const unsettledScope = document.querySelector(config.unsettledScopeSelector);
  const topDebtors = document.querySelector(config.topDebtorsSelector);
  if (!feedback || !rangeButtons.length || !unsettledScope || !topDebtors) {
    console.error('[finances] Missing required overview elements.');
    return;
  }

  let activeRange = 'month';

  const refresh = async () => {
    renderOverviewSkeleton(config);
    try {
      const payload = await getFinancesOverview(activeRange, unsettledScope.value || 'all');
      const kpis = payload.kpis || {};
      const charts = payload.charts || {};

      renderKpiValue(document.querySelector(config.netProfitSelector), kpis.netProfit);
      renderKpiValue(document.querySelector(config.companyShareSelector), kpis.companyShareEarnings);
      renderKpiValue(document.querySelector(config.crewShareSelector), kpis.crewShare);
      renderKpiValue(document.querySelector(config.lossesSelector), kpis.freightLossesValue);
      renderKpiValue(document.querySelector(config.unsettledSelector), kpis.unsettledCompanyShareOutstanding);

      const completedEl = document.querySelector(config.completedSelector);
      if (completedEl) completedEl.textContent = String(Number(kpis.completedVoyages || 0));

      renderSimpleLineChart(document.querySelector(config.netProfitChartSelector), charts.netProfitTrend || [], 'line-primary');
      renderStackedShareChart(document.querySelector(config.shareChartSelector), charts.companyVsCrew || []);
      renderSimpleLineChart(document.querySelector(config.avgChartSelector), charts.avgNetProfitTrend || [], 'line-muted', { height: 110 });

      const avgSeries = Array.isArray(charts.avgNetProfitTrend) ? charts.avgNetProfitTrend : [];
      const latestAvg = avgSeries.length ? toMoney(avgSeries[avgSeries.length - 1].value) : 0;
      const miniMetric = document.querySelector(config.miniMetricValueSelector);
      if (miniMetric) miniMetric.textContent = formatGuilders(latestAvg);

      renderUnsettledTotal(document.querySelector(config.unsettledTotalSelector), payload?.unsettled?.totalOutstanding || 0);
      renderTopDebtors(topDebtors, payload?.unsettled?.topDebtors || []);
      clearMessage(feedback);
    } catch (error) {
      console.error('[finances] Failed to load overview', error);
      renderSimpleLineChart(document.querySelector(config.netProfitChartSelector), []);
      renderStackedShareChart(document.querySelector(config.shareChartSelector), []);
      renderSimpleLineChart(document.querySelector(config.avgChartSelector), []);

      const miniMetric = document.querySelector(config.miniMetricValueSelector);
      if (miniMetric) miniMetric.textContent = formatGuilders(0);

      renderUnsettledTotal(document.querySelector(config.unsettledTotalSelector), 0);
      renderTopDebtors(topDebtors, []);
      showMessage(feedback, error.message || 'Unable to load finance overview.', 'error');
    }
  };

  setupRangeButtons(rangeButtons, async (nextRange) => {
    activeRange = nextRange;
    await refresh();
  });

  unsettledScope.addEventListener('change', refresh);
  await refresh();
}

export async function initFinancesAnalytics(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const rangeButtons = [...document.querySelectorAll(config.rangeButtonsSelector)];
  if (!feedback || !rangeButtons.length) {
    console.error('[finances] Missing required analytics elements.');
    return;
  }

  let activeRange = 'month';

  const refresh = async () => {
    [config.netProfitChartSelector, config.shareChartSelector, config.lossesChartSelector, config.avgChartSelector].forEach((selector) => {
      renderChartSkeleton(selector);
    });

    try {
      const payload = await getFinancesOverview(activeRange, 'range');
      const charts = payload.charts || {};

      renderSimpleLineChart(document.querySelector(config.netProfitChartSelector), charts.netProfitTrend || [], 'line-primary');
      renderStackedShareChart(document.querySelector(config.shareChartSelector), charts.companyVsCrew || []);
      renderSimpleLineChart(document.querySelector(config.lossesChartSelector), charts.freightLossValueTrend || [], 'line-accent');
      renderSimpleLineChart(document.querySelector(config.avgChartSelector), charts.avgNetProfitTrend || [], 'line-muted');
      clearMessage(feedback);
    } catch (error) {
      console.error('[finances] Failed to load analytics', error);
      renderSimpleLineChart(document.querySelector(config.netProfitChartSelector), []);
      renderStackedShareChart(document.querySelector(config.shareChartSelector), []);
      renderSimpleLineChart(document.querySelector(config.lossesChartSelector), []);
      renderSimpleLineChart(document.querySelector(config.avgChartSelector), []);
      showMessage(feedback, error.message || 'Unable to load finance analytics.', 'error');
    }
  };

  setupRangeButtons(rangeButtons, async (nextRange) => {
    activeRange = nextRange;
    await refresh();
  });

  await refresh();
}

function flattenDebtRows(groups) {
  const safeGroups = Array.isArray(groups) ? groups : [];
  return safeGroups
    .flatMap((group) => {
      const voyages = Array.isArray(group.voyages) ? group.voyages : [];
      return voyages.map((voyage) => ({
        officerName: group.officerName,
        officerSerial: group.officerSerial,
        outstandingTotal: toMoney(group.outstandingTotal || 0),
        voyageId: Number(voyage.voyageId || 0),
        vesselName: voyage.vesselName,
        vesselCallsign: voyage.vesselCallsign,
        departurePort: voyage.departurePort,
        destinationPort: voyage.destinationPort,
        endedAt: voyage.endedAt,
        companyShareAmount: toMoney(voyage.companyShareAmount || 0),
        companyShareStatus: voyage.companyShareStatus
      }));
    })
    .sort((a, b) => b.companyShareAmount - a.companyShareAmount || (b.endedAt || '').localeCompare(a.endedAt || ''));
}

export async function initFinancesDebts(config, session) {
  const feedback = document.querySelector(config.feedbackSelector);
  const tableBody = document.querySelector(config.tableBodySelector);
  const searchInput = document.querySelector(config.searchSelector);
  const minOutstandingInput = document.querySelector(config.minOutstandingSelector);
  const totalsText = document.querySelector(config.totalsSelector);
  const pageInfo = document.querySelector(config.pageInfoSelector);
  const prevButton = document.querySelector(config.prevButtonSelector);
  const nextButton = document.querySelector(config.nextButtonSelector);
  if (!feedback || !tableBody || !searchInput || !minOutstandingInput || !totalsText || !pageInfo || !prevButton || !nextButton) {
    console.error('[finances] Missing required debts elements.');
    return;
  }

  const pageSize = Math.max(1, Number(config.pageSize || 6));
  let debounceTimer = null;
  let currentPage = 1;
  let totalPages = 1;
  let debtRows = [];
  let canSettle = Boolean(session?.permissions?.includes?.('finances.debts.settle') || session?.permissions?.includes?.('admin.override'));

  const renderPage = () => {
    totalPages = Math.max(1, Math.ceil(debtRows.length / pageSize));
    currentPage = Math.max(1, Math.min(currentPage, totalPages));
    pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
    prevButton.disabled = currentPage <= 1;
    nextButton.disabled = currentPage >= totalPages;

    if (!debtRows.length) {
      tableBody.innerHTML = '<tr><td colspan="7">No unsettled debts found.</td></tr>';
      return;
    }

    const start = (currentPage - 1) * pageSize;
    const pageRows = debtRows.slice(start, start + pageSize);
    tableBody.innerHTML = pageRows
      .map(
        (row) => `<tr>
          <td>${text(row.officerName)}${row.officerSerial ? ` (${text(row.officerSerial)})` : ''}</td>
          <td>${text(row.vesselName)} | ${text(row.vesselCallsign)}</td>
          <td>${text(row.departurePort)} \u2192 ${text(row.destinationPort)}</td>
          <td>${formatWhen(row.endedAt)}</td>
          <td class="align-right">${formatGuilders(row.companyShareAmount)}</td>
          <td>${text(row.companyShareStatus)}</td>
          <td>${
            canSettle
              ? `<button class="btn btn-primary" type="button" data-settle-voyage="${row.voyageId}">Settle</button>`
              : '<span class="muted">—</span>'
          }</td>
        </tr>`
      )
      .join('');

    if (canSettle) {
      tableBody.querySelectorAll('[data-settle-voyage]').forEach((button) => {
        button.addEventListener('click', async () => {
          const voyageId = Number(button.getAttribute('data-settle-voyage'));
          if (!Number.isInteger(voyageId) || voyageId <= 0) return;
          button.disabled = true;
          try {
            await settleFinanceDebt(voyageId);
            await refresh();
            clearMessage(feedback);
          } catch (error) {
            showMessage(feedback, error.message || 'Unable to settle debt.', 'error');
          } finally {
            button.disabled = false;
          }
        });
      });
    }
  };

  const refresh = async () => {
    tableBody.innerHTML = '<tr><td colspan="7"><div class="finance-chart-skeleton"></div></td></tr>';
    try {
      const payload = await listFinanceDebts({
        search: searchInput.value,
        minOutstanding: minOutstandingInput.value
      });

      debtRows = flattenDebtRows(payload.groups || []);
      canSettle = Boolean(payload?.permissions?.canSettle);
      totalsText.textContent = `Outstanding: ${formatGuilders(payload?.totals?.unsettledOutstanding || 0)} | Voyages: ${
        Number(payload?.totals?.unsettledVoyages || 0)
      }`;

      renderPage();
      clearMessage(feedback);
    } catch (error) {
      console.error('[finances] Failed to load debts', error);
      tableBody.innerHTML = '<tr><td colspan="7">Unable to load data</td></tr>';
      totalsText.textContent = 'Outstanding: ƒ 0';
      pageInfo.textContent = 'Page 1 of 1';
      prevButton.disabled = true;
      nextButton.disabled = true;
      showMessage(feedback, error.message || 'Unable to load debts.', 'error');
    }
  };

  prevButton.addEventListener('click', () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    renderPage();
  });

  nextButton.addEventListener('click', () => {
    if (currentPage >= totalPages) return;
    currentPage += 1;
    renderPage();
  });

  const scheduleRefresh = () => {
    currentPage = 1;
    if (debounceTimer) window.clearTimeout(debounceTimer);
    debounceTimer = window.setTimeout(() => refresh(), 280);
  };

  searchInput.addEventListener('input', scheduleRefresh);
  minOutstandingInput.addEventListener('input', scheduleRefresh);

  await refresh();
}

export async function initFinancesAudit(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const tableBody = document.querySelector(config.tableBodySelector);
  const pageInfo = document.querySelector(config.pageInfoSelector);
  const prevButton = document.querySelector(config.prevButtonSelector);
  const nextButton = document.querySelector(config.nextButtonSelector);
  if (!feedback || !tableBody || !pageInfo || !prevButton || !nextButton) {
    console.error('[finances] Missing required audit elements.');
    return;
  }

  const pageSize = Math.max(1, Number(config.pageSize || 10));
  let currentPage = 1;
  let totalPages = 1;

  const refresh = async () => {
    tableBody.innerHTML = '<tr><td colspan="7"><div class="finance-chart-skeleton"></div></td></tr>';
    try {
      const payload = await listFinanceAudit({ page: currentPage, pageSize });
      const rows = payload.rows || [];
      const pagination = payload.pagination || {};
      totalPages = Math.max(1, Number(pagination.totalPages || 1));
      currentPage = Math.min(currentPage, totalPages);
      pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
      prevButton.disabled = currentPage <= 1;
      nextButton.disabled = currentPage >= totalPages;

      if (!rows.length) {
        tableBody.innerHTML = '<tr><td colspan="7">No audit entries found.</td></tr>';
      } else {
        tableBody.innerHTML = rows
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

      clearMessage(feedback);
    } catch (error) {
      console.error('[finances] Failed to load audit', error);
      showMessage(feedback, error.message || 'Unable to load finance audit.', 'error');
      tableBody.innerHTML = '<tr><td colspan="7">Unable to load data</td></tr>';
    }
  };

  prevButton.addEventListener('click', async () => {
    if (currentPage <= 1) return;
    currentPage -= 1;
    await refresh();
  });

  nextButton.addEventListener('click', async () => {
    if (currentPage >= totalPages) return;
    currentPage += 1;
    await refresh();
  });

  await refresh();
}

function renderDebtGroupsSkeleton(root) {
  if (!root) return;
  root.innerHTML =
    '<article class="finance-debt-group"><span class="finance-line-skeleton"></span></article>' +
    '<article class="finance-debt-group"><span class="finance-line-skeleton"></span></article>' +
    '<article class="finance-debt-group"><span class="finance-line-skeleton"></span></article>';
}

function renderDebtGroups(root, groups, canSettle, onSettle) {
  if (!root) return;
  const safeGroups = Array.isArray(groups) ? groups : [];
  if (!safeGroups.length) {
    root.innerHTML = '<article class="finance-debt-group"><p class="muted">No unsettled debts found.</p></article>';
    return;
  }

  root.innerHTML = safeGroups
    .map(
      (group) => `<details class="finance-debt-group">
        <summary>
          <span>${text(group.officerName)}${group.officerSerial ? ` (${text(group.officerSerial)})` : ''}</span>
          <strong>${formatGuilders(group.outstandingTotal)}</strong>
        </summary>
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
                    ${canSettle ? `<td><button class="btn btn-primary" type="button" data-settle-voyage="${Number(voyage.voyageId || 0)}">Settle</button></td>` : ''}
                  </tr>`
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </details>`
    )
    .join('');

  if (!canSettle || typeof onSettle !== 'function') return;
  root.querySelectorAll('[data-settle-voyage]').forEach((button) => {
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

export async function initFinancesConsole(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const rangeButtons = [...document.querySelectorAll(config.rangeButtonsSelector)];
  const tabButtons = [...document.querySelectorAll(config.tabButtonsSelector)];
  const panels = [...document.querySelectorAll(config.panelSelector)];
  const openTabLinks = [...document.querySelectorAll(config.openTabLinkSelector)];
  const unsettledScope = document.querySelector(config.unsettledScopeSelector);
  const topDebtors = document.querySelector(config.topDebtorsSelector);
  const debtGroupsRoot = document.querySelector(config.debtGroupsSelector);
  const debtSearch = document.querySelector(config.debtSearchSelector);
  const debtMinOutstanding = document.querySelector(config.debtMinOutstandingSelector);
  const debtTotals = document.querySelector(config.debtTotalsSelector);
  const debtPrev = document.querySelector(config.debtPrevSelector);
  const debtNext = document.querySelector(config.debtNextSelector);
  const debtPageInfo = document.querySelector(config.debtPageInfoSelector);
  const auditBody = document.querySelector(config.auditTableBodySelector);
  const auditPrev = document.querySelector(config.auditPrevSelector);
  const auditNext = document.querySelector(config.auditNextSelector);
  const auditPageInfo = document.querySelector(config.auditPageInfoSelector);

  if (!feedback || !rangeButtons.length || !tabButtons.length || !panels.length || !unsettledScope || !topDebtors) {
    console.error('[finances] Missing required console elements.');
    return;
  }

  let activeRange = 'month';
  let activeTab = 'overview';
  let overviewLoaded = false;
  let analyticsLoaded = false;
  let debtsLoaded = false;
  let auditLoaded = false;
  let debtsDebounce = null;
  let debtGroups = [];
  let debtPage = 1;
  let debtTotalPages = 1;
  let canSettleDebts = Boolean(config?.session?.permissions?.includes?.('finances.debts.settle') || config?.session?.permissions?.includes?.('admin.override'));
  const debtPageSize = 3;
  let auditPage = 1;
  let auditTotalPages = 1;
  const auditPageSize = 10;

  const setTab = (tabName) => {
    activeTab = String(tabName || 'overview');
    tabButtons.forEach((button) => {
      const isActive = button.getAttribute('data-finance-tab') === activeTab;
      button.classList.toggle('is-active', isActive);
      if (isActive) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    panels.forEach((panel) => {
      panel.classList.toggle('hidden', panel.getAttribute('data-finance-panel') !== activeTab);
      panel.classList.toggle('is-active', panel.getAttribute('data-finance-panel') === activeTab);
    });
  };

  const renderOverviewFromPayload = (payload) => {
    const kpis = payload?.kpis || {};
    const charts = payload?.charts || {};
    renderKpiValue(document.querySelector(config.netProfitSelector), kpis.netProfit);
    renderKpiValue(document.querySelector(config.companyShareSelector), kpis.companyShareEarnings);
    renderKpiValue(document.querySelector(config.crewShareSelector), kpis.crewShare);
    renderKpiValue(document.querySelector(config.lossesSelector), kpis.freightLossesValue);
    renderKpiValue(document.querySelector(config.unsettledSelector), kpis.unsettledCompanyShareOutstanding);

    const completedEl = document.querySelector(config.completedSelector);
    if (completedEl) completedEl.textContent = String(Number(kpis.completedVoyages || 0));

    renderSimpleLineChart(document.querySelector(config.netProfitChartSelector), charts.netProfitTrend || [], 'line-primary');
    renderStackedShareChart(document.querySelector(config.shareChartSelector), charts.companyVsCrew || []);
    renderSimpleLineChart(document.querySelector(config.avgChartSelector), charts.avgNetProfitTrend || [], 'line-muted', { height: 100 });

    const avgSeries = Array.isArray(charts.avgNetProfitTrend) ? charts.avgNetProfitTrend : [];
    const latestAvg = avgSeries.length ? toMoney(avgSeries[avgSeries.length - 1].value) : 0;
    const miniMetric = document.querySelector(config.miniMetricValueSelector);
    if (miniMetric) miniMetric.textContent = formatGuilders(latestAvg);

    renderUnsettledTotal(document.querySelector(config.unsettledTotalSelector), payload?.unsettled?.totalOutstanding || 0);
    renderTopDebtors(topDebtors, payload?.unsettled?.topDebtors || []);
  };

  const renderAnalyticsFromPayload = (payload) => {
    const charts = payload?.charts || {};
    renderSimpleLineChart(document.querySelector(config.analyticsNetProfitChartSelector), charts.netProfitTrend || [], 'line-primary');
    renderStackedShareChart(document.querySelector(config.analyticsShareChartSelector), charts.companyVsCrew || []);
    renderSimpleLineChart(document.querySelector(config.analyticsLossesChartSelector), charts.freightLossValueTrend || [], 'line-accent');
    renderSimpleLineChart(document.querySelector(config.analyticsAvgChartSelector), charts.avgNetProfitTrend || [], 'line-muted');
  };

  const loadOverview = async () => {
    renderOverviewSkeleton(config);
    try {
      const payload = await getFinancesOverview(activeRange, unsettledScope.value || 'all');
      console.log('[finances] range', activeRange);
      console.log('[finances] financeData', payload);
      renderOverviewFromPayload(payload);
      overviewLoaded = true;
      clearMessage(feedback);
    } catch (error) {
      console.error('[finances] Failed to load overview', error);
      showRetryMessage(feedback, error.message || 'Unable to load finance overview.', loadOverview);
    }
  };

  const loadAnalytics = async () => {
    [
      config.analyticsNetProfitChartSelector,
      config.analyticsShareChartSelector,
      config.analyticsLossesChartSelector,
      config.analyticsAvgChartSelector
    ].forEach((selector) => renderChartSkeleton(selector));

    try {
      const payload = await getFinancesOverview(activeRange, 'range');
      console.log('[finances] range', activeRange);
      console.log('[finances] financeData', payload);
      renderAnalyticsFromPayload(payload);
      analyticsLoaded = true;
      clearMessage(feedback);
    } catch (error) {
      console.error('[finances] Failed to load analytics', error);
      showRetryMessage(feedback, error.message || 'Unable to load finance analytics.', loadAnalytics);
    }
  };

  const renderDebtPage = async () => {
    if (!debtGroupsRoot || !debtPageInfo || !debtPrev || !debtNext) return;
    debtTotalPages = Math.max(1, Math.ceil(debtGroups.length / debtPageSize));
    debtPage = Math.max(1, Math.min(debtPage, debtTotalPages));
    const start = (debtPage - 1) * debtPageSize;
    const groupsForPage = debtGroups.slice(start, start + debtPageSize);
    debtPageInfo.textContent = `Page ${debtPage} of ${debtTotalPages}`;
    debtPrev.disabled = debtPage <= 1;
    debtNext.disabled = debtPage >= debtTotalPages;
    renderDebtGroups(debtGroupsRoot, groupsForPage, canSettleDebts, async (voyageId) => {
      try {
        await settleFinanceDebt(voyageId);
        await loadDebts();
      } catch (error) {
        showMessage(feedback, error.message || 'Unable to settle debt.', 'error');
      }
    });
  };

  const loadDebts = async () => {
    if (!debtGroupsRoot || !debtTotals) return;
    renderDebtGroupsSkeleton(debtGroupsRoot);
    try {
      const payload = await listFinanceDebts({
        search: debtSearch?.value || '',
        minOutstanding: debtMinOutstanding?.value || ''
      });
      console.log('[finances] financeData', payload);
      debtGroups = Array.isArray(payload?.groups) ? payload.groups : [];
      canSettleDebts = Boolean(payload?.permissions?.canSettle);
      debtTotals.textContent = `Outstanding: ${formatGuilders(payload?.totals?.unsettledOutstanding || 0)} | Voyages: ${
        Number(payload?.totals?.unsettledVoyages || 0)
      }`;
      await renderDebtPage();
      debtsLoaded = true;
      clearMessage(feedback);
    } catch (error) {
      console.error('[finances] Failed to load debts', error);
      showRetryMessage(feedback, error.message || 'Unable to load finance debts.', loadDebts);
      debtGroupsRoot.innerHTML = '<article class="finance-debt-group"><p class="muted">Unable to load data</p></article>';
      if (debtPageInfo) debtPageInfo.textContent = 'Page 1 of 1';
      if (debtPrev) debtPrev.disabled = true;
      if (debtNext) debtNext.disabled = true;
    }
  };

  const loadAudit = async () => {
    if (!auditBody || !auditPrev || !auditNext || !auditPageInfo) return;
    auditBody.innerHTML = '<tr><td colspan="7"><div class="finance-chart-skeleton"></div></td></tr>';
    try {
      const payload = await listFinanceAudit({ page: auditPage, pageSize: auditPageSize });
      console.log('[finances] financeData', payload);
      const rows = Array.isArray(payload?.rows) ? payload.rows : [];
      const pagination = payload?.pagination || {};
      auditTotalPages = Math.max(1, Number(pagination.totalPages || 1));
      auditPage = Math.max(1, Math.min(auditPage, auditTotalPages));
      auditPageInfo.textContent = `Page ${auditPage} of ${auditTotalPages}`;
      auditPrev.disabled = auditPage <= 1;
      auditNext.disabled = auditPage >= auditTotalPages;

      if (!rows.length) {
        auditBody.innerHTML = '<tr><td colspan="7">No audit entries found.</td></tr>';
      } else {
        auditBody.innerHTML = rows
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
      auditLoaded = true;
      clearMessage(feedback);
    } catch (error) {
      console.error('[finances] Failed to load audit', error);
      showRetryMessage(feedback, error.message || 'Unable to load finance audit.', loadAudit);
      auditBody.innerHTML = '<tr><td colspan="7">Unable to load data</td></tr>';
    }
  };

  setupRangeButtons(rangeButtons, async (range) => {
    activeRange = range;
    if (activeTab === 'overview' || overviewLoaded) await loadOverview();
    if (activeTab === 'analytics' || analyticsLoaded) await loadAnalytics();
  });

  unsettledScope.addEventListener('change', async () => {
    if (activeTab === 'overview' || overviewLoaded) await loadOverview();
  });

  tabButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      const nextTab = button.getAttribute('data-finance-tab') || 'overview';
      setTab(nextTab);
      if (nextTab === 'overview' && !overviewLoaded) await loadOverview();
      if (nextTab === 'analytics' && !analyticsLoaded) await loadAnalytics();
      if (nextTab === 'debts' && !debtsLoaded) await loadDebts();
      if (nextTab === 'audit' && !auditLoaded) await loadAudit();
    });
  });

  openTabLinks.forEach((link) => {
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      const nextTab = link.getAttribute('data-finance-open-tab') || 'overview';
      setTab(nextTab);
      if (nextTab === 'debts' && !debtsLoaded) await loadDebts();
    });
  });

  if (debtSearch && debtMinOutstanding) {
    const scheduleDebtRefresh = () => {
      debtPage = 1;
      if (debtsDebounce) window.clearTimeout(debtsDebounce);
      debtsDebounce = window.setTimeout(() => loadDebts(), 280);
    };
    debtSearch.addEventListener('input', scheduleDebtRefresh);
    debtMinOutstanding.addEventListener('input', scheduleDebtRefresh);
  }

  if (debtPrev && debtNext) {
    debtPrev.addEventListener('click', async () => {
      if (debtPage <= 1) return;
      debtPage -= 1;
      await renderDebtPage();
    });
    debtNext.addEventListener('click', async () => {
      if (debtPage >= debtTotalPages) return;
      debtPage += 1;
      await renderDebtPage();
    });
  }

  if (auditPrev && auditNext) {
    auditPrev.addEventListener('click', async () => {
      if (auditPage <= 1) return;
      auditPage -= 1;
      await loadAudit();
    });
    auditNext.addEventListener('click', async () => {
      if (auditPage >= auditTotalPages) return;
      auditPage += 1;
      await loadAudit();
    });
  }

  setTab('overview');
  await loadOverview();
}
