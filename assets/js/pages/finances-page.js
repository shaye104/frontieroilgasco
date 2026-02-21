import { hasPermission, performLogout, renderIntranetNavbar } from '../modules/nav.js?v=20260221h';

function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return [...document.querySelectorAll(selector)];
}

const RANGE_KEYS = ['week', 'month', '3m', '6m', 'year'];
const TAB_KEYS = ['overview', 'trends', 'debts', 'audit'];
const BREAKDOWN_KEYS = ['route', 'vessel', 'ootw'];

const FINANCE_ICONS = {
  'trending-up':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 7-7"/><path d="M14 8h6v6"/></svg>',
  building:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h2M11 7h2M15 7h2M7 11h2M11 11h2M15 11h2M10 21v-4h4v4"/></svg>',
  hourglass:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h12M6 22h12"/><path d="M8 2v5a4 4 0 0 0 2 3.5L12 12l-2 1.5A4 4 0 0 0 8 17v5M16 2v5a4 4 0 0 1-2 3.5L12 12l2 1.5A4 4 0 0 1 16 17v5"/></svg>',
  'check-circle':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  'package-x':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16.5 9.4 7.5 4.2"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><path d="M3.3 7 12 12l8.7-5"/><path d="M12 22V12"/><path d="m16 15 4 4"/><path d="m20 15-4 4"/></svg>',
  route:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="6" cy="19" r="2"/><circle cx="18" cy="5" r="2"/><path d="M8 19h5a3 3 0 0 0 3-3V7"/></svg>',
  ship:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17h18l-2.2 3.3a2 2 0 0 1-1.7.9H6.9a2 2 0 0 1-1.7-.9L3 17z"/><path d="M5 17V9l7-4 7 4v8"/><path d="M12 5v12"/></svg>',
  users:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>'
};

