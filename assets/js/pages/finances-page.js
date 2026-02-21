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

function formatDateLabel(value, fallbackLabel = '') {
  const raw = String(value || '').trim();
  if (!raw) return text(fallbackLabel);
  let date = null;
  let monthly = false;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    date = new Date(`${raw}T00:00:00Z`);
  } else if (/^\d{4}-\d{2}$/.test(raw)) {
    monthly = true;
    date = new Date(`${raw}-01T00:00:00Z`);
  }
  if (!date || Number.isNaN(date.getTime())) return text(fallbackLabel || raw);
  if (monthly) {
    return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

function parseKeyTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return Number.NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00Z`).getTime();
  if (/^\d{4}-\d{2}$/.test(raw)) return new Date(`${raw}-01T00:00:00Z`).getTime();
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
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

function normalizeSeriesPoints(series) {
  const rows = Array.isArray(series) ? series : [];
  return rows
    .map((point, index) => {
      const key = String(point?.key || '').trim() || `idx-${index}`;
      const parsedTime = parseKeyTime(key);
      return {
        key,
        label: formatDateLabel(key, point?.label || key),
        value: toMoney(point?.value || 0),
        parsedTime,
        originalIndex: index
      };
    })
    .sort((a, b) => {
      const aTime = Number.isFinite(a.parsedTime) ? a.parsedTime : Number.POSITIVE_INFINITY;
      const bTime = Number.isFinite(b.parsedTime) ? b.parsedTime : Number.POSITIVE_INFINITY;
      if (aTime !== bTime) return aTime - bTime;
      return a.originalIndex - b.originalIndex;
    });
}

function mergeSeriesByKey(baseSeries, extraSeries) {
  const base = normalizeSeriesPoints(baseSeries);
  const extras = normalizeSeriesPoints(extraSeries);
  const byKey = new Map();
  base.forEach((point) => {
    byKey.set(point.key, {
      key: point.key,
      parsedTime: point.parsedTime,
      originalIndex: point.originalIndex,
      label: point.label,
      base: point.value,
      extra: 0
    });
  });
  extras.forEach((point) => {
    if (!byKey.has(point.key)) {
      byKey.set(point.key, {
        key: point.key,
        parsedTime: point.parsedTime,
        originalIndex: point.originalIndex + 10000,
        label: point.label,
        base: 0,
        extra: point.value
      });
      return;
    }
    byKey.get(point.key).extra = point.value;
  });
  return [...byKey.values()].sort((a, b) => {
    const aTime = Number.isFinite(a.parsedTime) ? a.parsedTime : Number.POSITIVE_INFINITY;
    const bTime = Number.isFinite(b.parsedTime) ? b.parsedTime : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return a.originalIndex - b.originalIndex;
  });
}

function formatTick(value) {
  return formatGuilders(value);
}

function renderCartesianLineChart(target, lines, options = {}) {
  if (!target) return;
  const safeLines = Array.isArray(lines) ? lines.filter((line) => Array.isArray(line?.points)) : [];
  const maxPoints = safeLines.reduce((max, line) => Math.max(max, line.points.length), 0);
  if (!safeLines.length || maxPoints <= 0) {
    target.innerHTML = '<div class="finance-chart-empty">No data for selected range</div>';
    return;
  }

  const firstLine = safeLines[0];
  const points = firstLine.points;
  if (!points.length) {
    target.innerHTML = '<div class="finance-chart-empty">No data for selected range</div>';
    return;
  }

  const width = Number(options.width || 760);
  const height = Number(options.height || 286);
  const plotLeft = 74;
  const plotRight = width - 18;
  const plotTop = 16;
  const plotBottom = height - 38;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = Math.max(1, plotBottom - plotTop);
  const steps = Math.max(points.length - 1, 1);

  const allValues = safeLines.flatMap((line) => line.points.map((point) => toMoney(point.value)));
  let minValue = Math.min(...allValues);
  let maxValue = Math.max(...allValues);
  if (minValue === maxValue) {
    if (minValue === 0) {
      maxValue = 1;
    } else {
      minValue = Math.min(0, minValue - Math.abs(minValue * 0.2));
      maxValue = maxValue + Math.abs(maxValue * 0.2);
    }
  }
  if (minValue > 0) minValue = 0;

  const yTicks = 5;
  const tickValues = Array.from({ length: yTicks }, (_, idx) => {
    const ratio = idx / (yTicks - 1);
    return Math.round(maxValue - ratio * (maxValue - minValue));
  });

  const xAt = (idx) => plotLeft + (idx / steps) * plotWidth;
  const yAt = (value) => plotTop + ((maxValue - value) / (maxValue - minValue)) * plotHeight;

  const xLabelStep = points.length > 9 ? Math.ceil(points.length / 6) : 1;
  const yGrid = tickValues
    .map((tick) => {
      const y = yAt(tick);
      return `<g>
        <line class="finance-grid-line" x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}"></line>
        <text class="finance-axis-y-label" x="${plotLeft - 8}" y="${y + 4}" text-anchor="end">${formatTick(tick)}</text>
      </g>`;
    })
    .join('');

  const xLabels = points
    .map((point, idx) => {
      const show = idx % xLabelStep === 0 || idx === points.length - 1;
      if (!show) return '';
      const x = xAt(idx);
      return `<text class="finance-axis-x-label" x="${x}" y="${height - 10}" text-anchor="middle">${text(point.label)}</text>`;
    })
    .join('');

  const linePaths = safeLines
    .map((line) => {
      const path = line.points
        .map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${xAt(idx)} ${yAt(point.value)}`)
        .join(' ');
      return `<path class="finance-line-path" d="${path}" stroke="${line.color}" fill="none"></path>`;
    })
    .join('');

  const pointMarkers = safeLines
    .map((line, lineIndex) =>
      line.points
        .map((point, idx) => `<circle class="finance-line-point" data-line="${lineIndex}" data-index="${idx}" cx="${xAt(idx)}" cy="${yAt(point.value)}" r="3.2" fill="${line.color}"></circle>`)
        .join('')
    )
    .join('');

  const legend = safeLines.length > 1
    ? `<div class="finance-chart-legend">${safeLines
        .map((line) => `<span class="finance-legend-item"><i style="background:${line.color}"></i>${text(line.label)}</span>`)
        .join('')}</div>`
    : '';

  target.innerHTML = `
    <div class="finance-chart-shell">
      <svg class="finance-cartesian-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <rect x="${plotLeft}" y="${plotTop}" width="${plotWidth}" height="${plotHeight}" fill="#ffffff"></rect>
        ${yGrid}
        <line class="finance-axis-line" x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}"></line>
        <line class="finance-axis-line" x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}"></line>
        ${linePaths}
        ${pointMarkers}
        ${xLabels}
        <line class="finance-hover-line hidden" x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}"></line>
      </svg>
      ${legend}
      <div class="finance-chart-tooltip hidden"></div>
    </div>
  `;

  const shell = target.querySelector('.finance-chart-shell');
  const svg = target.querySelector('.finance-cartesian-svg');
  const hoverLine = target.querySelector('.finance-hover-line');
  const tooltip = target.querySelector('.finance-chart-tooltip');
  if (!shell || !svg || !hoverLine || !tooltip) return;

  const showTooltipAtIndex = (index, clientX, clientY) => {
    const idx = Math.max(0, Math.min(index, points.length - 1));
    const linesHtml = safeLines
      .map((line) => {
        const point = line.points[idx];
        return `<div class="finance-tooltip-row"><span class="finance-tooltip-key"><i style="background:${line.color}"></i>${text(line.label)}</span><strong>${formatGuilders(
          point?.value || 0
        )}</strong></div>`;
      })
      .join('');

    tooltip.innerHTML = `<div class="finance-tooltip-title">${text(points[idx].label)}</div>${linesHtml}`;
    tooltip.classList.remove('hidden');
    hoverLine.classList.remove('hidden');

    const rect = svg.getBoundingClientRect();
    const scaleX = rect.width / width;
    const xSvg = xAt(idx);
    const xPx = (xSvg * scaleX) + (shell.scrollLeft || 0);
    hoverLine.setAttribute('x1', String(xSvg));
    hoverLine.setAttribute('x2', String(xSvg));

    const shellRect = shell.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    let left = clientX - shellRect.left + 14;
    let top = clientY - shellRect.top + 14;
    if (left + tooltipRect.width > shellRect.width - 8) left = xPx - tooltipRect.width - 12;
    if (top + tooltipRect.height > shellRect.height - 8) top = shellRect.height - tooltipRect.height - 8;
    if (top < 8) top = 8;
    if (left < 8) left = 8;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  };

  shell.addEventListener('mousemove', (event) => {
    const rect = svg.getBoundingClientRect();
    const scaleX = width / rect.width;
    const mouseX = (event.clientX - rect.left) * scaleX;
    const ratio = (mouseX - plotLeft) / plotWidth;
    const index = Math.round(Math.max(0, Math.min(1, ratio)) * steps);
    showTooltipAtIndex(index, event.clientX, event.clientY);
  });
  shell.addEventListener('mouseleave', () => {
    tooltip.classList.add('hidden');
    hoverLine.classList.add('hidden');
  });
}

