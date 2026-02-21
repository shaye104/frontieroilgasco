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
  element.textContent = asUnits ? `${toMoney(value)} units` : formatGuilders(value);
}

function renderSimpleLineChart(target, series, colorClass = 'line-primary') {
  if (!target) return;
  const safeSeries = Array.isArray(series) ? series : [];
  if (!safeSeries.length) {
    target.innerHTML = '<p class="muted">No data available for this range.</p>';
    return;
  }

  const width = 560;
  const height = 180;
  const paddingX = 18;
  const paddingY = 14;
  const max = Math.max(1, ...safeSeries.map((point) => toMoney(point.value)));
  const stepX = safeSeries.length > 1 ? (width - paddingX * 2) / (safeSeries.length - 1) : 0;
  const points = safeSeries
    .map((point, index) => {
      const x = paddingX + stepX * index;
      const y = height - paddingY - ((toMoney(point.value) / max) * (height - paddingY * 2));
      return `${x},${y}`;
    })
    .join(' ');

  target.innerHTML = `
    <svg class="finance-line-svg ${colorClass}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
      <polyline points="${points}" />
    </svg>
    <div class="finance-chart-label-row">
      ${safeSeries.map((point) => `<span>${text(point.label)}</span>`).join('')}
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

  const maxTotal = Math.max(1, ...safeSeries.map((point) => toMoney(point.companyShare) + toMoney(point.crewShare)));
  target.innerHTML = `
    <div class="finance-stacked-bars">
      ${safeSeries
        .map((point) => {
          const company = Math.max(0, toMoney(point.companyShare));
          const crew = Math.max(0, toMoney(point.crewShare));
          const total = company + crew;
          const heightPct = Math.max(6, (total / maxTotal) * 100);
          const companyPct = total > 0 ? (company / total) * 100 : 0;
          return `<div class="finance-stacked-col">
            <div class="finance-stacked-track" style="height:${heightPct}%">
              <span class="finance-stacked-segment finance-stacked-company" style="height:${companyPct}%"></span>
              <span class="finance-stacked-segment finance-stacked-crew" style="height:${Math.max(0, 100 - companyPct)}%"></span>
            </div>
            <small>${text(point.label)}</small>
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
    target.innerHTML = '<li class="role-item"><span class="role-id">No unsettled company share debts.</span></li>';
    return;
  }
  target.innerHTML = safeRows
    .map(
      (row) => `<li class="role-item">
        <span class="role-id">${text(row.officerName)}${row.officerSerial ? ` (${text(row.officerSerial)})` : ''}</span>
        <strong>${formatGuilders(row.outstanding)}</strong>
      </li>`
    )
    .join('');
}

function renderOverviewSkeleton(config) {
  const kpiIds = [
    config.netProfitSelector,
    config.companyShareSelector,
    config.crewShareSelector,
    config.lossesSelector,
    config.unsettledSelector,
    config.completedSelector
  ];
  kpiIds.forEach((selector) => {
    const el = document.querySelector(selector);
    if (el) el.innerHTML = '<span class="skeleton-line skeleton-w-55"></span>';
  });
  [config.netProfitChartSelector, config.shareChartSelector, config.lossesChartSelector, config.avgChartSelector].forEach((selector) => {
    const el = document.querySelector(selector);
    if (el) {
      el.innerHTML = '<div class="skeleton-line skeleton-w-90"></div><div class="skeleton-line skeleton-w-80"></div><div class="skeleton-line skeleton-w-70"></div>';
    }
  });
}

export async function initFinancesOverview(config) {
  const feedback = document.querySelector(config.feedbackSelector);
  const rangeButtons = [...document.querySelectorAll(config.rangeButtonsSelector)];
  const unsettledScope = document.querySelector(config.unsettledScopeSelector);
  const topDebtors = document.querySelector(config.topDebtorsSelector);
  if (!feedback || !rangeButtons.length || !unsettledScope || !topDebtors) return;

  const startedAt = typeof performance !== 'undefined' ? performance.now() : 0;
  let activeRange = 'month';

  const refresh = async () => {
    renderOverviewSkeleton(config);
    try {
      const payload = await getFinancesOverview(activeRange, unsettledScope.value || 'all');
      const kpis = payload.kpis || {};
      renderKpiValue(document.querySelector(config.netProfitSelector), kpis.netProfit);
      renderKpiValue(document.querySelector(config.companyShareSelector), kpis.companyShareEarnings);
      renderKpiValue(document.querySelector(config.crewShareSelector), kpis.crewShare);
      renderKpiValue(document.querySelector(config.lossesSelector), kpis.freightLossesValue);
      renderKpiValue(document.querySelector(config.unsettledSelector), kpis.unsettledCompanyShareOutstanding);
      const completedEl = document.querySelector(config.completedSelector);
      if (completedEl) completedEl.textContent = String(Number(kpis.completedVoyages || 0));

      const charts = payload.charts || {};
      renderSimpleLineChart(document.querySelector(config.netProfitChartSelector), charts.netProfitTrend || [], 'line-primary');
      renderStackedShareChart(document.querySelector(config.shareChartSelector), charts.companyVsCrew || []);
      renderSimpleLineChart(document.querySelector(config.lossesChartSelector), charts.freightLossValueTrend || [], 'line-accent');
      renderSimpleLineChart(document.querySelector(config.avgChartSelector), charts.avgNetProfitTrend || [], 'line-muted');

      renderTopDebtors(topDebtors, payload?.unsettled?.topDebtors || []);
      clearMessage(feedback);
      if (startedAt) {
        const elapsed = Math.round(performance.now() - startedAt);
        console.info('[perf] finances first data render', { ms: elapsed });
      }
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to load finance overview.', 'error');
    }
  };

  rangeButtons.forEach((button) => {
    button.addEventListener('click', async () => {
      activeRange = String(button.getAttribute('data-range') || 'month');
      rangeButtons.forEach((btn) => btn.classList.toggle('is-active', btn === button));
      await refresh();
    });
  });
  unsettledScope.addEventListener('change', refresh);

  await refresh();
}

export async function initFinancesDebts(config, session) {
  const feedback = document.querySelector(config.feedbackSelector);
  const groupsRoot = document.querySelector(config.groupsSelector);
  const searchInput = document.querySelector(config.searchSelector);
  const minOutstandingInput = document.querySelector(config.minOutstandingSelector);
  const totalsText = document.querySelector(config.totalsSelector);
  const auditLink = document.querySelector(config.auditLinkSelector);
  if (!feedback || !groupsRoot || !searchInput || !minOutstandingInput || !totalsText || !auditLink) return;

  if (session?.permissions?.includes?.('finances.audit.view') || session?.permissions?.includes?.('admin.override')) {
    auditLink.classList.remove('hidden');
  }

  let debounceTimer = null;
  const refresh = async () => {
    groupsRoot.innerHTML = '<div class="skeleton-line skeleton-w-90"></div><div class="skeleton-line skeleton-w-80"></div><div class="skeleton-line skeleton-w-70"></div>';
    try {
      const payload = await listFinanceDebts({
        search: searchInput.value,
        minOutstanding: minOutstandingInput.value
      });
      const groups = payload.groups || [];
      const canSettle = Boolean(payload?.permissions?.canSettle);
      totalsText.textContent = `Outstanding: ${formatGuilders(payload?.totals?.unsettledOutstanding || 0)} | Voyages: ${
        Number(payload?.totals?.unsettledVoyages || 0)
      }`;

      if (!groups.length) {
        groupsRoot.innerHTML = '<article class="panel"><p>No unsettled debts found.</p></article>';
        clearMessage(feedback);
        return;
      }

      groupsRoot.innerHTML = groups
        .map(
          (group) => `<details class="finance-debt-group" open>
            <summary>
              <span>${text(group.officerName)}${group.officerSerial ? ` (${text(group.officerSerial)})` : ''}</span>
              <strong>${formatGuilders(group.outstandingTotal)}</strong>
            </summary>
            <div class="table-wrap">
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Voyage</th>
                    <th>Route</th>
                    <th>Ended</th>
                    <th class="align-right">Company Share (10%)</th>
                    <th>Status</th>
                    ${canSettle ? '<th>Action</th>' : ''}
                  </tr>
                </thead>
                <tbody>
                  ${group.voyages
                    .map(
                      (voyage) => `<tr>
                        <td>${text(voyage.vesselName)} | ${text(voyage.vesselCallsign)}</td>
                        <td>${text(voyage.departurePort)} \u2192 ${text(voyage.destinationPort)}</td>
                        <td>${formatWhen(voyage.endedAt)}</td>
                        <td class="align-right">${formatGuilders(voyage.companyShareAmount)}</td>
                        <td>${text(voyage.companyShareStatus)}</td>
                        ${canSettle ? `<td><button class="btn btn-primary" type="button" data-settle-voyage="${voyage.voyageId}">Settle</button></td>` : ''}
                      </tr>`
                    )
                    .join('')}
                </tbody>
              </table>
            </div>
          </details>`
        )
        .join('');

      if (canSettle) {
        groupsRoot.querySelectorAll('[data-settle-voyage]').forEach((button) => {
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

      clearMessage(feedback);
    } catch (error) {
      showMessage(feedback, error.message || 'Unable to load debts.', 'error');
      groupsRoot.innerHTML = '<article class="panel"><p>Unable to load data</p></article>';
    }
  };

  const scheduleRefresh = () => {
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
  if (!feedback || !tableBody || !pageInfo || !prevButton || !nextButton) return;

  let currentPage = 1;
  let totalPages = 1;

  const refresh = async () => {
    tableBody.innerHTML = '<tr><td colspan="7"><span class="skeleton-line skeleton-w-90"></span></td></tr>';
    try {
      const payload = await listFinanceAudit({ page: currentPage, pageSize: 25 });
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