function renderIcons() {
  $$('[data-icon]').forEach((node) => {
    const name = String(node.getAttribute('data-icon') || '').trim().toLowerCase();
    node.innerHTML = FINANCE_ICONS[name] || '';
  });
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

function formatGuildersCompact(value) {
  const abs = Math.abs(toMoney(value));
  if (abs >= 1000000) return `\u0192 ${Math.round(toMoney(value) / 100000) / 10}m`;
  if (abs >= 1000) return `\u0192 ${Math.round(toMoney(value) / 100) / 10}k`;
  return formatGuilders(value);
}

function formatInteger(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? Math.round(num).toLocaleString() : '0';
}

function formatPercent(value) {
  const num = Number(value || 0);
  return Number.isFinite(num) ? `${Math.round(num)}%` : '0%';
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

function normalizeFinanceRange(input) {
  const value = String(input || '').trim().toLowerCase();
  return RANGE_KEYS.includes(value) ? value : 'week';
}

function normalizeFinanceTab(input) {
  const value = String(input || '').trim().toLowerCase();
  return TAB_KEYS.includes(value) ? value : 'overview';
}

function normalizeBreakdownMode(input) {
  const value = String(input || '').trim().toLowerCase();
  return BREAKDOWN_KEYS.includes(value) ? value : 'route';
}

function truncateLabel(value, maxLength = 18) {
  const raw = String(value || '').trim();
  if (!raw) return 'N/A';
  const limit = Math.max(8, Number(maxLength || 18));
  if (raw.length <= limit) return raw;
  return `${raw.slice(0, limit - 1)}\u2026`;
}

function parseKeyTime(value) {
  const raw = String(value || '').trim();
  if (!raw) return Number.NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00Z`).getTime();
  if (/^\d{4}-\d{2}$/.test(raw)) return new Date(`${raw}-01T00:00:00Z`).getTime();
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatDateLabel(value, fallbackLabel = '') {
  const raw = String(value || '').trim();
  if (!raw) return text(fallbackLabel);

  let monthly = false;
  let date = null;
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

function normalizeSeriesPoints(series) {
  const rows = Array.isArray(series) ? series : [];
  return rows
    .map((point, index) => {
      const key = String(point?.key || '').trim() || `idx-${index}`;
      const parsedTime = parseKeyTime(key);
      const fallbackLabel = point?.label || key;
      const label = formatDateLabel(key, fallbackLabel);
      const tooltipLabel = text(point?.tooltipLabel || fallbackLabel || key);
      return {
        key,
        label,
        tooltipLabel,
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

  const logoutButton = $('.site-nav button.btn.btn-secondary');
  if (!logoutButton) return;
  logoutButton.onclick = async () => {
    try {
      await performLogout('/');
    } catch {
      window.location.href = '/';
    }
  };
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

function updateUrlState(state) {
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set('tab', state.activeTab);
  nextUrl.searchParams.set('range', state.range);
  nextUrl.searchParams.set('breakdown', state.breakdownMode || 'route');
  window.history.replaceState({}, '', nextUrl.toString());
}

function previousRangeLabel(range) {
  if (range === 'week') return 'last week';
  if (range === 'month') return 'last month';
  if (range === '3m') return 'last 3 months';
  if (range === '6m') return 'last 6 months';
  return 'last year';
}

function toDelta(current, previous, range, invertDirection = false) {
  const now = Number(current || 0);
  const prev = Number(previous || 0);
  const diff = now - prev;
  const label = previousRangeLabel(range);

  if (prev === 0 && now === 0) {
    return { text: `• 0% vs ${label}`, tone: 'neutral' };
  }

  if (prev === 0) {
    const tone = invertDirection ? 'negative' : 'positive';
    const icon = tone === 'positive' ? '▲' : '▼';
    return { text: `${icon} New vs ${label}`, tone };
  }

  const percent = Math.round((diff / Math.abs(prev)) * 100);
  const value = Math.abs(percent);
  let tone = percent > 0 ? 'positive' : percent < 0 ? 'negative' : 'neutral';
  if (invertDirection && tone !== 'neutral') {
    tone = tone === 'positive' ? 'negative' : 'positive';
  }
  const icon = tone === 'positive' ? '▲' : tone === 'negative' ? '▼' : '•';
  return { text: `${icon} ${value}% vs ${label}`, tone };
}

function setDelta(selector, delta) {
  const el = $(selector);
  if (!el) return;
  el.classList.remove('is-positive', 'is-negative', 'is-neutral');
  el.classList.add(`is-${delta?.tone || 'neutral'}`);
  el.textContent = text(delta?.text || '');
}

function rangeWindow(range) {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  if (range === 'week') start.setDate(end.getDate() - 6);
  else if (range === 'month') start.setDate(1);
  else if (range === '3m') start.setMonth(end.getMonth() - 2, 1);
  else if (range === '6m') start.setMonth(end.getMonth() - 5, 1);
  else start.setMonth(0, 1);
  start.setHours(0, 0, 0, 0);
  return { start, end };
}

function toDateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function renderCartesianLineChart(target, lines, options = {}) {
  if (!target) return;

  const safeLines = Array.isArray(lines) ? lines.filter((line) => Array.isArray(line?.points)) : [];
  const maxPoints = safeLines.reduce((max, line) => Math.max(max, line.points.length), 0);
  if (!safeLines.length || maxPoints <= 0) {
    target.innerHTML = '<div class="finance-chart-empty">No data for selected range</div>';
    return;
  }

  const points = safeLines[0].points;
  if (!points.length) {
    target.innerHTML = '<div class="finance-chart-empty">No data for selected range</div>';
    return;
  }

  const width = Number(options.width || 760);
  const height = Number(options.height || 306);
  const valueFormatter = typeof options.valueFormatter === 'function' ? options.valueFormatter : formatGuilders;
  const tickFormatter = typeof options.tickFormatter === 'function' ? options.tickFormatter : valueFormatter;

  const plotLeft = 74;
  const plotRight = width - 18;
  const plotTop = 16;
  const plotBottom = height - 48;
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
      maxValue += Math.abs(maxValue * 0.2);
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
        <text class="finance-axis-y-label" x="${plotLeft - 8}" y="${y + 4}" text-anchor="end">${text(tickFormatter(tick))}</text>
      </g>`;
    })
    .join('');

  const xLabels = points
    .map((point, idx) => {
      const show = idx % xLabelStep === 0 || idx === points.length - 1;
      if (!show) return '';
      const x = xAt(idx);
      return `<text class="finance-axis-x-label" x="${x}" y="${height - 16}" text-anchor="middle">${text(point.label)}</text>`;
    })
    .join('');

  const linePaths = safeLines
    .map((line) => {
      const path = line.points.map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${xAt(idx)} ${yAt(point.value)}`).join(' ');
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
        return `<div class="finance-tooltip-row"><span class="finance-tooltip-key"><i style="background:${line.color}"></i>${text(line.label)}</span><strong>${text(valueFormatter(
          point?.value || 0
        ))}</strong></div>`;
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

function renderCartesianBarChart(target, series, label, color, options = {}) {
  if (!target) return;
  const points = normalizeSeriesPoints(series);
  if (!points.length) {
    target.innerHTML = '<div class="finance-chart-empty">No data for selected range</div>';
    return;
  }

  const width = Number(options.width || 760);
  const height = Number(options.height || 306);
  const valueFormatter = typeof options.valueFormatter === 'function' ? options.valueFormatter : formatInteger;
  const tickFormatter = typeof options.tickFormatter === 'function' ? options.tickFormatter : valueFormatter;

  const plotLeft = 74;
  const plotRight = width - 18;
  const plotTop = 16;
  const plotBottom = height - 48;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = Math.max(1, plotBottom - plotTop);

  const values = points.map((point) => Math.max(0, toMoney(point.value)));
  const maxValue = Math.max(1, ...values);

  const yTicks = 5;
  const tickValues = Array.from({ length: yTicks }, (_, idx) => {
    const ratio = idx / (yTicks - 1);
    return Math.round(maxValue - ratio * maxValue);
  });

  const yAt = (value) => plotTop + ((maxValue - value) / maxValue) * plotHeight;
  const band = plotWidth / points.length;
  const barWidth = Math.max(6, Math.min(26, band * 0.58));

  const yGrid = tickValues
    .map((tick) => {
      const y = yAt(tick);
      return `<g>
        <line class="finance-grid-line" x1="${plotLeft}" y1="${y}" x2="${plotRight}" y2="${y}"></line>
        <text class="finance-axis-y-label" x="${plotLeft - 8}" y="${y + 4}" text-anchor="end">${text(tickFormatter(tick))}</text>
      </g>`;
    })
    .join('');

  const xLabelStep = points.length > 9 ? Math.ceil(points.length / 6) : 1;
  const xLabels = points
    .map((point, idx) => {
      const show = idx % xLabelStep === 0 || idx === points.length - 1;
      if (!show) return '';
      const x = plotLeft + (idx + 0.5) * band;
      return `<text class="finance-axis-x-label" x="${x}" y="${height - 16}" text-anchor="middle">${text(point.label)}</text>`;
    })
    .join('');

  const bars = points
    .map((point, idx) => {
      const value = Math.max(0, toMoney(point.value));
      const x = plotLeft + idx * band + (band - barWidth) / 2;
      const y = yAt(value);
      const h = Math.max(1, plotBottom - y);
      return `<rect class="finance-bar-rect" data-index="${idx}" x="${x}" y="${y}" width="${barWidth}" height="${h}" rx="4" fill="${color}"></rect>`;
    })
    .join('');

  target.innerHTML = `
    <div class="finance-chart-shell">
      <svg class="finance-cartesian-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <rect x="${plotLeft}" y="${plotTop}" width="${plotWidth}" height="${plotHeight}" fill="#ffffff"></rect>
        ${yGrid}
        <line class="finance-axis-line" x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}"></line>
        <line class="finance-axis-line" x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}"></line>
        ${bars}
        ${xLabels}
      </svg>
      <div class="finance-chart-legend"><span class="finance-legend-item"><i style="background:${color}"></i>${text(label)}</span></div>
      <div class="finance-chart-tooltip hidden"></div>
    </div>
  `;

  const shell = target.querySelector('.finance-chart-shell');
  const tooltip = target.querySelector('.finance-chart-tooltip');
  if (!shell || !tooltip) return;

  shell.querySelectorAll('.finance-bar-rect').forEach((bar) => {
    bar.addEventListener('mouseenter', (event) => {
      const idx = Math.max(0, Math.min(points.length - 1, Number(bar.getAttribute('data-index') || 0)));
      const point = points[idx];
      tooltip.innerHTML = `<div class="finance-tooltip-title">${text(point.tooltipLabel || point.label)}</div><div class="finance-tooltip-row"><span class="finance-tooltip-key"><i style="background:${color}"></i>${text(
        label
      )}</span><strong>${text(valueFormatter(point.value))}</strong></div>`;
      tooltip.classList.remove('hidden');

      const shellRect = shell.getBoundingClientRect();
      const tooltipRect = tooltip.getBoundingClientRect();
      let left = event.clientX - shellRect.left + 12;
      let top = event.clientY - shellRect.top + 12;
      if (left + tooltipRect.width > shellRect.width - 8) left = shellRect.width - tooltipRect.width - 8;
      if (top + tooltipRect.height > shellRect.height - 8) top = shellRect.height - tooltipRect.height - 8;
      if (left < 8) left = 8;
      if (top < 8) top = 8;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    });

    bar.addEventListener('mouseleave', () => {
      tooltip.classList.add('hidden');
    });
  });
}

function renderLineChart(target, series, lineLabel, color) {
  const points = normalizeSeriesPoints(series);
  renderCartesianLineChart(target, [{ label: lineLabel, color, points }], {
    valueFormatter: formatGuilders,
    tickFormatter: formatGuildersCompact
  });
}

function renderCurrencyBarChart(target, series, label, color) {
  renderCartesianBarChart(target, series, label, color, {
    valueFormatter: formatGuilders,
    tickFormatter: formatGuildersCompact
  });
}

function renderCountBarChart(target, series, label, color) {
  renderCartesianBarChart(target, series, label, color, {
    valueFormatter: (value) => formatInteger(value),
    tickFormatter: (value) => formatInteger(value)
  });
}

function renderPercentLineChart(target, series, lineLabel, color) {
  const points = normalizeSeriesPoints(series);
  renderCartesianLineChart(target, [{ label: lineLabel, color, points }], {
    valueFormatter: (value) => formatPercent(value),
    tickFormatter: (value) => formatPercent(value)
  });
}

function renderNoData(target, message) {
  if (!target) return;
  target.innerHTML = `<div class="finance-chart-empty">${text(message || 'No data for selected range')}</div>`;
}

function renderProfitDriversChart(target, breakdowns, mode) {
  const safeMode = normalizeBreakdownMode(mode);
  const source = safeMode === 'vessel' ? breakdowns?.byVessel : safeMode === 'ootw' ? breakdowns?.byOotw : breakdowns?.byRoute;
  const rawRows = Array.isArray(source) ? source : [];
  const rows = rawRows
    .map((row) => ({ label: text(row?.label || 'Unknown'), netProfit: toMoney(row?.netProfit || 0) }))
    .sort((a, b) => b.netProfit - a.netProfit || a.label.localeCompare(b.label));

  if (!rows.length) {
    renderNoData(target, 'No profit drivers in this period');
    return;
  }

  const topRows = rows.slice(0, 5);
  const otherTotal = rows.slice(5).reduce((sum, row) => toMoney(sum + toMoney(row.netProfit || 0)), 0);
  const plottedRows = otherTotal !== 0 ? [...topRows, { label: 'Other', netProfit: otherTotal }] : topRows;

  const points = plottedRows.map((row, index) => {
    const fullLabel = text(row?.label || 'Unknown');
    return {
      key: `rank-${index + 1}`,
      label: truncateLabel(fullLabel, 18),
      tooltipLabel: fullLabel,
      value: toMoney(row?.netProfit || 0)
    };
  });

  const legendLabel = safeMode === 'vessel' ? 'Profit by Vessel' : safeMode === 'ootw' ? 'Profit by OOTW' : 'Profit by Route';
  renderCurrencyBarChart(target, points, legendLabel, '#2b4aa2');
}

function alignSeries(netSeries, companySeries) {
  const netPoints = normalizeSeriesPoints(netSeries);
  const companyPoints = normalizeSeriesPoints(companySeries);
  const byKey = new Map();

  netPoints.forEach((point) => {
    byKey.set(point.key, {
      key: point.key,
      label: point.label,
      parsedTime: point.parsedTime,
      net: point.value,
      company: 0
    });
  });

  companyPoints.forEach((point) => {
    const existing = byKey.get(point.key);
    if (existing) {
      existing.company = point.value;
      if (!existing.label) existing.label = point.label;
      return;
    }
    byKey.set(point.key, {
      key: point.key,
      label: point.label,
      parsedTime: point.parsedTime,
      net: 0,
      company: point.value
    });
  });

  return [...byKey.values()].sort((a, b) => {
    const aTime = Number.isFinite(a.parsedTime) ? a.parsedTime : Number.POSITIVE_INFINITY;
    const bTime = Number.isFinite(b.parsedTime) ? b.parsedTime : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return a.key.localeCompare(b.key);
  });
}

function renderProfitShareChart(target, netSeries, companySeries) {
  const rows = alignSeries(netSeries, companySeries);
  if (!rows.length) {
    renderNoData(target, 'No data for selected range');
    return;
  }

  const net = rows.map((row) => ({ key: row.key, label: row.label, value: row.net }));
  const company = rows.map((row) => ({ key: row.key, label: row.label, value: row.company }));

  renderCartesianLineChart(
    target,
    [
      { label: 'Net Profit', color: '#253475', points: net },
      { label: 'Company Share Earned', color: '#5776b7', points: company }
    ],
    {
      valueFormatter: formatGuilders,
      tickFormatter: formatGuildersCompact
    }
  );
}

function isAllZeroSeries(series) {
  const safe = Array.isArray(series) ? series : [];
  if (!safe.length) return true;
  return safe.every((point) => toMoney(point?.value || 0) === 0);
}

function renderOverviewSkeleton() {
  ['#kpiNetProfit', '#kpiCompanyShare', '#kpiOutstanding', '#kpiSettlementRate', '#kpiAvgDaysToSettle', '#kpiLossValue'].forEach((selector) => {
    const el = $(selector);
    if (el) el.innerHTML = '<span class="finance-value-skeleton"></span>';
  });

  ['#kpiDeltaNetProfit', '#kpiDeltaCompanyShare', '#kpiDeltaOutstanding', '#kpiDeltaSettlementRate', '#kpiDeltaLossValue', '#kpiAvgDaysHint'].forEach((selector) => {
    const el = $(selector);
    if (el) el.innerHTML = '<span class="finance-line-skeleton"></span>';
  });

  ['#chartNetProfit', '#trendsChartOutstanding', '#trendsChartVoyageCount', '#trendsChartAvgProfit', '#trendsChartProfitDrivers'].forEach((selector) => {
    const el = $(selector);
    if (el) el.innerHTML = '<div class="finance-chart-skeleton"></div>';
  });

  const unsettledAmount = $('#unsettledOutstandingTotal');
  if (unsettledAmount) unsettledAmount.innerHTML = '<span class="finance-value-skeleton"></span>';

  const unsettledCount = $('#unsettledVoyageCount');
  if (unsettledCount) unsettledCount.innerHTML = '<span class="finance-line-skeleton"></span>';

  ['#overviewSettlementRate', '#overviewAvgDaysToSettle', '#overviewOverdueUnsettled'].forEach((selector) => {
    const el = $(selector);
    if (el) el.innerHTML = '<span class="finance-line-skeleton"></span>';
  });

  const topDebtors = $('#unsettledTopList');
  if (topDebtors) {
    topDebtors.innerHTML =
      '<li class="finance-unsettled-item"><span class="finance-line-skeleton"></span></li>' +
      '<li class="finance-unsettled-item"><span class="finance-line-skeleton"></span></li>' +
      '<li class="finance-unsettled-item"><span class="finance-line-skeleton"></span></li>';
  }

  ['#topRouteLabel', '#topVesselLabel', '#topOotwLabel', '#topRouteValue', '#topVesselValue', '#topOotwValue'].forEach((selector) => {
    const el = $(selector);
    if (el) el.innerHTML = '<span class="finance-line-skeleton"></span>';
  });
}

function renderOverview(data, previousData, range, breakdownMode = 'route') {
  const kpis = data?.kpis || {};
  const charts = data?.charts || {};
  const unsettled = data?.unsettled || {};
  const breakdowns = data?.breakdowns || {};
  const topPerformers = data?.topPerformers || {};
  const previousKpis = previousData?.kpis || {};

  const writeMoney = (selector, value) => {
    const el = $(selector);
    if (!el) return;
    el.textContent = formatGuilders(value);
  };

  writeMoney('#kpiNetProfit', kpis.netProfit || 0);
  writeMoney('#kpiCompanyShare', kpis.companyShareEarnings || 0);
  writeMoney('#kpiOutstanding', kpis.unsettledCompanyShareOutstanding || 0);
  writeMoney('#kpiLossValue', kpis.freightLossesValue || 0);

  const settlementRate = $('#kpiSettlementRate');
  if (settlementRate) settlementRate.textContent = formatPercent(kpis.settlementRatePct || 0);

  const avgDays = $('#kpiAvgDaysToSettle');
  if (avgDays) avgDays.textContent = kpis.avgDaysToSettle == null ? '—' : `${formatInteger(kpis.avgDaysToSettle)}d`;

  const avgDaysHint = $('#kpiAvgDaysHint');
  if (avgDaysHint) avgDaysHint.textContent = kpis.avgDaysToSettle == null ? 'No settled voyages in range' : 'Settled voyages only';

  setDelta('#kpiDeltaNetProfit', toDelta(kpis.netProfit, previousKpis.netProfit, range));
  setDelta('#kpiDeltaCompanyShare', toDelta(kpis.companyShareEarnings, previousKpis.companyShareEarnings, range));
  setDelta('#kpiDeltaOutstanding', toDelta(kpis.unsettledCompanyShareOutstanding, previousKpis.unsettledCompanyShareOutstanding, range, true));
  setDelta('#kpiDeltaSettlementRate', toDelta(kpis.settlementRatePct, previousKpis.settlementRatePct, range));
  setDelta('#kpiDeltaLossValue', toDelta(kpis.freightLossesValue, previousKpis.freightLossesValue, range, true));

  const hasVoyages = !isAllZeroSeries(charts.voyageCountTrend || []);
  renderProfitShareChart($('#chartNetProfit'), charts.netProfitTrend || [], charts.companyShareTrend || []);

  if (!hasVoyages) {
    renderNoData($('#trendsChartOutstanding'), 'No voyages in this period');
    renderNoData($('#trendsChartVoyageCount'), 'No voyages in this period');
    renderNoData($('#trendsChartAvgProfit'), 'No voyages in this period');
    renderNoData($('#trendsChartProfitDrivers'), 'No voyages in this period');
  } else {
    renderLineChart($('#trendsChartOutstanding'), charts.outstandingTrend || [], 'Outstanding Company Share', '#253475');
    renderCountBarChart($('#trendsChartVoyageCount'), charts.voyageCountTrend || [], 'Voyage Count', '#253475');
    renderLineChart($('#trendsChartAvgProfit'), charts.avgNetProfitTrend || [], 'Avg Net Profit / Voyage', '#2b4aa2');
    renderProfitDriversChart($('#trendsChartProfitDrivers'), breakdowns, breakdownMode);
  }

  const unsettledTotal = $('#unsettledOutstandingTotal');
  if (unsettledTotal) unsettledTotal.textContent = formatGuilders(unsettled.totalOutstanding || 0);

  const unsettledCount = $('#unsettledVoyageCount');
  if (unsettledCount) unsettledCount.textContent = `Unsettled Voyages: ${Number(unsettled.totalVoyages || 0)}`;

  const overviewSettlementRate = $('#overviewSettlementRate');
  if (overviewSettlementRate) overviewSettlementRate.textContent = formatPercent(kpis.settlementRatePct || 0);
  const overviewAvgDays = $('#overviewAvgDaysToSettle');
  if (overviewAvgDays) overviewAvgDays.textContent = kpis.avgDaysToSettle == null ? '—' : `${formatInteger(kpis.avgDaysToSettle)}d`;
  const overviewOverdue = $('#overviewOverdueUnsettled');
  if (overviewOverdue) overviewOverdue.textContent = formatInteger(unsettled.overdueVoyages || 0);

  const topList = $('#unsettledTopList');
  const topDebtors = Array.isArray(unsettled.topDebtors) ? unsettled.topDebtors : [];
  if (topList) {
    if (!topDebtors.length) {
      topList.innerHTML = '<li class="finance-unsettled-item"><span class="muted">No outstanding company share</span></li>';
    } else {
      topList.innerHTML = topDebtors
        .slice(0, 3)
        .map((row) => {
          const officer = row.officerSerial ? `${text(row.officerName)} (${text(row.officerSerial)})` : text(row.officerName);
          return `<li class="finance-unsettled-item"><span class="finance-unsettled-name">${officer}</span><strong class="finance-unsettled-amount">${formatGuilders(
            row.outstanding
          )}</strong></li>`;
        })
        .join('');
    }
  }

  const setTop = (labelSelector, valueSelector, payload) => {
    const labelEl = $(labelSelector);
    const valueEl = $(valueSelector);
    if (labelEl) labelEl.textContent = text(payload?.label || 'No data');
    if (valueEl) valueEl.textContent = formatGuilders(payload?.netProfit || 0);
  };

  setTop('#topRouteLabel', '#topRouteValue', topPerformers?.route);
  setTop('#topVesselLabel', '#topVesselValue', topPerformers?.vessel);
  setTop('#topOotwLabel', '#topOotwValue', topPerformers?.ootw);

}

function setBreakdownMode(state, mode) {
  state.breakdownMode = normalizeBreakdownMode(mode);
  $$('[data-breakdown-mode]').forEach((button) => {
    button.classList.toggle('is-active', button.getAttribute('data-breakdown-mode') === state.breakdownMode);
  });
  updateUrlState(state);

  if (!state.overview || state.overviewLoading) return;
  renderProfitDriversChart($('#trendsChartProfitDrivers'), state.overview?.breakdowns || {}, state.breakdownMode);
}

function renderDebtsSkeleton() {
  const body = $('#financeDebtsBody');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="7"><div class="finance-chart-skeleton"></div></td></tr>';
}

function setDebtsSummary(totals) {
  const summary = totals || {};
  const outstanding = $('#debtSummaryOutstanding');
  const voyages = $('#debtSummaryVoyages');
  const ootw = $('#debtSummaryOotw');
  if (outstanding) outstanding.textContent = formatGuilders(summary.unsettledOutstanding || 0);
  if (voyages) voyages.textContent = formatInteger(summary.unsettledVoyages || 0);
  if (ootw) ootw.textContent = formatInteger(summary.uniqueOotw || 0);
}

function renderDebtsRows(state) {
  const tbody = $('#financeDebtsBody');
  if (!tbody) return;

  const rows = Array.isArray(state.debtRows) ? state.debtRows : [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="7">No employees match the current filter.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map((row) => {
      const isUnsettled = String(row.companyShareStatus || '').toUpperCase() === 'UNSETTLED';
      const canSettle = state.canSettle && isUnsettled;
      const officer = row.officerSerial ? `${text(row.officerName)} (${text(row.officerSerial)})` : text(row.officerName);
      return `<tr>
        <td>${officer}</td>
        <td>${text(row.vesselName)} | ${text(row.vesselCallsign)}</td>
        <td>${text(row.departurePort)} \u2192 ${text(row.destinationPort)}</td>
        <td>${formatWhen(row.endedAt)}</td>
        <td class="align-right">${formatGuilders(row.companyShareAmount)}</td>
        <td><span class="finance-status-pill ${isUnsettled ? 'is-unsettled' : 'is-settled'}">${text(row.companyShareStatus)}</span></td>
        <td>${
          state.canSettle
            ? canSettle
              ? `<button type="button" class="btn btn-primary btn-compact" data-settle-voyage="${Number(row.voyageId || 0)}">Settle</button>`
              : '<span class="muted">Settled</span>'
            : '<span class="muted">—</span>'
        }</td>
      </tr>`;
    })
    .join('');

  if (!state.canSettle) return;

  tbody.querySelectorAll('[data-settle-voyage]').forEach((button) => {
    button.addEventListener('click', () => {
      const voyageId = Number(button.getAttribute('data-settle-voyage') || 0);
      if (!Number.isInteger(voyageId) || voyageId <= 0) return;
      const row = rows.find((entry) => Number(entry.voyageId || 0) === voyageId);
      if (!row) return;

      state.pendingSettle = {
        voyageId,
        amount: toMoney(row.companyShareAmount || 0),
        vesselName: text(row.vesselName),
        vesselCallsign: text(row.vesselCallsign),
        route: `${text(row.departurePort)} \u2192 ${text(row.destinationPort)}`
      };

      const message = $('#financeSettleMessage');
      if (message) {
        message.textContent = `Mark ${state.pendingSettle.vesselName} | ${state.pendingSettle.vesselCallsign} (${state.pendingSettle.route}) as settled for ${formatGuilders(
          state.pendingSettle.amount
        )}?`;
      }

      const modal = $('#financeSettleModal');
      if (modal) modal.classList.remove('hidden');
    });
  });
}

function renderDebtsPagination(state) {
  const pageInfo = $('#financeDebtsPageInfo');
  const prev = $('#financeDebtsPrev');
  const next = $('#financeDebtsNext');

  const currentPage = Math.max(1, Number(state.debtPage || 1));
  const totalPages = Math.max(1, Number(state.debtTotalPages || 1));

  if (pageInfo) pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
  if (prev) prev.disabled = currentPage <= 1;
  if (next) next.disabled = currentPage >= totalPages;
}

async function loadDebts(state) {
  state.debtsLoading = true;
  renderDebtsSkeleton();

  try {
    const requestedPage = state.debtPage;
    const params = new URLSearchParams();
    params.set('page', String(state.debtPage));
    params.set('pageSize', String(state.debtPageSize));

    const search = ($('#debtSearch')?.value || '').trim();
    const minOutstanding = ($('#debtMinOutstanding')?.value || '').trim();
    const scope = ($('#debtScope')?.value || 'all').trim();
    const onlyUnsettled = Boolean($('#debtOnlyUnsettled')?.checked);

    if (search) params.set('search', search);
    if (minOutstanding !== '') params.set('minOutstanding', minOutstanding);
    params.set('scope', scope === 'range' ? 'range' : 'all');
    params.set('range', state.range);
    params.set('onlyUnsettled', onlyUnsettled ? '1' : '0');

    const payload = await fetchJson(`/api/finances/debts?${params.toString()}`);
    console.log('finances debts response', payload);

    state.debtRows = Array.isArray(payload?.rows) ? payload.rows : [];
    state.debtTotalPages = Math.max(1, Number(payload?.pagination?.totalPages || 1));
    state.debtPage = Math.max(1, Math.min(state.debtPage, state.debtTotalPages));
    state.canSettle = Boolean(payload?.permissions?.canSettle);
    state.debtsLoaded = true;

    if (state.debtPage !== requestedPage) {
      await loadDebts(state);
      return;
    }

    setDebtsSummary(payload?.totals || {});
    renderDebtsRows(state);
    renderDebtsPagination(state);
    clearFeedback();
  } catch (error) {
    console.error('finances debts fetch error', error);
    const tbody = $('#financeDebtsBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="7">Unable to load debts data.</td></tr>';
    setDebtsSummary({ unsettledOutstanding: 0, unsettledVoyages: 0, uniqueOotw: 0 });
    renderDebtsPagination({ debtPage: 1, debtTotalPages: 1 });
    setFeedback(`Failed to load debt data: ${error.message || 'Unknown error'}`, 'error', async () => loadDebts(state));
  } finally {
    state.debtsLoading = false;
  }
}

function renderAuditSkeleton() {
  const tbody = $('#financeAuditBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6"><div class="finance-chart-skeleton"></div></td></tr>';
}

function renderAuditRows(state) {
  const tbody = $('#financeAuditBody');
  if (!tbody) return;

  const rows = Array.isArray(state.auditRows) ? state.auditRows : [];
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="6">No settlement actions recorded yet.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map(
      (row) => `<tr>
        <td>${formatWhen(row.createdAt)}</td>
        <td>${text(row.vesselName)} | ${text(row.vesselCallsign)}</td>
        <td>${text(row.departurePort)} \u2192 ${text(row.destinationPort)}</td>
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
  const currentPage = Math.max(1, Number(state.auditPage || 1));
  const totalPages = Math.max(1, Number(state.auditTotalPages || 1));

  if (info) info.textContent = `Page ${currentPage} of ${totalPages}`;
  if (prev) prev.disabled = currentPage <= 1;
  if (next) next.disabled = currentPage >= totalPages;
}