function renderLineChart(target, series, lineLabel, color) {
  const points = normalizeSeriesPoints(series);
  renderCartesianLineChart(target, [{ label: lineLabel, color, points }]);
}

function renderDualLineChart(target, baseSeries, baseLabel, baseColor, compareSeries, compareLabel, compareColor) {
  const merged = mergeSeriesByKey(baseSeries, compareSeries).map((point) => ({
    key: point.key,
    label: point.label,
    base: toMoney(point.base),
    extra: toMoney(point.extra)
  }));
  renderCartesianLineChart(target, [
    { label: baseLabel, color: baseColor, points: merged.map((point) => ({ key: point.key, label: point.label, value: point.base })) },
    { label: compareLabel, color: compareColor, points: merged.map((point) => ({ key: point.key, label: point.label, value: point.extra })) }
  ]);
}

function renderOverviewSkeleton() {
  ['#kpiNetProfit', '#kpiCompanyShare', '#kpiCrewShare', '#kpiLossValue', '#kpiCompletedVoyages', '#kpiUnsettled'].forEach((selector) => {
    const el = $(selector);
    if (el) el.innerHTML = '<span class="finance-value-skeleton"></span>';
  });

  ['#chartNetProfit', '#trendsChartNetProfit', '#trendsChartNetProfitLoss', '#trendsChartLossTrend', '#trendsChartAvgProfit'].forEach((selector) => {
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

  renderLineChart($('#chartNetProfit'), charts.netProfitTrend || [], 'Net Profit', '#253475');
  renderLineChart($('#trendsChartNetProfit'), charts.netProfitTrend || [], 'Net Profit', '#253475');
  renderDualLineChart(
    $('#trendsChartNetProfitLoss'),
    charts.netProfitTrend || [],
    'Net Profit',
    '#253475',
    charts.freightLossValueTrend || [],
    'Freight Loss Value',
    '#b45309'
  );
  renderLineChart($('#trendsChartLossTrend'), charts.freightLossValueTrend || [], 'Freight Loss Value', '#5776b7');
  renderLineChart($('#trendsChartAvgProfit'), charts.avgNetProfitTrend || [], 'Average Profit per Voyage', '#64748b');

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