async function loadAudit(state) {
  state.auditLoading = true;
  renderAuditSkeleton();

  try {
    const requestedPage = state.auditPage;
    const params = new URLSearchParams();
    params.set('page', String(state.auditPage));
    params.set('pageSize', String(state.auditPageSize));

    const settledBy = ($('#auditSettledBy')?.value || '').trim();
    let dateFrom = ($('#auditDateFrom')?.value || '').trim();
    let dateTo = ($('#auditDateTo')?.value || '').trim();

    if (!dateFrom && !dateTo) {
      const windowRange = rangeWindow(state.range);
      dateFrom = toDateInputValue(windowRange.start);
      dateTo = toDateInputValue(windowRange.end);
    }

    if (settledBy) params.set('settledBy', settledBy);
    if (dateFrom) params.set('dateFrom', dateFrom);
    if (dateTo) params.set('dateTo', dateTo);

    const payload = await fetchJson(`/api/finances/audit?${params.toString()}`);
    console.log('finances audit response', payload);

    state.auditRows = Array.isArray(payload?.rows) ? payload.rows : [];
    state.auditTotalPages = Math.max(1, Number(payload?.pagination?.totalPages || 1));
    state.auditPage = Math.max(1, Math.min(state.auditPage, state.auditTotalPages));
    state.auditLoaded = true;

    if (state.auditPage !== requestedPage) {
      await loadAudit(state);
      return;
    }

    renderAuditRows(state);
    renderAuditPagination(state);
    clearFeedback();
  } catch (error) {
    console.error('finances audit fetch error', error);
    const tbody = $('#financeAuditBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="6">Unable to load audit data.</td></tr>';
    renderAuditPagination({ auditPage: 1, auditTotalPages: 1 });
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
    const [current, previous] = await Promise.all([
      fetchJson(`/api/finances/overview?range=${encodeURIComponent(state.range)}&unsettledScope=range`),
      fetchJson(`/api/finances/overview?range=${encodeURIComponent(state.range)}&unsettledScope=range&offset=1`)
    ]);
    console.log('finances overview response', current);

    state.overview = current || {};
    state.overviewPrevious = previous || {};
    renderOverview(state.overview, state.overviewPrevious, state.range, state.breakdownMode);
    clearFeedback();

    if (state.debtsLoaded && ($('#debtScope')?.value || 'all') === 'range') {
      state.debtPage = 1;
      await loadDebts(state);
    }

    if (state.auditLoaded) {
      state.auditPage = 1;
      await loadAudit(state);
    }
  } catch (error) {
    console.error('finances overview fetch error', error);
    setFeedback(`Failed to load finance data: ${error.message || 'Unknown error'}`, 'error', async () => loadOverview(state));
  } finally {
    state.overviewLoading = false;
  }
}

function closeSettleModal(state) {
  state.pendingSettle = null;
  const modal = $('#financeSettleModal');
  if (modal) modal.classList.add('hidden');

  const confirm = $('#financeSettleConfirm');
  if (confirm) {
    confirm.disabled = false;
    confirm.textContent = 'Confirm Settlement';
  }
}

async function confirmSettlePendingVoyage(state) {
  const pending = state.pendingSettle;
  if (!pending?.voyageId) return;

  const confirm = $('#financeSettleConfirm');
  if (confirm) {
    confirm.disabled = true;
    confirm.textContent = 'Settling...';
  }

  try {
    await fetchJson(`/api/finances/debts/${encodeURIComponent(String(pending.voyageId))}/settle`, { method: 'POST' });
    closeSettleModal(state);
    setFeedback('Company share marked as settled.', 'success');

    if (state.activeTab === 'debts' || state.debtsLoaded) {
      await loadDebts(state);
    }
    await loadOverview(state);
  } catch (error) {
    console.error('finances settle error', error);
    setFeedback(error.message || 'Failed to settle voyage debt.', 'error');
    closeSettleModal(state);
  }
}

async function handleTabChange(state, tab) {
  const next = normalizeFinanceTab(tab);
  state.activeTab = next;
  setActiveTab(next);
  updateUrlState(state);

  if ((next === 'overview' || next === 'trends') && !state.overview && !state.overviewLoading) {
    await loadOverview(state);
    return;
  }

  if (next === 'debts' && !state.debtsLoaded && !state.debtsLoading) {
    await loadDebts(state);
    return;
  }

  if (next === 'audit' && !state.auditLoaded && !state.auditLoading) {
    await loadAudit(state);
  }
}

async function init() {
  renderIcons();
  document.documentElement.classList.add('intranet-no-scroll');
  document.body.classList.add('intranet-no-scroll');

  const query = new URL(window.location.href).searchParams;
  const state = {
    session: null,
    range: normalizeFinanceRange(query.get('range')),
    activeTab: normalizeFinanceTab(query.get('tab')),
    breakdownMode: normalizeBreakdownMode(query.get('breakdown')),
    overview: null,
    overviewPrevious: null,
    overviewLoading: false,
    debtsLoaded: false,
    debtsLoading: false,
    debtRows: [],
    debtPage: 1,
    debtPageSize: 10,
    debtTotalPages: 1,
    canSettle: false,
    auditLoaded: false,
    auditLoading: false,
    auditRows: [],
    auditPage: 1,
    auditPageSize: 12,
    auditTotalPages: 1,
    pendingSettle: null
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
  updateUrlState(state);

  $$('[data-finance-range]').forEach((button) => {
    button.addEventListener('click', async () => {
      const range = normalizeFinanceRange(button.getAttribute('data-finance-range'));
      if (state.range === range && state.overview) return;
      state.range = range;
      setActiveRange(range);
      updateUrlState(state);
      await loadOverview(state);
    });
  });

  $$('[data-finance-tab]').forEach((button) => {
    button.addEventListener('click', async () => {
      await handleTabChange(state, button.getAttribute('data-finance-tab') || 'overview');
    });
  });

  $$('[data-finance-open-tab]').forEach((link) => {
    link.addEventListener('click', async (event) => {
      event.preventDefault();
      await handleTabChange(state, link.getAttribute('data-finance-open-tab') || 'debts');
    });
  });

  $$('[data-breakdown-mode]').forEach((button) => {
    button.addEventListener('click', () => {
      setBreakdownMode(state, button.getAttribute('data-breakdown-mode') || 'route');
    });
  });

  setBreakdownMode(state, state.breakdownMode);

  const settleModal = $('#financeSettleModal');
  const settleCancel = $('#financeSettleCancel');
  const settleConfirm = $('#financeSettleConfirm');
  if (settleCancel) settleCancel.addEventListener('click', () => closeSettleModal(state));
  if (settleConfirm) settleConfirm.addEventListener('click', async () => confirmSettlePendingVoyage(state));
  if (settleModal) {
    settleModal.addEventListener('click', (event) => {
      if (event.target === settleModal) closeSettleModal(state);
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.pendingSettle) closeSettleModal(state);
  });

  const debtsPrev = $('#financeDebtsPrev');
  const debtsNext = $('#financeDebtsNext');
  if (debtsPrev) {
    debtsPrev.addEventListener('click', async () => {
      if (state.debtPage <= 1 || state.debtsLoading) return;
      state.debtPage -= 1;
      await loadDebts(state);
    });
  }
  if (debtsNext) {
    debtsNext.addEventListener('click', async () => {
      if (state.debtPage >= state.debtTotalPages || state.debtsLoading) return;
      state.debtPage += 1;
      await loadDebts(state);
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
  const debtOnlyUnsettled = $('#debtOnlyUnsettled');
  if (debtSearch) debtSearch.addEventListener('input', scheduleDebtReload);
  if (debtMin) debtMin.addEventListener('input', scheduleDebtReload);
  if (debtScope) debtScope.addEventListener('change', scheduleDebtReload);
  if (debtOnlyUnsettled) debtOnlyUnsettled.addEventListener('change', scheduleDebtReload);

  const auditPrev = $('#financeAuditPrev');
  const auditNext = $('#financeAuditNext');
  if (auditPrev) {
    auditPrev.addEventListener('click', async () => {
      if (state.auditPage <= 1 || state.auditLoading) return;
      state.auditPage -= 1;
      await loadAudit(state);
    });
  }
  if (auditNext) {
    auditNext.addEventListener('click', async () => {
      if (state.auditPage >= state.auditTotalPages || state.auditLoading) return;
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

  if (state.activeTab === 'debts') {
    await loadDebts(state);
  } else if (state.activeTab === 'audit') {
    await loadAudit(state);
  }
}

init().catch((error) => {
  console.error('finances init error', error);
  setFeedback(`Failed to load finance module: ${error.message || 'Unknown error'}`, 'error');
});
