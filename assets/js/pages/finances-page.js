import { hasPermission, performLogout, renderIntranetNavbar } from '../modules/nav.js?v=20260222a';
import { dateInputToUtcIso, formatLocalDateTime, getClientTimezoneOffsetMinutes } from '../modules/local-datetime.js';

function $(selector) {
  return document.querySelector(selector);
}

function $$(selector) {
  return [...document.querySelectorAll(selector)];
}

const RANGE_KEYS = ['week', 'month', '3m', '6m', 'year', 'all'];
const TAB_KEYS = ['overview', 'trends', 'debts', 'cashflow'];
const BREAKDOWN_KEYS = ['route', 'vessel', 'ootw'];
const CLIENT_TZ_OFFSET_MINUTES = getClientTimezoneOffsetMinutes();

const FINANCE_ICONS = {
  'trending-up':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 17l6-6 4 4 7-7"/><path d="M14 8h6v6"/></svg>',
  building:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h2M11 7h2M15 7h2M7 11h2M11 11h2M15 11h2M10 21v-4h4v4"/></svg>',
  hourglass:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 2h12M6 22h12"/><path d="M8 2v5a4 4 0 0 0 2 3.5L12 12l-2 1.5A4 4 0 0 0 8 17v5M16 2v5a4 4 0 0 1-2 3.5L12 12l2 1.5A4 4 0 0 1 16 17v5"/></svg>',
  fish:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12c2.2-3.2 5.2-5 8.8-5 2.5 0 4.8.8 6.7 2.4l2.5-2.4v10l-2.5-2.4A10.3 10.3 0 0 0 12.8 17c-3.6 0-6.6-1.8-8.8-5Z"/><path d="M8.2 9.8c1.2.4 2.1 1.2 2.8 2.2-.7 1-1.6 1.8-2.8 2.2"/><circle cx="12.9" cy="10.3" r="0.9" fill="currentColor" stroke="none"/></svg>',
  'check-circle':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="m9 12 2 2 4-4"/></svg>',
  cloud:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.5 19a4.5 4.5 0 1 0-1.2-8.84A6 6 0 1 0 6 18.5h11.5z"/></svg>',
  clock:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  wallet:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2.5" y="6" width="19" height="14" rx="2"/><path d="M16 12h5.5"/><path d="M7 6V4.8a1.8 1.8 0 0 1 2.7-1.56L14 6"/></svg>',
  'arrow-up-right':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 17 17 7"/><path d="M8 7h9v9"/></svg>',
  'arrow-down-right':
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 7 17 17"/><path d="M8 17h9V8"/></svg>',
  activity:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 12h4l2-4 4 8 2-4h6"/></svg>',
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanSerial(value) {
  const output = String(value ?? '').trim();
  if (!output) return '';
  if (output.toUpperCase() === 'N/A') return '';
  return output;
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
  return formatLocalDateTime(value, { fallback: text(value) });
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00`).getTime();
  if (/^\d{4}-\d{2}$/.test(raw)) return new Date(`${raw}-01T00:00:00`).getTime();
  const parsed = new Date(raw).getTime();
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatDateLabel(value, fallbackLabel = '') {
  const raw = String(value || '').trim();
  if (!raw) return text(fallbackLabel);

  let monthly = false;
  let date = null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    date = new Date(`${raw}T00:00:00`);
  } else if (/^\d{4}-\d{2}$/.test(raw)) {
    monthly = true;
    date = new Date(`${raw}-01T00:00:00`);
  } else {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) date = parsed;
  }

  if (!date || Number.isNaN(date.getTime())) return text(fallbackLabel || raw);
  if (monthly) {
    return date.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  }
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function parseFinanceDate(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00Z`);
  if (/^\d{4}-\d{2}$/.test(raw)) return new Date(`${raw}-01T00:00:00Z`);
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}$/.test(raw)) {
    return new Date(raw.replace(' ', 'T') + 'Z');
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toDayBucketKey(value) {
  const parsed = parseFinanceDate(value);
  if (!parsed || Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function startOfUtcWeek(date) {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0));
  const day = next.getUTCDay();
  const delta = day === 0 ? -6 : 1 - day;
  next.setUTCDate(next.getUTCDate() + delta);
  return next;
}

function addUtcDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function bucketForRange(date, range, anchorStart) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;

  if (range === 'week' || range === 'month') {
    const key = date.toISOString().slice(0, 10);
    return { key, label: key };
  }

  if (range === '3m' || range === '6m') {
    const stepDays = range === '3m' ? 7 : 14;
    const anchor = startOfUtcWeek(anchorStart || date);
    const weekStart = startOfUtcWeek(date);
    const diffDays = Math.max(0, Math.floor((weekStart.getTime() - anchor.getTime()) / 86400000));
    const steppedDays = Math.floor(diffDays / stepDays) * stepDays;
    const bucketStart = addUtcDays(anchor, steppedDays);
    const key = bucketStart.toISOString().slice(0, 10);
    return { key, label: key };
  }

  const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  return { key, label: key };
}

function aggregateTrendForRange(series, range, mode = 'sum') {
  const rows = Array.isArray(series) ? series : [];
  const viewport = rangeWindow(range);
  const anchorStart = new Date(Date.UTC(viewport.start.getFullYear(), viewport.start.getMonth(), viewport.start.getDate(), 0, 0, 0, 0));
  const map = new Map();

  rows.forEach((point) => {
    const parsed = parseFinanceDate(point?.key || point?.label || '');
    const bucketInfo = bucketForRange(parsed, range, anchorStart);
    if (!bucketInfo?.key) return;
    if (!map.has(bucketInfo.key)) {
      map.set(bucketInfo.key, { key: bucketInfo.key, label: bucketInfo.label, sum: 0, count: 0, last: 0 });
    }
    const bucket = map.get(bucketInfo.key);
    bucket.sum += Number(point?.value || 0);
    bucket.count += 1;
    bucket.last = Number(point?.value || 0);
  });

  return [...map.values()]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      value:
        mode === 'avg'
          ? toMoney(bucket.sum / Math.max(1, bucket.count))
          : mode === 'last'
          ? toMoney(bucket.last)
          : toMoney(bucket.sum)
    }));
}

function sumSeriesValues(series) {
  return toMoney((Array.isArray(series) ? series : []).reduce((sum, point) => sum + Number(point?.value || 0), 0));
}

function normalizeOverviewChartsForRange(data, range) {
  if (!data || typeof data !== 'object') return data;
  const charts = data.charts || {};
  const netProfitTrend = aggregateTrendForRange(charts.netProfitTrend || [], range, 'sum');
  const companyShareTrend = aggregateTrendForRange(charts.companyShareTrend || [], range, 'sum');
  const voyageCountTrend = aggregateTrendForRange(charts.voyageCountTrend || [], range, 'sum');
  const freightLossValueTrend = aggregateTrendForRange(charts.freightLossValueTrend || [], range, 'sum');
  const grossRevenueTrend = aggregateTrendForRange(charts.grossRevenueTrend || [], range, 'sum');
  const outstandingTrend = aggregateTrendForRange(charts.outstandingTrend || companyShareTrend, range, 'last');
  const avgNetProfitTrend = netProfitTrend.map((point, index) => ({
    key: point.key,
    label: point.label,
    value:
      Number(voyageCountTrend[index]?.value || 0) > 0
        ? toMoney(Number(point.value || 0) / Math.max(1, Number(voyageCountTrend[index]?.value || 0)))
        : toMoney(point.value || 0)
  }));

  const grossRevenueTotal = sumSeriesValues(grossRevenueTrend);
  const netProfitTotal = sumSeriesValues(netProfitTrend);
  const companyShareTotal = Number(data?.kpis?.companyShareEarnings || 0);

  return {
    ...data,
    kpis: {
      ...(data?.kpis || {}),
      grossRevenue: grossRevenueTotal,
      netProfit: netProfitTotal,
      crewShare: Math.max(0, toMoney(grossRevenueTotal - companyShareTotal))
    },
    charts: {
      ...charts,
      netProfitTrend,
      companyShareTrend,
      voyageCountTrend,
      freightLossValueTrend,
      grossRevenueTrend,
      avgNetProfitTrend,
      outstandingTrend
    }
  };
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
    const error = new Error(payload.error || `Request failed (${response.status})`);
    error.status = Number(response.status || 0);
    error.payload = payload;
    throw error;
  }

  return payload;
}

async function fetchJsonWithFallback(urls, options = {}) {
  const candidates = (Array.isArray(urls) ? urls : [urls]).map((value) => String(value || '').trim()).filter(Boolean);
  if (!candidates.length) {
    throw new Error('Invalid request path.');
  }
  let lastError = null;
  for (let index = 0; index < candidates.length; index += 1) {
    try {
      return await fetchJson(candidates[index], options);
    } catch (error) {
      lastError = error;
      const status = Number(error?.status || 0);
      const retryable = status === 404 || status === 429 || status >= 500;
      const isFinal = index >= candidates.length - 1;
      if (!retryable || isFinal) break;
      await new Promise((resolve) => window.setTimeout(resolve, 180));
    }
  }
  throw lastError || new Error('Request failed');
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
    // Force visibility state to avoid legacy CSS collisions between tab panels.
    panel.style.setProperty('display', isActive ? 'grid' : 'none', 'important');
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
  if (range === 'all') return 'all time';
  return 'last year';
}

function toDelta(current, previous, range, invertDirection = false) {
  const now = Number(current || 0);
  const prev = Number(previous || 0);
  const diff = now - prev;
  const label = previousRangeLabel(range);

  if (prev === 0 && now === 0) {
    return { text: `\u2022 0% vs ${label}`, tone: 'neutral' };
  }

  if (prev === 0) {
    const tone = invertDirection ? 'negative' : 'positive';
    const icon = '\u25B2';
    return { text: `${icon} New vs ${label}`, tone };
  }

  const percent = Math.round((diff / Math.abs(prev)) * 100);
  const value = Math.abs(percent);
  const icon = percent > 0 ? '\u25B2' : percent < 0 ? '\u25BC' : '\u2022';
  let tone = percent > 0 ? 'positive' : percent < 0 ? 'negative' : 'neutral';
  if (invertDirection && tone !== 'neutral') {
    tone = tone === 'positive' ? 'negative' : 'positive';
  }
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
  const now = new Date();
  const start = new Date(now);
  const end = new Date(now);

  if (range === 'week') {
    const day = now.getDay();
    const mondayDelta = day === 0 ? -6 : 1 - day;
    start.setDate(now.getDate() + mondayDelta);
    end.setDate(start.getDate() + 4);
  } else if (range === 'month') {
    start.setDate(1);
    end.setMonth(now.getMonth() + 1, 0);
  } else if (range === '3m') {
    start.setMonth(now.getMonth() - 2, 1);
    end.setMonth(now.getMonth() + 1, 0);
  } else if (range === '6m') {
    start.setMonth(now.getMonth() - 5, 1);
    end.setMonth(now.getMonth() + 1, 0);
  } else if (range === 'year') {
    start.setMonth(0, 1);
    end.setMonth(11, 31);
  } else {
    start.setFullYear(1970, 0, 1);
  }

  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

function toDateInputValue(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function chartViewport(target, options = {}) {
  const baseWidth = Number(options.width || 760);
  const baseHeight = Number(options.height || 340);
  const rect = target?.getBoundingClientRect?.() || { width: 0, height: 0 };
  const width = Math.max(320, Math.round(rect.width || baseWidth));
  const height = Math.max(220, Math.round(rect.height || baseHeight));
  return { width, height };
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

  const { width, height } = chartViewport(target, options);
  const valueFormatter = typeof options.valueFormatter === 'function' ? options.valueFormatter : formatGuilders;
  const tickFormatter = typeof options.tickFormatter === 'function' ? options.tickFormatter : valueFormatter;

  const marginTop = Number(options.marginTop || 10);
  const marginRight = Number(options.marginRight || 16);
  const marginBottom = Number(options.marginBottom || 46);
  const marginLeft = Number(options.marginLeft || 54);

  const plotLeft = marginLeft;
  const plotRight = width - marginRight;
  const plotTop = marginTop;
  const plotBottom = height - marginBottom;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = Math.max(1, plotBottom - plotTop);
  const steps = Math.max(points.length - 1, 1);
  const nonZeroPoints = safeLines.reduce(
    (sum, line) => sum + line.points.filter((point) => toMoney(point?.value || 0) !== 0).length,
    0
  );
  const sparseSeries = nonZeroPoints <= Math.max(2, safeLines.length);
  const lineStrokeWidth = sparseSeries ? 3 : 2.2;
  const pointRadius = sparseSeries ? 4.2 : 3.2;

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
      return `<text class="finance-axis-x-label" x="${x}" y="${height - 26}" text-anchor="middle">${text(point.label)}</text>`;
    })
    .join('');

  const linePaths = safeLines
    .map((line) => {
      const path = line.points.map((point, idx) => `${idx === 0 ? 'M' : 'L'} ${xAt(idx)} ${yAt(point.value)}`).join(' ');
      return `<path class="finance-line-path" d="${path}" stroke="${line.color}" stroke-width="${lineStrokeWidth}" fill="none"></path>`;
    })
    .join('');

  const pointMarkers = safeLines
    .map((line, lineIndex) =>
      line.points
        .map(
          (point, idx) =>
            `<circle class="finance-line-point" data-line="${lineIndex}" data-index="${idx}" cx="${xAt(idx)}" cy="${yAt(point.value)}" r="${pointRadius}" fill="${line.color}"></circle>`
        )
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

    tooltip.innerHTML = `<div class="finance-tooltip-title">${text(points[idx].tooltipLabel || points[idx].label)}</div>${linesHtml}`;
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

  const { width, height } = chartViewport(target, options);
  const valueFormatter = typeof options.valueFormatter === 'function' ? options.valueFormatter : formatInteger;
  const tickFormatter = typeof options.tickFormatter === 'function' ? options.tickFormatter : valueFormatter;

  const marginTop = Number(options.marginTop || 10);
  const marginRight = Number(options.marginRight || 16);
  const marginBottom = Number(options.marginBottom || 44);
  const marginLeft = Number(options.marginLeft || 52);

  const plotLeft = marginLeft;
  const plotRight = width - marginRight;
  const plotTop = marginTop;
  const plotBottom = height - marginBottom;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = Math.max(1, plotBottom - plotTop);

  const values = points.map((point) => Math.max(0, toMoney(point.value)));
  const maxValue = Math.max(1, ...values);
  const nonZeroBars = values.filter((value) => value > 0).length;
  const sparseBars = points.length >= 4 && nonZeroBars <= 1;

  const yTicks = 5;
  const tickValues = Array.from({ length: yTicks }, (_, idx) => {
    const ratio = idx / (yTicks - 1);
    return Math.round(maxValue - ratio * maxValue);
  });

  const yAt = (value) => plotTop + ((maxValue - value) / maxValue) * plotHeight;
  const band = plotWidth / points.length;
  const barWidth = sparseBars ? Math.max(20, Math.min(64, band * 0.78)) : Math.max(10, Math.min(42, band * 0.66));

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
      return `<text class="finance-axis-x-label" x="${x}" y="${height - 26}" text-anchor="middle">${text(point.label)}</text>`;
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

function renderCartesianHorizontalBarChart(target, series, label, color, options = {}) {
  if (!target) return;
  const points = normalizeSeriesPoints(series);
  if (!points.length) {
    target.innerHTML = '<div class="finance-chart-empty">No data for selected range</div>';
    return;
  }

  const { width, height } = chartViewport(target, options);
  const valueFormatter = typeof options.valueFormatter === 'function' ? options.valueFormatter : formatInteger;
  const tickFormatter = typeof options.tickFormatter === 'function' ? options.tickFormatter : valueFormatter;

  const marginTop = Number(options.marginTop || 12);
  const marginRight = Number(options.marginRight || 20);
  const marginBottom = Number(options.marginBottom || 30);
  const marginLeft = Number(options.marginLeft || 128);

  const plotLeft = marginLeft;
  const plotRight = width - marginRight;
  const plotTop = marginTop;
  const plotBottom = height - marginBottom;
  const plotWidth = Math.max(1, plotRight - plotLeft);
  const plotHeight = Math.max(1, plotBottom - plotTop);

  const values = points.map((point) => Math.max(0, toMoney(point.value)));
  const maxValue = Math.max(1, ...values);

  const xTicks = 5;
  const tickValues = Array.from({ length: xTicks }, (_, idx) => {
    const ratio = idx / (xTicks - 1);
    return Math.round(ratio * maxValue);
  });

  const xAt = (value) => plotLeft + (Math.max(0, value) / maxValue) * plotWidth;
  const band = plotHeight / points.length;
  const barHeight = Math.max(12, Math.min(44, band * 0.68));

  const xGrid = tickValues
    .map((tick) => {
      const x = xAt(tick);
      return `<g>
        <line class="finance-grid-line" x1="${x}" y1="${plotTop}" x2="${x}" y2="${plotBottom}"></line>
        <text class="finance-axis-x-label" x="${x}" y="${height - 16}" text-anchor="middle">${text(tickFormatter(tick))}</text>
      </g>`;
    })
    .join('');

  const yLabels = points
    .map((point, idx) => {
      const y = plotTop + (idx + 0.5) * band + 4;
      return `<text class="finance-axis-y-label" x="${plotLeft - 10}" y="${y}" text-anchor="end">${text(point.label)}</text>`;
    })
    .join('');

  const bars = points
    .map((point, idx) => {
      const value = Math.max(0, toMoney(point.value));
      const y = plotTop + idx * band + (band - barHeight) / 2;
      const w = Math.max(1, xAt(value) - plotLeft);
      return `<rect class="finance-hbar-rect" data-index="${idx}" x="${plotLeft}" y="${y}" width="${w}" height="${barHeight}" rx="4" fill="${color}"></rect>`;
    })
    .join('');

  target.innerHTML = `
    <div class="finance-chart-shell">
      <svg class="finance-cartesian-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
        <rect x="${plotLeft}" y="${plotTop}" width="${plotWidth}" height="${plotHeight}" fill="#ffffff"></rect>
        ${xGrid}
        <line class="finance-axis-line" x1="${plotLeft}" y1="${plotBottom}" x2="${plotRight}" y2="${plotBottom}"></line>
        <line class="finance-axis-line" x1="${plotLeft}" y1="${plotTop}" x2="${plotLeft}" y2="${plotBottom}"></line>
        ${bars}
        ${yLabels}
      </svg>
      <div class="finance-chart-legend"><span class="finance-legend-item"><i style="background:${color}"></i>${text(label)}</span></div>
      <div class="finance-chart-tooltip hidden"></div>
    </div>
  `;

  const shell = target.querySelector('.finance-chart-shell');
  const tooltip = target.querySelector('.finance-chart-tooltip');
  if (!shell || !tooltip) return;

  shell.querySelectorAll('.finance-hbar-rect').forEach((bar) => {
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

function renderLineChart(target, series, lineLabel, color, options = {}) {
  if (target) target.classList.remove('is-empty');
  const points = normalizeSeriesPoints(series);
  renderCartesianLineChart(target, [{ label: lineLabel, color, points }], {
    valueFormatter: formatGuilders,
    tickFormatter: formatGuildersCompact,
    ...options
  });
}

function renderCurrencyBarChart(target, series, label, color, options = {}) {
  if (target) target.classList.remove('is-empty');
  renderCartesianBarChart(target, series, label, color, {
    valueFormatter: formatGuilders,
    tickFormatter: formatGuildersCompact,
    ...options
  });
}

function renderCountBarChart(target, series, label, color, options = {}) {
  if (target) target.classList.remove('is-empty');
  renderCartesianBarChart(target, series, label, color, {
    valueFormatter: (value) => formatInteger(value),
    tickFormatter: (value) => formatInteger(value),
    ...options
  });
}

function renderCurrencyHorizontalBarChart(target, series, label, color, options = {}) {
  if (target) target.classList.remove('is-empty');
  renderCartesianHorizontalBarChart(target, series, label, color, {
    valueFormatter: formatGuilders,
    tickFormatter: formatGuildersCompact,
    ...options
  });
}

function renderSellLocationPieChart(target, rows) {
  if (!target) return;
  const safeRows = (Array.isArray(rows) ? rows : [])
    .map((row) => ({ label: text(row?.label || 'Unknown'), netProfit: Math.max(0, toMoney(row?.netProfit || 0)) }))
    .filter((row) => row.netProfit > 0)
    .sort((a, b) => b.netProfit - a.netProfit || a.label.localeCompare(b.label))
    .slice(0, 6);

  if (!safeRows.length) {
    renderNoData(target, 'No profit drivers in this period');
    return;
  }

  const total = safeRows.reduce((sum, row) => sum + row.netProfit, 0);
  if (total <= 0) {
    renderNoData(target, 'No profit drivers in this period');
    return;
  }

  const colors = ['#1d4ed8', '#0891b2', '#16a34a', '#ca8a04', '#dc2626', '#7c3aed'];
  const cx = 145;
  const cy = 108;
  const r = 62;
  const ringWidth = 22;
  const circumference = 2 * Math.PI * r;

  let offset = 0;
  const segments = safeRows
    .map((row, index) => {
      const pct = row.netProfit / total;
      const dash = Math.max(0, pct * circumference);
      const currentOffset = offset;
      offset += dash;
      const color = colors[index % colors.length];
      return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${ringWidth}" stroke-dasharray="${dash} ${Math.max(
        0,
        circumference - dash
      )}" stroke-dashoffset="${-currentOffset}" transform="rotate(-90 ${cx} ${cy})"></circle>`;
    })
    .join('');

  const legend = safeRows
    .map((row, index) => {
      const color = colors[index % colors.length];
      const pctRaw = (row.netProfit / total) * 100;
      const pct = pctRaw > 0 && pctRaw < 1 ? '<1' : String(Math.round(pctRaw));
      return `<li class="finance-pie-legend-item">
        <span class="finance-pie-legend-dot" style="background:${color}"></span>
        <span class="finance-pie-legend-label">${text(row.label)}</span>
        <strong class="finance-pie-legend-value">${pct}% (${formatGuilders(row.netProfit)})</strong>
      </li>`;
    })
    .join('');

  target.innerHTML = `
    <div class="finance-pie-wrap">
      <svg class="finance-pie-svg" viewBox="0 0 290 250" aria-label="Sell location profit share pie chart">
        ${segments}
        <circle cx="${cx}" cy="${cy}" r="40" fill="#fff"></circle>
        <text x="${cx}" y="${cy - 4}" text-anchor="middle" class="finance-pie-center-label">Total</text>
        <text x="${cx}" y="${cy + 18}" text-anchor="middle" class="finance-pie-center-value">${formatGuilders(total)}</text>
      </svg>
      <ul class="finance-pie-legend">${legend}</ul>
    </div>
  `;
}

function renderPercentLineChart(target, series, lineLabel, color) {
  if (target) target.classList.remove('is-empty');
  const points = normalizeSeriesPoints(series);
  renderCartesianLineChart(target, [{ label: lineLabel, color, points }], {
    valueFormatter: (value) => formatPercent(value),
    tickFormatter: (value) => formatPercent(value)
  });
}

function renderNoData(target, message) {
  if (!target) return;
  target.classList.add('is-empty');
  target.innerHTML = `
    <div class="finance-chart-empty">
      <div class="finance-empty-state-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 16 9 11l3 3 8-8"></path>
          <path d="M18 6h2v2"></path>
        </svg>
      </div>
      <p class="finance-empty-state-title">${text(message || 'No data for selected range')}</p>
      <p class="finance-empty-state-copy">Data will appear here once voyages and settlements are recorded.</p>
    </div>
  `;
}

function renderProfitDriversChart(target, breakdowns, mode) {
  const safeMode = normalizeBreakdownMode(mode);
  const source =
    safeMode === 'vessel'
      ? breakdowns?.byVessel
      : safeMode === 'ootw'
      ? breakdowns?.byOotw
      : breakdowns?.bySellLocation || breakdowns?.byRoute;
  const rawRows = Array.isArray(source) ? source : [];
  const rows = rawRows
    .map((row) => ({ label: text(row?.label || 'Unknown'), netProfit: toMoney(row?.netProfit || 0) }))
    .sort((a, b) => b.netProfit - a.netProfit || a.label.localeCompare(b.label));

  if (!rows.length) {
    renderNoData(target, 'No profit drivers in this period');
    return;
  }

  if (safeMode === 'route') {
    renderSellLocationPieChart(target, rows);
    return;
  }

  const topRows = rows.slice(0, 5);
  const shouldShowOther = safeMode !== 'vessel' && safeMode !== 'ootw';
  const otherTotal = rows.slice(5).reduce((sum, row) => toMoney(sum + toMoney(row.netProfit || 0)), 0);
  const plottedRows = shouldShowOther && otherTotal !== 0 ? [...topRows, { label: 'Other', netProfit: otherTotal }] : topRows;

  const points = plottedRows.map((row, index) => {
    const fullLabel = text(row?.label || 'Unknown');
    return {
      key: `rank-${index + 1}`,
      label: truncateLabel(fullLabel, 18),
      tooltipLabel: fullLabel,
      value: toMoney(row?.netProfit || 0)
    };
  });

  const legendLabel =
    safeMode === 'vessel' ? 'Profit by Vessel' : safeMode === 'ootw' ? 'Profit by Employee' : 'Profit by Sell Location';
  renderCurrencyHorizontalBarChart(target, points, legendLabel, '#2b4aa2', {
    marginTop: 10,
    marginRight: 20,
    marginBottom: 34,
    marginLeft: 132
  });
}

function renderProfitDriversTable(target, breakdowns, mode) {
  if (!target) return;
  const safeMode = normalizeBreakdownMode(mode);
  const source =
    safeMode === 'vessel'
      ? breakdowns?.byVessel
      : safeMode === 'ootw'
      ? breakdowns?.byOotw
      : breakdowns?.bySellLocation || breakdowns?.byRoute;
  const rawRows = Array.isArray(source) ? source : [];

  const rows = rawRows
    .map((row) => ({ label: text(row?.label || 'Unknown'), netProfit: toMoney(row?.netProfit || 0) }))
    .sort((a, b) => b.netProfit - a.netProfit || a.label.localeCompare(b.label))
    .slice(0, 5);

  if (!rows.length) {
    target.innerHTML = '<div class="finance-inline-caption">No profit driver data in this period.</div>';
    return;
  }

  target.innerHTML = `
    <table class="finance-profit-driver-table">
      <thead>
        <tr>
          <th>Top ${safeMode === 'vessel' ? 'Vessels' : safeMode === 'ootw' ? 'Employees' : 'Sell Locations'}</th>
          <th class="align-right">Net Profit</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map(
            (row) => `<tr>
              <td>${text(row.label)}</td>
              <td class="align-right">${formatGuilders(row.netProfit)}</td>
            </tr>`
          )
          .join('')}
      </tbody>
    </table>
  `;
}

function alignProfitLossSeries(profitSeries, lossSeries) {
  const profitPoints = normalizeSeriesPoints(profitSeries);
  const lossPoints = normalizeSeriesPoints(lossSeries);
  const byKey = new Map();

  profitPoints.forEach((point) => {
    byKey.set(point.key, {
      key: point.key,
      label: point.label,
      parsedTime: point.parsedTime,
      profit: point.value,
      loss: 0
    });
  });

  lossPoints.forEach((point) => {
    const existing = byKey.get(point.key);
    if (existing) {
      existing.loss = point.value;
      if (!existing.label) existing.label = point.label;
      return;
    }
    byKey.set(point.key, {
      key: point.key,
      label: point.label,
      parsedTime: point.parsedTime,
      profit: 0,
      loss: point.value
    });
  });

  return [...byKey.values()].sort((a, b) => {
    const aTime = Number.isFinite(a.parsedTime) ? a.parsedTime : Number.POSITIVE_INFINITY;
    const bTime = Number.isFinite(b.parsedTime) ? b.parsedTime : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return a.key.localeCompare(b.key);
  });
}

function renderProfitLossChart(target, profitSeries, lossSeries, options = {}) {
  if (target) target.classList.remove('is-empty');
  const rows = alignProfitLossSeries(profitSeries, lossSeries);
  if (!rows.length) {
    renderNoData(target, 'No data for selected range');
    return;
  }

  const profit = rows.map((row) => ({ key: row.key, label: row.label, value: row.profit }));
  const loss = rows.map((row) => ({ key: row.key, label: row.label, value: row.loss }));

  const hasMovement = [...profit, ...loss].some((point) => toMoney(point.value || 0) !== 0);
  if (!hasMovement) {
    renderNoData(target, 'No profit or loss movement in this period');
    return;
  }

  renderCartesianLineChart(
    target,
    [
      { label: text(options.primaryLabel || 'Net Profit'), color: '#15803d', points: profit },
      { label: 'Freight Loss Value', color: '#b91c1c', points: loss }
    ],
    {
      valueFormatter: formatGuilders,
      tickFormatter: formatGuildersCompact
    }
  );
}

function alignNamedSeries(seriesList) {
  const bucketMap = new Map();

  (Array.isArray(seriesList) ? seriesList : []).forEach((series) => {
    const keyName = String(series?.key || '').trim();
    if (!keyName) return;
    const points = normalizeSeriesPoints(series?.points || []);
    points.forEach((point) => {
      if (!bucketMap.has(point.key)) {
        bucketMap.set(point.key, {
          key: point.key,
          label: point.label,
          tooltipLabel: point.tooltipLabel || point.label,
          parsedTime: point.parsedTime,
          values: {}
        });
      }
      const bucket = bucketMap.get(point.key);
      bucket.values[keyName] = toMoney(point.value || 0);
      if (!bucket.label) bucket.label = point.label;
      if (!bucket.tooltipLabel) bucket.tooltipLabel = point.tooltipLabel || point.label;
    });
  });

  return [...bucketMap.values()].sort((a, b) => {
    const aTime = Number.isFinite(a.parsedTime) ? a.parsedTime : Number.POSITIVE_INFINITY;
    const bTime = Number.isFinite(b.parsedTime) ? b.parsedTime : Number.POSITIVE_INFINITY;
    if (aTime !== bTime) return aTime - bTime;
    return a.key.localeCompare(b.key);
  });
}

function renderRevenueProfitLossChart(target, revenueSeries, profitSeries, lossSeries) {
  if (target) target.classList.remove('is-empty');
  const rows = alignNamedSeries([
    { key: 'revenue', points: revenueSeries || [] },
    { key: 'profit', points: profitSeries || [] },
    { key: 'loss', points: lossSeries || [] }
  ]);
  if (!rows.length) {
    renderNoData(target, 'No data for selected range');
    return;
  }

  const revenuePoints = rows.map((row) => ({
    key: row.key,
    label: row.label,
    tooltipLabel: row.tooltipLabel,
    value: toMoney(row.values.revenue || 0)
  }));
  const profitPoints = rows.map((row) => ({
    key: row.key,
    label: row.label,
    tooltipLabel: row.tooltipLabel,
    value: toMoney(row.values.profit || 0)
  }));
  const lossPoints = rows.map((row) => ({
    key: row.key,
    label: row.label,
    tooltipLabel: row.tooltipLabel,
    value: toMoney(row.values.loss || 0)
  }));
  const hasLoss = !isAllZeroSeries(lossPoints);

  const lines = [
    { label: 'Gross Revenue', color: '#1d4ed8', points: revenuePoints },
    { label: 'Net Profit', color: '#15803d', points: profitPoints }
  ];
  if (hasLoss) {
    lines.push({ label: 'Freight Loss Value', color: '#b91c1c', points: lossPoints });
  }

  renderCartesianLineChart(target, lines, {
    valueFormatter: formatGuilders,
    tickFormatter: formatGuildersCompact,
    marginTop: 10,
    marginRight: 16,
    marginBottom: 44,
    marginLeft: 56
  });
}

function isAllZeroSeries(series) {
  const safe = Array.isArray(series) ? series : [];
  if (!safe.length) return true;
  return safe.every((point) => toMoney(point?.value || 0) === 0);
}

function renderOverviewSkeleton() {
  ['#kpiNetProfit', '#kpiCompanyShare', '#kpiEmissions', '#kpiAvgDaysToSettle', '#kpiLossValue'].forEach((selector) => {
    const el = $(selector);
    if (el) el.innerHTML = '<span class="finance-value-skeleton"></span>';
  });

  ['#kpiDeltaNetProfit', '#kpiDeltaCompanyShare', '#kpiDeltaEmissions', '#kpiDeltaLossValue', '#kpiAvgDaysHint'].forEach((selector) => {
    const el = $(selector);
    if (el) el.innerHTML = '<span class="finance-line-skeleton"></span>';
  });

  ['#chartNetProfit', '#trendsChartOutstanding', '#trendsChartVoyageCount', '#trendsChartAvgProfit', '#trendsChartProfitDrivers'].forEach((selector) => {
    const el = $(selector);
    if (el) el.innerHTML = '<div class="finance-chart-skeleton"></div>';
  });

  const driversTable = $('#trendsDriversTable');
  if (driversTable) driversTable.innerHTML = '<div class="finance-chart-skeleton"></div>';

  const unsettledAmount = $('#unsettledOutstandingTotal');
  if (unsettledAmount) unsettledAmount.innerHTML = '<span class="finance-value-skeleton"></span>';

  const unsettledCount = $('#unsettledVoyageCount');
  if (unsettledCount) unsettledCount.innerHTML = '<span class="finance-line-skeleton"></span>';

  ['#overviewCompletedVoyages', '#overviewAvgDaysToSettle', '#overviewOverdueUnsettled'].forEach((selector) => {
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
  const writeCount = (selector, value) => {
    const el = $(selector);
    if (!el) return;
    el.textContent = formatInteger(value || 0);
  };

  const totalEarnings = Number(kpis.grossRevenue || 0);
  const previousTotalEarnings = Number(previousKpis.grossRevenue || 0);

  writeMoney('#kpiNetProfit', totalEarnings);
  writeMoney('#kpiCompanyShare', kpis.companyShareEarnings || 0);
  const totalEmissionsValue = Number.isFinite(Number(kpis.emissionsKg))
    ? Number(kpis.emissionsKg)
    : Number.isFinite(Number(kpis.totalEmissions))
    ? Number(kpis.totalEmissions)
    : Number(kpis.totalFishKilled || 0);
  const previousEmissionsValue = Number.isFinite(Number(previousKpis.emissionsKg))
    ? Number(previousKpis.emissionsKg)
    : Number.isFinite(Number(previousKpis.totalEmissions))
    ? Number(previousKpis.totalEmissions)
    : Number(previousKpis.totalFishKilled || 0);
  writeCount('#kpiEmissions', totalEmissionsValue);
  writeMoney('#kpiLossValue', kpis.freightLossesValue || 0);

  const avgDays = $('#kpiAvgDaysToSettle');
  if (avgDays) avgDays.textContent = kpis.avgDaysToSettle == null ? 'â€”' : `${formatInteger(kpis.avgDaysToSettle)}d`;

  const avgDaysHint = $('#kpiAvgDaysHint');
  if (avgDaysHint) avgDaysHint.textContent = kpis.avgDaysToSettle == null ? 'No settled voyages in range' : 'Settled voyages only';

  setDelta('#kpiDeltaNetProfit', toDelta(totalEarnings, previousTotalEarnings, range));
  setDelta('#kpiDeltaCompanyShare', toDelta(kpis.companyShareEarnings, previousKpis.companyShareEarnings, range));
  setDelta('#kpiDeltaEmissions', toDelta(totalEmissionsValue, previousEmissionsValue, range));
  setDelta('#kpiDeltaLossValue', toDelta(kpis.freightLossesValue, previousKpis.freightLossesValue, range, true));
  const hasVoyages = !isAllZeroSeries(charts.voyageCountTrend || []);
  renderProfitLossChart($('#chartNetProfit'), charts.grossRevenueTrend || [], charts.freightLossValueTrend || [], {
    primaryLabel: 'Total Earnings'
  });

  if (!hasVoyages) {
    renderNoData($('#trendsChartOutstanding'), 'No voyages in this period');
    renderNoData($('#trendsChartVoyageCount'), 'No voyages in this period');
    renderNoData($('#trendsChartAvgProfit'), 'No voyages in this period');
    renderNoData($('#trendsChartProfitDrivers'), 'No voyages in this period');
    renderProfitDriversTable($('#trendsDriversTable'), {}, breakdownMode);
  } else {
    renderRevenueProfitLossChart($('#trendsChartOutstanding'), charts.grossRevenueTrend || [], charts.netProfitTrend || [], charts.freightLossValueTrend || []);
    renderCountBarChart($('#trendsChartVoyageCount'), charts.voyageCountTrend || [], 'Voyage Count', '#253475', {
      marginTop: 10,
      marginRight: 16,
      marginBottom: 44,
      marginLeft: 52
    });
    renderLineChart($('#trendsChartAvgProfit'), charts.avgNetProfitTrend || [], 'Avg Net Profit / Voyage', '#2b4aa2', {
      marginTop: 10,
      marginRight: 16,
      marginBottom: 44,
      marginLeft: 56
    });
    renderProfitDriversChart($('#trendsChartProfitDrivers'), breakdowns, breakdownMode);
    renderProfitDriversTable($('#trendsDriversTable'), breakdowns, breakdownMode);
  }

  const unsettledTotal = $('#unsettledOutstandingTotal');
  if (unsettledTotal) unsettledTotal.textContent = formatGuilders(unsettled.totalOutstanding || 0);

  const unsettledCount = $('#unsettledVoyageCount');
  if (unsettledCount) unsettledCount.textContent = `Unsettled Voyages: ${Number(unsettled.totalVoyages || 0)}`;

  const overviewCompletedVoyages = $('#overviewCompletedVoyages');
  if (overviewCompletedVoyages) overviewCompletedVoyages.textContent = formatInteger(kpis.completedVoyages || 0);
  const overviewAvgDays = $('#overviewAvgDaysToSettle');
  if (overviewAvgDays) overviewAvgDays.textContent = kpis.avgDaysToSettle == null ? 'â€”' : `${formatInteger(kpis.avgDaysToSettle)}d`;
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

  setTop('#topRouteLabel', '#topRouteValue', topPerformers?.sellLocation);
  setTop('#topVesselLabel', '#topVesselValue', topPerformers?.voyage || topPerformers?.vessel);
  setTop('#topOotwLabel', '#topOotwValue', topPerformers?.ootw);
}

function setInlineFeedback(selector, message, type = 'error') {
  const box = $(selector);
  if (!box) return;
  if (!message) {
    box.className = 'feedback';
    box.textContent = '';
    return;
  }
  box.className = `feedback is-visible ${type === 'error' ? 'is-error' : 'is-success'}`;
  box.textContent = message;
}

function normalizeCashflowEntryType(value) {
  const type = String(value || '').trim().toUpperCase();
  return type === 'OUT' ? 'OUT' : 'IN';
}

function setCashflowType(state, type) {
  state.cashflowEntryType = normalizeCashflowEntryType(type);
  const hidden = $('#cashflowType');
  if (hidden) hidden.value = state.cashflowEntryType;
  $$('[data-cashflow-type]').forEach((button) => {
    button.classList.toggle('is-active', button.getAttribute('data-cashflow-type') === state.cashflowEntryType);
  });
}

function setCashflowFormEnabled(canManage) {
  const openButton = $('#cashflowOpenModal');
  if (openButton) {
    openButton.disabled = !canManage;
    openButton.classList.toggle('hidden', !canManage);
  }

  const form = $('#cashflowEntryForm');
  if (!form) return;
  form.querySelectorAll('input, textarea, select, button').forEach((field) => {
    field.disabled = !canManage;
  });
  if (!canManage) {
    closeCashflowModal();
    setInlineFeedback('#cashflowEntryFeedback', 'You do not have permission to add cashflow entries.', 'error');
  } else {
    setInlineFeedback('#cashflowEntryFeedback', '');
  }
}

function openCashflowModal() {
  const modal = $('#cashflowEntryModal');
  if (modal) modal.classList.remove('hidden');
}

function closeCashflowModal() {
  const modal = $('#cashflowEntryModal');
  if (modal) modal.classList.add('hidden');
}

function renderCashflowSkeleton() {
  ['#cashflowKpiIn', '#cashflowKpiOut', '#cashflowKpiNet'].forEach((selector) => {
    const el = $(selector);
    if (el) el.innerHTML = '<span class="finance-value-skeleton"></span>';
  });
  const tbody = $('#financeCashflowBody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8"><div class="finance-chart-skeleton"></div></td></tr>';
  const remittanceBody = $('#financeCollectorRemittancesBody');
  if (remittanceBody) remittanceBody.innerHTML = '<tr><td colspan="3"><div class="finance-chart-skeleton"></div></td></tr>';
}

function renderCashflowPagination(state) {
  const pagination = $('#financeCashflowPagination');
  const pageInfo = $('#financeCashflowPageInfo');
  const prev = $('#financeCashflowPrev');
  const next = $('#financeCashflowNext');
  const rows = Array.isArray(state.cashflowRows) ? state.cashflowRows : [];
  const currentPage = Math.max(1, Number(state.cashflowPage || 1));
  const totalPages = Math.max(1, Number(state.cashflowTotalPages || 1));
  const hasRows = rows.length > 0;

  if (pagination) pagination.classList.toggle('is-hidden', !hasRows);
  if (pageInfo) pageInfo.textContent = hasRows ? `Page ${currentPage} of ${totalPages}` : '';
  if (prev) prev.disabled = !hasRows || currentPage <= 1;
  if (next) next.disabled = !hasRows || currentPage >= totalPages;
}

function renderCashflowVoyageOptions(state) {
  const datalist = $('#cashflowVoyageOptions');
  if (!datalist) return;
  const options = Array.isArray(state.cashflowVoyageOptions) ? state.cashflowVoyageOptions : [];
  state.cashflowVoyageLookup = new Map();
  datalist.innerHTML = options
    .map((row) => {
      const id = Number(row.id || 0);
      if (!id) return '';
      const label = text(row.label);
      const value = `${id} - ${label}`;
      state.cashflowVoyageLookup.set(id, label);
      return `<option value="${value}"></option>`;
    })
    .join('');
}

function parseRelatedVoyageId(value, state) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const match = raw.match(/^(\d+)/);
  if (!match) return null;
  const id = Number(match[1]);
  if (!Number.isInteger(id) || id <= 0) return null;
  if (state.cashflowVoyageLookup?.size && !state.cashflowVoyageLookup.has(id)) return null;
  return id;
}

function renderCashflowRows(state) {
  const tbody = $('#financeCashflowBody');
  if (!tbody) return;
  const rows = Array.isArray(state.cashflowRows) ? state.cashflowRows : [];

  if (!rows.length) {
    tbody.innerHTML = `
      <tr>
        <td colspan="8">
          <div class="finance-table-empty-state">
            <strong>No cashflow entries yet.</strong>
            <span>Create your first ledger record using â€œNew Cashflow Entryâ€.</span>
          </div>
        </td>
      </tr>`;
    return;
  }

  tbody.innerHTML = rows
    .map((row) => {
      const isIn = String(row.type || '').toUpperCase() === 'IN';
      const relatedVoyage = row.relatedVoyage
        ? `${text(row.relatedVoyage.vesselName)} | ${text(row.relatedVoyage.vesselCallsign)}`
        : '\u2014';
      return `<tr>
        <td>${formatWhen(row.createdAt)}</td>
        <td><span class="finance-type-pill ${isIn ? 'is-in' : 'is-out'}">${isIn ? 'IN' : 'OUT'}</span></td>
        <td class="align-right"><span class="finance-cashflow-amount ${isIn ? 'is-in' : 'is-out'}">${isIn ? '+' : '\u2212'}${formatGuilders(row.amount)}</span></td>
        <td>${text(row.reason)}</td>
        <td>${text(row.category || '\u2014')}</td>
        <td>${relatedVoyage}</td>
        <td>${text(row.createdBy || 'Unknown')}</td>
        <td class="align-right"><strong>${formatGuilders(row.balanceAfter)}</strong></td>
      </tr>`;
    })
    .join('');
}

function renderCollectorRemittances(state) {
  const tbody = $('#financeCollectorRemittancesBody');
  const card = document.querySelector('#financeTabCashflow .finance-remittance-table-card');
  if (!tbody) return;
  const rows = Array.isArray(state.collectorRemittances) ? state.collectorRemittances : [];
  const managerOptions = Array.isArray(state.collectorManagerOptions) ? state.collectorManagerOptions : [];
  if (!rows.length) {
    if (card) card.classList.add('is-empty');
    tbody.innerHTML = '<tr class="finance-empty-row"><td colspan="3">No manager balances currently held.</td></tr>';
    return;
  }
  if (card) card.classList.remove('is-empty');

  tbody.innerHTML = rows
    .map((row) => {
      const canSettle = Boolean(state.canSettleCollectorRemittances) && Number(row.totalAmount || 0) > 0;
      const sourceId = Number(row.collectorEmployeeId || 0);
      const targets = managerOptions.filter((option) => Number(option.employeeId || 0) > 0 && Number(option.employeeId || 0) !== sourceId);
      const targetSelectId = `collectorTransferTarget_${sourceId}`;
      const canMove = canSettle && targets.length > 0;
      return `<tr>
        <td>${text(row.collectorName)}</td>
        <td class="align-right"><strong>${formatGuilders(row.totalAmount || 0)}</strong></td>
        <td class="finance-transfer-cell"><div class="finance-transfer-shell">${
          canSettle
            ? canMove
              ? `<div class="finance-transfer-actions">
                   <select id="${targetSelectId}" class="finance-transfer-target" data-transfer-target="${sourceId}">
                     <option value="">Select target</option>
                     ${targets
                       .map(
                         (target) =>
                           `<option value="${Number(target.employeeId || 0)}">${escapeHtml(
                             text(target.name || `Employee #${Number(target.employeeId || 0)}`)
                           )}</option>`
                       )
                       .join('')}
                   </select>
                   <button type="button" class="btn btn-secondary btn-compact finance-transfer-move-btn" data-transfer-collector-remittance="${sourceId}">Move</button>
                 </div>`
              : '<span class="muted finance-transfer-note">No other managers available</span>'
            : '<span class="muted finance-transfer-note">Bookkeeper only</span>'
        }</div></td>
      </tr>`;
    })
    .join('');

  if (!state.canSettleCollectorRemittances) return;
  tbody.querySelectorAll('[data-transfer-collector-remittance]').forEach((button) => {
    button.addEventListener('click', () => {
      const sourceCollectorEmployeeId = Number(button.getAttribute('data-transfer-collector-remittance') || 0);
      if (!Number.isInteger(sourceCollectorEmployeeId) || sourceCollectorEmployeeId <= 0) return;
      const select = tbody.querySelector(`[data-transfer-target="${sourceCollectorEmployeeId}"]`);
      if (!(select instanceof HTMLSelectElement)) return;
      const targetCollectorEmployeeId = Number(select.value || 0);
      if (!Number.isInteger(targetCollectorEmployeeId) || targetCollectorEmployeeId <= 0) {
        setFeedback('Select a target manager before moving held funds.', 'error');
        return;
      }
      const source = rows.find((row) => Number(row.collectorEmployeeId || 0) === sourceCollectorEmployeeId);
      const target = managerOptions.find((option) => Number(option.employeeId || 0) === targetCollectorEmployeeId);
      if (!source || !target) return;
      openSettleModal(state, {
        kind: 'collector-transfer',
        title: 'Confirm Manager Balance Transfer',
        confirmLabel: 'Confirm Move',
        message: `Move ${formatGuilders(source.totalAmount || 0)} from ${text(source.collectorName)} to ${text(target.name)}?`,
        sourceCollectorEmployeeId,
        sourceCollectorName: text(source.collectorName),
        targetCollectorEmployeeId,
        targetCollectorName: text(target.name),
        amount: toMoney(source.totalAmount || 0)
      });
    });
  });
}
function renderCashflowPanel(state) {
  const kpis = state.cashflowKpis || {};
  const cashIn = $('#cashflowKpiIn');
  if (cashIn) cashIn.textContent = formatGuilders(kpis.cashIn || 0);

  const cashOut = $('#cashflowKpiOut');
  if (cashOut) cashOut.textContent = formatGuilders(kpis.cashOut || 0);

  const net = $('#cashflowKpiNet');
  if (net) {
    const netValue = Number(kpis.netCashflow || 0);
    net.textContent = formatGuilders(netValue);
    if (netValue > 0) {
      net.style.color = '#15803d';
    } else if (netValue < 0) {
      net.style.color = '#b91c1c';
    } else {
      net.style.color = '#334155';
    }
  }

  renderCashflowRows(state);
  renderCollectorRemittances(state);
  renderCashflowPagination(state);
  renderCashflowVoyageOptions(state);
}

async function loadCashflow(state) {
  state.cashflowLoading = true;
  renderCashflowSkeleton();

  try {
    const params = new URLSearchParams();
    params.set('range', state.range);
    params.set('page', String(state.cashflowPage));
    params.set('pageSize', String(state.cashflowPageSize));
    const search = ($('#cashflowSearch')?.value || '').trim();
    const dateFrom = ($('#cashflowDateFrom')?.value || '').trim();
    const dateTo = ($('#cashflowDateTo')?.value || '').trim();
    const category = ($('#cashflowFilterCategory')?.value || '').trim();
    const createdBy = ($('#cashflowCreatedBy')?.value || '').trim();

    if (search) params.set('search', search);
    if (dateFrom) params.set('dateFrom', dateInputToUtcIso(dateFrom, false, CLIENT_TZ_OFFSET_MINUTES));
    if (dateTo) params.set('dateTo', dateInputToUtcIso(dateTo, true, CLIENT_TZ_OFFSET_MINUTES));
    if (category) params.set('category', category);
    if (createdBy) params.set('createdBy', createdBy);
    params.set('tzOffsetMinutes', String(CLIENT_TZ_OFFSET_MINUTES));

    const query = params.toString();
    const payload = await fetchJsonWithFallback([`/api/finances/cashflow?${query}`, `/api/finances/cashflow/?${query}`]);

    state.cashflowKpis = payload?.kpis || {};
    state.cashflowRows = Array.isArray(payload?.rows) ? payload.rows : [];
    state.cashflowVoyageOptions = Array.isArray(payload?.voyageOptions) ? payload.voyageOptions : [];
    state.collectorRemittances = Array.isArray(payload?.collectorRemittances) ? payload.collectorRemittances : [];
    state.collectorManagerOptions = Array.isArray(payload?.managerOptions) ? payload.managerOptions : [];
    state.cashflowPage = Math.max(1, Number(payload?.pagination?.page || 1));
    state.cashflowTotalPages = Math.max(1, Number(payload?.pagination?.totalPages || 1));
    state.cashflowCanManage = Boolean(payload?.permissions?.canManage);
    state.canSettleCollectorRemittances = Boolean(payload?.permissions?.canSettleCollectorRemittances);
    state.cashflowLoaded = true;

    renderCashflowPanel(state);
    setCashflowFormEnabled(state.cashflowCanManage);
    clearFeedback();
  } catch (error) {
    console.error('finances cashflow fetch error', error);
    const tbody = $('#financeCashflowBody');
    if (tbody) tbody.innerHTML = '<tr><td colspan="8">Unable to load cashflow data.</td></tr>';
    setInlineFeedback('#cashflowEntryFeedback', error.message || 'Unable to load cashflow.', 'error');
    renderCashflowPagination({ cashflowPage: 1, cashflowTotalPages: 1 });
    setFeedback(`Failed to load cashflow data: ${error.message || 'Unknown error'}`, 'error', async () => loadCashflow(state));
  } finally {
    state.cashflowLoading = false;
  }
}

async function submitCashflowEntry(state) {
  if (!state.cashflowCanManage) {
    setInlineFeedback('#cashflowEntryFeedback', 'You do not have permission to add cashflow entries.', 'error');
    return;
  }

  const type = normalizeCashflowEntryType($('#cashflowType')?.value || state.cashflowEntryType || 'IN');
  const amountRaw = $('#cashflowAmount')?.value || '';
  const reason = ($('#cashflowReason')?.value || '').trim();
  const category = ($('#cashflowCategory')?.value || '').trim();
  const relatedVoyageRaw = $('#cashflowRelatedVoyage')?.value || '';

  const amount = Math.round(Number(amountRaw));
  if (!Number.isInteger(amount) || amount <= 0) {
    setInlineFeedback('#cashflowEntryFeedback', 'Amount must be a positive whole number.', 'error');
    return;
  }
  if (reason.length < 5) {
    setInlineFeedback('#cashflowEntryFeedback', 'Reason must be at least 5 characters.', 'error');
    return;
  }
  if (!category) {
    setInlineFeedback('#cashflowEntryFeedback', 'Category is required.', 'error');
    return;
  }

  const voyageId = parseRelatedVoyageId(relatedVoyageRaw, state);
  if (relatedVoyageRaw.trim() && !voyageId) {
    setInlineFeedback('#cashflowEntryFeedback', 'Related voyage must be selected from the list.', 'error');
    return;
  }

  const submit = $('#cashflowSubmit');
  if (submit) {
    submit.disabled = true;
    submit.textContent = 'Saving...';
  }

  try {
    await fetchJson('/api/finances/cashflow', {
      method: 'POST',
      body: JSON.stringify({
        type,
        amount,
        reason,
        category: category || null,
        voyageId
      })
    });

    const form = $('#cashflowEntryForm');
    if (form) form.reset();
    setCashflowType(state, 'IN');
    setInlineFeedback('#cashflowEntryFeedback', 'Cashflow entry saved.', 'success');
    closeCashflowModal();

    state.cashflowPage = 1;
    await loadCashflow(state);
    await loadOverview(state);
  } catch (error) {
    console.error('finances cashflow create error', error);
    setInlineFeedback('#cashflowEntryFeedback', error.message || 'Failed to create cashflow entry.', 'error');
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = 'Submit Entry';
    }
  }
}

function setBreakdownMode(state, mode) {
  state.breakdownMode = normalizeBreakdownMode(mode);
  $$('[data-breakdown-mode]').forEach((button) => {
    button.classList.toggle('is-active', button.getAttribute('data-breakdown-mode') === state.breakdownMode);
  });
  updateUrlState(state);

  if (!state.overview || state.overviewLoading) return;
  renderProfitDriversChart($('#trendsChartProfitDrivers'), state.overview?.breakdowns || {}, state.breakdownMode);
  renderProfitDriversTable($('#trendsDriversTable'), state.overview?.breakdowns || {}, state.breakdownMode);
}

function renderDebtsSkeleton() {
  const body = $('#financeDebtsBody');
  if (!body) return;
  body.innerHTML = '<tr><td colspan="5"><div class="finance-chart-skeleton"></div></td></tr>';
}

function setDebtsSummary(totals) {
  void totals;
}

function renderReimbursementList(state) {
  const tbody = $('#financeReimbursementsBody');
  if (!tbody) return;
  const safeRows = Array.isArray(state?.debtReimbursements) ? state.debtReimbursements : [];
  if (!safeRows.length) {
    tbody.innerHTML = '<tr class="finance-empty-row"><td colspan="3">No lost Freight/Cargo reimbursements.</td></tr>';
    return;
  }
  tbody.innerHTML = safeRows
    .map((row) => {
      const canSettle = Boolean(state?.canSettle) && Number(row?.totalReimbursement || 0) > 0;
      return `<tr>
        <td>${text(row.ownerName)}</td>
        <td class="align-right"><strong>${formatGuilders(row.totalReimbursement || 0)}</strong></td>
        <td>${
          canSettle
            ? `<button type="button" class="btn btn-primary btn-compact" data-settle-reimbursement-owner="${Number(row.ownerEmployeeId || 0)}">Settle</button>`
            : '<span class="muted">â€”</span>'
        }</td>
      </tr>`;
    })
    .join('');

  if (!state?.canSettle) return;
  tbody.querySelectorAll('[data-settle-reimbursement-owner]').forEach((button) => {
    button.addEventListener('click', () => {
      const ownerEmployeeId = Number(button.getAttribute('data-settle-reimbursement-owner') || 0);
      if (!Number.isInteger(ownerEmployeeId) || ownerEmployeeId <= 0) return;
      const target = safeRows.find((row) => Number(row.ownerEmployeeId || 0) === ownerEmployeeId);
      if (!target) return;
      openSettleModal(state, {
        kind: 'reimbursement',
        title: 'Confirm Reimbursement Settlement',
        confirmLabel: 'Confirm Settlement',
        message: `Settle reimbursement ${formatGuilders(
          target.totalReimbursement || 0
        )} for ${text(target.ownerName)}? This will create a cashflow OUT entry.`,
        ownerEmployeeId,
        ownerName: text(target.ownerName),
        amount: toMoney(target.totalReimbursement || 0)
      });
    });
  });
}

function renderDebtsRows(state) {
  const tbody = $('#financeDebtsBody');
  if (!tbody) return;

  const groups = Array.isArray(state.debtGroups) ? state.debtGroups : [];
  if (!groups.length) {
    tbody.innerHTML = '<tr class="finance-empty-row"><td colspan="5">No employees match the current filter.</td></tr>';
    return;
  }

  tbody.innerHTML = groups
    .map((group) => {
      const officerSerial = cleanSerial(group.officerSerial);
      const officer = officerSerial ? `${text(group.officerName)} (${officerSerial})` : text(group.officerName);
      const unsettledVoyages = Number(group.unsettledVoyages || 0);
      const isUnsettled = unsettledVoyages > 0;
      const canSettle = state.canSettle && isUnsettled;
      return `<tr>
        <td>${officer}</td>
        <td>${formatInteger(group.voyageCount || 0)}</td>
        <td class="align-right">${formatGuilders(group.outstandingTotal || 0)}</td>
        <td><span class="finance-status-pill ${isUnsettled ? 'is-unsettled' : 'is-settled'}">${isUnsettled ? 'UNSETTLED' : 'SETTLED'}</span></td>
        <td>${
          state.canSettle
            ? canSettle
              ? `<button type="button" class="btn btn-primary btn-compact" data-settle-group="${text(group.groupKey)}">Settle All</button>`
              : '<span class="muted">Settled</span>'
            : '<span class="muted">â€”</span>'
        }</td>
      </tr>`;
    })
    .join('');

  if (!state.canSettle) return;

  tbody.querySelectorAll('[data-settle-group]').forEach((button) => {
    button.addEventListener('click', () => {
      const groupKey = String(button.getAttribute('data-settle-group') || '').trim();
      if (!groupKey) return;
      const group = groups.find((entry) => String(entry.groupKey || '').trim() === groupKey);
      if (!group) return;
      const unsettledVoyageIds = (Array.isArray(group.voyages) ? group.voyages : [])
        .filter((row) => String(row.companyShareStatus || '').toUpperCase() === 'UNSETTLED')
        .map((row) => Number(row.voyageId || 0))
        .filter((id) => Number.isInteger(id) && id > 0);
      if (!unsettledVoyageIds.length) return;

      const officerSerial = cleanSerial(group.officerSerial);
      openSettleModal(state, {
        kind: 'company-share',
        title: 'Confirm Settlement',
        confirmLabel: 'Confirm Settlement',
        message: `Mark ${formatInteger(unsettledVoyageIds.length)} unsettled voyage(s) for ${
          officerSerial ? `${text(group.officerName)} (${officerSerial})` : text(group.officerName)
        } as settled for ${formatGuilders(toMoney(group.outstandingTotal || 0))}?`,
        groupKey,
        voyageIds: unsettledVoyageIds,
        amount: toMoney(group.outstandingTotal || 0),
        officerName: text(group.officerName),
        officerSerial,
        unsettledVoyages: unsettledVoyageIds.length
      });
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
    params.set('tzOffsetMinutes', String(CLIENT_TZ_OFFSET_MINUTES));
    if (state.debtCacheBust > 0) params.set('_cb', String(state.debtCacheBust));

    const payload = await fetchJson(`/api/finances/debts?${params.toString()}`);

    state.debtRows = Array.isArray(payload?.rows) ? payload.rows : [];
    state.debtGroups = Array.isArray(payload?.groups) ? payload.groups : [];
    state.debtReimbursements = Array.isArray(payload?.reimbursements) ? payload.reimbursements : [];
    state.debtTotalPages = Math.max(1, Number(payload?.pagination?.totalPages || 1));
    state.debtPage = Math.max(1, Math.min(state.debtPage, state.debtTotalPages));
    state.canSettle = Boolean(payload?.permissions?.canSettle);
    state.debtsLoaded = true;

    if (state.debtPage !== requestedPage) {
      await loadDebts(state);
      return;
    }

    setDebtsSummary(payload?.totals || {});
    renderReimbursementList(state);
    renderDebtsRows(state);
    renderDebtsPagination(state);
    clearFeedback();
  } catch (error) {
    console.error('finances debts fetch error', error);
    const tbody = $('#financeDebtsBody');
    if (tbody) tbody.innerHTML = '<tr class="finance-empty-row"><td colspan="5">Unable to load debts data.</td></tr>';
    setDebtsSummary({ unsettledOutstanding: 0, unsettledVoyages: 0, uniqueOotw: 0, reimbursementsTotal: 0, netOutstandingAfterReimbursements: 0 });
    renderReimbursementList({ debtReimbursements: [] });
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
        <td>${text(row.sellLocationName) !== 'N/A' ? text(row.sellLocationName) : text(row.departurePort)}</td>
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
    if (dateFrom) params.set('dateFrom', dateInputToUtcIso(dateFrom, false, CLIENT_TZ_OFFSET_MINUTES));
    if (dateTo) params.set('dateTo', dateInputToUtcIso(dateTo, true, CLIENT_TZ_OFFSET_MINUTES));
    params.set('tzOffsetMinutes', String(CLIENT_TZ_OFFSET_MINUTES));

    const payload = await fetchJson(`/api/finances/audit?${params.toString()}`);

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
  state.overviewLoaded = true;
  renderOverviewSkeleton();

  try {
    const cacheBust = `_ts=${Date.now()}`;
    const currentPromise = fetchJson(
      `/api/finances/overview?range=${encodeURIComponent(state.range)}&unsettledScope=all&tzOffsetMinutes=${encodeURIComponent(
        String(CLIENT_TZ_OFFSET_MINUTES)
      )}&${cacheBust}`
    ).catch((error) => ({ __error: error }));
    const previousPromise =
      state.range === 'all'
        ? Promise.resolve({ kpis: {} })
        : fetchJson(
            `/api/finances/overview?range=${encodeURIComponent(state.range)}&unsettledScope=all&offset=1&tzOffsetMinutes=${encodeURIComponent(
              String(CLIENT_TZ_OFFSET_MINUTES)
            )}&${cacheBust}`
          ).catch((error) => ({ __error: error }));

    const debugPromise = fetchJson(
      `/api/finances/debug?range=${encodeURIComponent(state.range)}&tzOffsetMinutes=${encodeURIComponent(String(CLIENT_TZ_OFFSET_MINUTES))}`
    ).catch((error) => ({ error: error?.message || 'Failed to load debug endpoint.' }));

    const [current, previous, debugPayload] = await Promise.all([currentPromise, previousPromise, debugPromise]);
    const currentError = current?.__error || null;
    const previousError = previous?.__error || null;
    let effectiveCurrent = currentError ? { kpis: {} } : current || {};
    let effectivePrevious = previousError ? { kpis: {} } : previous || {};

    const kpis = effectiveCurrent?.kpis || {};
    const hasSelectedRangeData =
      Number(kpis.completedVoyages || 0) > 0 ||
      Number(kpis.grossRevenue || 0) !== 0 ||
      Number(kpis.netProfit || 0) !== 0 ||
      Number(kpis.companyShareEarnings || 0) !== 0 ||
      Number(kpis.freightLossesValue || 0) !== 0;

    if (!hasSelectedRangeData && state.range !== 'all') {
      const allTime = await fetchJson(
        `/api/finances/overview?range=all&unsettledScope=all&tzOffsetMinutes=${encodeURIComponent(String(CLIENT_TZ_OFFSET_MINUTES))}&${cacheBust}`
      ).catch(() => null);
      if (allTime && allTime.kpis) {
        effectiveCurrent = allTime;
        effectivePrevious = { kpis: {} };
      }
    }

    const stillEmptyAfterFallback =
      Number(effectiveCurrent?.kpis?.completedVoyages || 0) <= 0 &&
      Number(effectiveCurrent?.kpis?.grossRevenue || 0) === 0 &&
      Number(effectiveCurrent?.kpis?.netProfit || 0) === 0 &&
      Number(effectiveCurrent?.kpis?.companyShareEarnings || 0) === 0 &&
      Number(effectiveCurrent?.kpis?.freightLossesValue || 0) === 0;

    const debugRange = debugPayload?.rangeStats || {};
    const debugVoyageCount = Number(debugRange?.rangeVoyageCount || 0);
    const debugNetProfit = Number(debugRange?.rangeProfitTotal || 0);
    const debugGrossRevenue = Number(debugRange?.rangeGrossRevenueTotal || 0);
    const debugCompanyShare = Number(debugRange?.rangeCompanyShareTotal || 0);

    const debugFallbackOverview = debugPayload?.fallbackOverview || null;
    if (stillEmptyAfterFallback && (debugVoyageCount > 0 || debugNetProfit !== 0 || debugCompanyShare !== 0)) {
      const fallbackKpis = debugFallbackOverview?.kpis || {};
      const fallbackTopPerformers = debugFallbackOverview?.topPerformers || {};
      const fallbackUnsettled = debugFallbackOverview?.unsettled || {};
      const fallbackCharts = debugFallbackOverview?.charts || {};
      const fallbackBreakdowns = debugFallbackOverview?.breakdowns || {};
      const netProfitTrend = aggregateTrendForRange(fallbackCharts.netProfitTrend, state.range, 'sum');
      const companyShareTrend = aggregateTrendForRange(fallbackCharts.companyShareTrend, state.range, 'sum');
      const voyageCountTrend = aggregateTrendForRange(fallbackCharts.voyageCountTrend, state.range, 'sum');
      const freightLossValueTrend = aggregateTrendForRange(fallbackCharts.freightLossValueTrend, state.range, 'sum');
      const grossRevenueTrend = aggregateTrendForRange(fallbackCharts.grossRevenueTrend, state.range, 'sum');
      const avgNetProfitTrend = netProfitTrend.map((point, index) => ({
        key: point.key,
        label: point.label,
        value:
          Number(voyageCountTrend[index]?.value || 0) > 0
            ? toMoney(Number(point.value || 0) / Math.max(1, Number(voyageCountTrend[index]?.value || 0)))
            : toMoney(point.value || 0)
      }));
      effectiveCurrent = {
        ...(effectiveCurrent || {}),
        kpis: {
          ...(effectiveCurrent?.kpis || {}),
          netProfit: Number(fallbackKpis.netProfit ?? debugNetProfit),
          grossRevenue: Number(fallbackKpis.grossRevenue ?? debugGrossRevenue),
          companyShareEarnings: Number(fallbackKpis.companyShareEarnings ?? debugCompanyShare),
          crewShare: Number(
            fallbackKpis.crewShare ??
              Math.max(0, Math.round((fallbackKpis.grossRevenue ?? debugGrossRevenue ?? debugNetProfit) - debugCompanyShare))
          ),
          freightLossesValue: Number(fallbackKpis.freightLossesValue ?? 0),
          completedVoyages: Number(fallbackKpis.completedVoyages ?? Math.max(0, debugVoyageCount)),
          emissionsKg: Number(fallbackKpis.emissionsKg ?? 0),
          crudeSold: Number(fallbackKpis.crudeSold ?? 0),
          gasSold: Number(fallbackKpis.gasSold ?? 0)
        },
        charts: {
          ...(effectiveCurrent?.charts || {}),
          netProfitTrend,
          companyShareTrend,
          voyageCountTrend,
          freightLossValueTrend,
          grossRevenueTrend,
          avgNetProfitTrend,
          outstandingTrend: companyShareTrend
        },
        breakdowns: {
          ...(effectiveCurrent?.breakdowns || {}),
          byRoute: Array.isArray(fallbackBreakdowns.byRoute) ? fallbackBreakdowns.byRoute : [],
          byVessel: Array.isArray(fallbackBreakdowns.byVessel) ? fallbackBreakdowns.byVessel : [],
          byOotw: Array.isArray(fallbackBreakdowns.byOotw) ? fallbackBreakdowns.byOotw : []
        },
        topPerformers: {
          ...(effectiveCurrent?.topPerformers || {}),
          sellLocation: fallbackTopPerformers.sellLocation || effectiveCurrent?.topPerformers?.sellLocation,
          voyage: fallbackTopPerformers.voyage || effectiveCurrent?.topPerformers?.voyage,
          ootw: fallbackTopPerformers.ootw || effectiveCurrent?.topPerformers?.ootw
        },
        unsettled: {
          ...(effectiveCurrent?.unsettled || {}),
          totalOutstanding: Number(fallbackUnsettled.totalOutstanding ?? 0),
          totalVoyages: Number(fallbackUnsettled.totalVoyages ?? 0),
          overdueVoyages: Number(fallbackUnsettled.overdueVoyages ?? 0),
          topDebtors: Array.isArray(fallbackUnsettled.topDebtors) ? fallbackUnsettled.topDebtors : []
        },
        debugOverview: {
          source: 'client_debug_fallback',
          debugVoyageCount,
          debugNetProfit,
          debugCompanyShare,
          fallbackOverviewPresent: Boolean(debugFallbackOverview)
        }
      };
      effectivePrevious = effectivePrevious || { kpis: {} };
    }

    effectiveCurrent = normalizeOverviewChartsForRange(effectiveCurrent, state.range);
    state.overview = effectiveCurrent;
    state.overviewPrevious = effectivePrevious;
    state.financeDebug = debugPayload || null;
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
    if (currentError) {
      console.warn('finances overview primary endpoint failed; rendered using fallback data', currentError);
    }
  } catch (error) {
    const primaryError = error?.__error || error;
    console.error('finances overview fetch error', primaryError);
    setFeedback(`Failed to load finance data: ${error.message || 'Unknown error'}`, 'error', async () => loadOverview(state));
  } finally {
    state.overviewLoading = false;
  }
}

function closeSettleModal(state) {
  state.pendingSettle = null;
  const modal = $('#financeSettleModal');
  if (modal) modal.classList.add('hidden');

  const title = $('#financeSettleTitle');
  if (title) title.textContent = 'Confirm Settlement';
  const message = $('#financeSettleMessage');
  if (message) message.textContent = 'Mark this company share as settled?';

  const confirm = $('#financeSettleConfirm');
  if (confirm) {
    confirm.disabled = false;
    confirm.textContent = 'Confirm Settlement';
  }
}

function openSettleModal(state, pending) {
  state.pendingSettle = pending || null;
  const title = $('#financeSettleTitle');
  if (title) title.textContent = text(pending?.title || 'Confirm Settlement');
  const message = $('#financeSettleMessage');
  if (message) message.textContent = text(pending?.message || 'Confirm this settlement?');
  const confirm = $('#financeSettleConfirm');
  if (confirm) {
    confirm.disabled = false;
    confirm.textContent = text(pending?.confirmLabel || 'Confirm Settlement');
  }
  const modal = $('#financeSettleModal');
  if (modal) modal.classList.remove('hidden');
}

async function confirmSettlePendingVoyage(state) {
  const pending = state.pendingSettle;
  if (!pending) return;

  const confirm = $('#financeSettleConfirm');
  if (confirm) {
    confirm.disabled = true;
    confirm.textContent = 'Settling...';
  }

  if (pending.kind === 'reimbursement') {
    const ownerEmployeeId = Number(pending.ownerEmployeeId || 0);
    if (!ownerEmployeeId) {
      closeSettleModal(state);
      return;
    }
    const previousRows = Array.isArray(state.debtReimbursements) ? [...state.debtReimbursements] : [];
    state.debtReimbursements = previousRows.filter((row) => Number(row?.ownerEmployeeId || 0) !== ownerEmployeeId);
    renderReimbursementList(state);

    try {
      await fetchJson(`/api/finances/reimbursements/${ownerEmployeeId}/settle`, {
        method: 'POST',
        body: JSON.stringify({
          scope: ($('#debtScope')?.value || 'all').trim(),
          range: state.range,
          tzOffsetMinutes: CLIENT_TZ_OFFSET_MINUTES
        })
      });
      closeSettleModal(state);
      state.debtCacheBust += 1;
      setFeedback('Reimbursement settled and deducted from cashflow.', 'success');
      const reloads = [];
      if (state.activeTab === 'debts' || state.debtsLoaded) {
        state.debtPage = 1;
        reloads.push(loadDebts(state));
      }
      if (state.activeTab === 'cashflow' || state.cashflowLoaded) {
        state.cashflowPage = 1;
        reloads.push(loadCashflow(state));
      }
      reloads.push(loadOverview(state));
      await Promise.all(reloads);
    } catch (error) {
      state.debtReimbursements = previousRows;
      renderReimbursementList(state);
      console.error('finances reimbursement settle error', error);
      setFeedback(error.message || 'Failed to settle reimbursement.', 'error');
      closeSettleModal(state);
    }
    return;
  }

  if (pending.kind === 'collector-remittance') {
    const collectorEmployeeId = Number(pending.collectorEmployeeId || 0);
    if (!collectorEmployeeId) {
      closeSettleModal(state);
      return;
    }

    const previousRows = Array.isArray(state.collectorRemittances) ? [...state.collectorRemittances] : [];
    state.collectorRemittances = previousRows.filter((row) => Number(row?.collectorEmployeeId || 0) !== collectorEmployeeId);
    renderCollectorRemittances(state);

    try {
      await fetchJson(`/api/finances/collector-remittances/${collectorEmployeeId}/settle`, {
        method: 'POST'
      });
      closeSettleModal(state);
      setFeedback('Collector remittance transferred to CEO cashflow.', 'success');

      const reloads = [];
      if (state.activeTab === 'cashflow' || state.cashflowLoaded) {
        state.cashflowPage = 1;
        reloads.push(loadCashflow(state));
      }
      if (state.activeTab === 'debts' || state.debtsLoaded) {
        state.debtPage = 1;
        state.debtCacheBust += 1;
        reloads.push(loadDebts(state));
      }
      reloads.push(loadOverview(state));
      await Promise.all(reloads);
    } catch (error) {
      state.collectorRemittances = previousRows;
      renderCollectorRemittances(state);
      console.error('collector remittance settle error', error);
      setFeedback(error.message || 'Failed to settle collector remittance.', 'error');
      closeSettleModal(state);
    }
    return;
  }

  if (pending.kind === 'collector-transfer') {
    const sourceCollectorEmployeeId = Number(pending.sourceCollectorEmployeeId || 0);
    const targetCollectorEmployeeId = Number(pending.targetCollectorEmployeeId || 0);
    if (!sourceCollectorEmployeeId || !targetCollectorEmployeeId) {
      closeSettleModal(state);
      return;
    }

    const previousRows = Array.isArray(state.collectorRemittances) ? [...state.collectorRemittances] : [];

    try {
      await fetchJson(`/api/finances/collector-remittances/${sourceCollectorEmployeeId}/transfer`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          toCollectorEmployeeId: targetCollectorEmployeeId
        })
      });
      closeSettleModal(state);
      setFeedback('Manager transfer balance moved successfully.', 'success');

      const reloads = [];
      if (state.activeTab === 'cashflow' || state.cashflowLoaded) {
        state.cashflowPage = 1;
        reloads.push(loadCashflow(state));
      }
      if (state.activeTab === 'debts' || state.debtsLoaded) {
        state.debtPage = 1;
        state.debtCacheBust += 1;
        reloads.push(loadDebts(state));
      }
      reloads.push(loadOverview(state));
      await Promise.all(reloads);
    } catch (error) {
      state.collectorRemittances = previousRows;
      renderCollectorRemittances(state);
      console.error('collector remittance transfer error', error);
      setFeedback(error.message || 'Failed to transfer manager balance.', 'error');
      closeSettleModal(state);
    }
    return;
  }
  const voyageIds = Array.isArray(pending?.voyageIds) ? pending.voyageIds : [];
  if (!voyageIds.length) {
    closeSettleModal(state);
    return;
  }

  const previousGroups = Array.isArray(state.debtGroups) ? [...state.debtGroups] : [];
  state.debtGroups = previousGroups.filter((group) => String(group?.groupKey || '').trim() !== String(pending.groupKey || '').trim());
  renderDebtsRows(state);
  renderDebtsPagination(state);

  try {
    const settleResults = await Promise.all(
      voyageIds.map((voyageId) => fetchJson(`/api/finances/debts/${encodeURIComponent(String(voyageId))}/settle`, { method: 'POST' }))
    );
    closeSettleModal(state);
    state.debtCacheBust += 1;
    const queuedTransfers = settleResults.filter((row) => Boolean(row?.remittancePending)).length;
    if (queuedTransfers > 0) {
      setFeedback(`Company share marked settled. ${formatInteger(queuedTransfers)} voyage(s) queued for collector transfer to CEO.`, 'success');
    } else {
      setFeedback('Company share entries marked as settled.', 'success');
    }

    const reloads = [];
    if (state.activeTab === 'debts' || state.debtsLoaded) reloads.push(loadDebts(state));
    if (state.activeTab === 'cashflow' || state.cashflowLoaded) {
      state.cashflowPage = 1;
      reloads.push(loadCashflow(state));
    }
    if (state.overviewLoaded || state.activeTab === 'overview' || state.activeTab === 'trends') {
      reloads.push(loadOverview(state));
    }
    await Promise.all(reloads);
  } catch (error) {
    state.debtGroups = previousGroups;
    renderDebtsRows(state);
    renderDebtsPagination(state);
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

  // Re-render visible chart tabs after display state changes so chart viewport
  // dimensions are measured from the active panel, not a hidden panel.
  if ((next === 'overview' || next === 'trends') && state.overview && !state.overviewLoading) {
    window.requestAnimationFrame(() => {
      renderOverview(state.overview, state.overviewPrevious || {}, state.range, state.breakdownMode);
    });
  }

  if ((next === 'overview' || next === 'trends') && !state.overview && !state.overviewLoading) {
    await loadOverview(state);
    return;
  }

  if (next === 'debts' && !state.debtsLoaded && !state.debtsLoading) {
    await loadDebts(state);
    return;
  }

  if (next === 'cashflow' && !state.cashflowLoaded && !state.cashflowLoading) {
    await loadCashflow(state);
  }
}

async function init() {
  renderIcons();

  const query = new URL(window.location.href).searchParams;
  const state = {
    session: null,
    range: normalizeFinanceRange(query.get('range')),
    activeTab: normalizeFinanceTab(query.get('tab')),
    breakdownMode: normalizeBreakdownMode(query.get('breakdown')),
    overview: null,
    overviewPrevious: null,
    financeDebug: null,
    overviewLoaded: false,
    overviewLoading: false,
    debtsLoaded: false,
    debtsLoading: false,
    debtRows: [],
    debtGroups: [],
    debtReimbursements: [],
    debtPage: 1,
    debtPageSize: 10,
    debtTotalPages: 1,
    debtCacheBust: 0,
    canSettle: false,
    cashflowLoaded: false,
    cashflowLoading: false,
    cashflowCanManage: false,
    cashflowEntryType: 'IN',
    cashflowKpis: {},
    cashflowRows: [],
    collectorRemittances: [],
    collectorManagerOptions: [],
    canSettleCollectorRemittances: false,
    cashflowVoyageOptions: [],
    cashflowVoyageLookup: new Map(),
    cashflowPage: 1,
    cashflowPageSize: 20,
    cashflowTotalPages: 1,
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

  setActiveRange(state.range);
  setActiveTab(state.activeTab);
  updateUrlState(state);

  $$('[data-finance-range]').forEach((button) => {
    button.addEventListener('click', async () => {
      const range = normalizeFinanceRange(button.getAttribute('data-finance-range'));
      if (state.range === range && state.overviewLoaded) return;
      state.range = range;
      setActiveRange(range);
      updateUrlState(state);
      if (state.activeTab === 'overview' || state.activeTab === 'trends' || state.overviewLoaded) {
        await loadOverview(state);
      }
      if (state.activeTab === 'debts' || state.debtsLoaded) {
        state.debtPage = 1;
        await loadDebts(state);
      }
      if (state.activeTab === 'cashflow' || state.cashflowLoaded) {
        state.cashflowPage = 1;
        await loadCashflow(state);
      }
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
  setCashflowType(state, state.cashflowEntryType);
  setCashflowFormEnabled(false);

  const settleModal = $('#financeSettleModal');
  const settleCancel = $('#financeSettleCancel');
  const settleConfirm = $('#financeSettleConfirm');
  const cashflowModal = $('#cashflowEntryModal');
  const cashflowOpen = $('#cashflowOpenModal');
  const cashflowClose = $('#cashflowModalClose');
  const cashflowCancel = $('#cashflowCancel');
  if (settleCancel) settleCancel.addEventListener('click', () => closeSettleModal(state));
  if (settleConfirm) settleConfirm.addEventListener('click', async () => confirmSettlePendingVoyage(state));
  if (cashflowOpen) {
    cashflowOpen.addEventListener('click', () => {
      if (!state.cashflowCanManage) {
        setInlineFeedback('#cashflowEntryFeedback', 'You do not have permission to add cashflow entries.', 'error');
        return;
      }
      openCashflowModal();
    });
  }
  if (cashflowClose) cashflowClose.addEventListener('click', () => closeCashflowModal());
  if (cashflowCancel) cashflowCancel.addEventListener('click', () => closeCashflowModal());
  if (settleModal) {
    settleModal.addEventListener('click', (event) => {
      if (event.target === settleModal) closeSettleModal(state);
    });
  }
  if (cashflowModal) {
    cashflowModal.addEventListener('click', (event) => {
      if (event.target === cashflowModal) closeCashflowModal();
    });
  }
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.pendingSettle) closeSettleModal(state);
    if (event.key === 'Escape' && !state.pendingSettle) closeCashflowModal();
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
  const debtFilterAll = $('#debtFilterAll');
  const debtFilterUnsettled = $('#debtFilterUnsettled');
  const syncDebtFilterButtons = () => {
    const onlyUnsettled = Boolean(debtOnlyUnsettled?.checked);
    debtFilterAll?.classList.toggle('is-active', !onlyUnsettled);
    debtFilterUnsettled?.classList.toggle('is-active', onlyUnsettled);
    if (debtFilterAll) debtFilterAll.setAttribute('aria-pressed', !onlyUnsettled ? 'true' : 'false');
    if (debtFilterUnsettled) debtFilterUnsettled.setAttribute('aria-pressed', onlyUnsettled ? 'true' : 'false');
  };
  const setDebtFilter = (onlyUnsettled) => {
    if (!debtOnlyUnsettled) return;
    if (Boolean(debtOnlyUnsettled.checked) === Boolean(onlyUnsettled)) {
      syncDebtFilterButtons();
      return;
    }
    debtOnlyUnsettled.checked = Boolean(onlyUnsettled);
    syncDebtFilterButtons();
    scheduleDebtReload();
  };
  if (debtSearch) debtSearch.addEventListener('input', scheduleDebtReload);
  if (debtMin) debtMin.addEventListener('input', scheduleDebtReload);
  if (debtScope) debtScope.addEventListener('change', scheduleDebtReload);
  if (debtOnlyUnsettled) {
    debtOnlyUnsettled.addEventListener('change', () => {
      syncDebtFilterButtons();
      scheduleDebtReload();
    });
  }
  debtFilterAll?.addEventListener('click', () => setDebtFilter(false));
  debtFilterUnsettled?.addEventListener('click', () => setDebtFilter(true));
  syncDebtFilterButtons();

  let cashflowDebounce;
  const scheduleCashflowReload = () => {
    state.cashflowPage = 1;
    if (cashflowDebounce) window.clearTimeout(cashflowDebounce);
    cashflowDebounce = window.setTimeout(async () => {
      await loadCashflow(state);
    }, 320);
  };

  const cashflowSearch = $('#cashflowSearch');
  const cashflowDateFrom = $('#cashflowDateFrom');
  const cashflowDateTo = $('#cashflowDateTo');
  const cashflowFilterCategory = $('#cashflowFilterCategory');
  const cashflowCreatedBy = $('#cashflowCreatedBy');
  if (cashflowSearch) cashflowSearch.addEventListener('input', scheduleCashflowReload);
  if (cashflowDateFrom) cashflowDateFrom.addEventListener('change', scheduleCashflowReload);
  if (cashflowDateTo) cashflowDateTo.addEventListener('change', scheduleCashflowReload);
  if (cashflowFilterCategory) cashflowFilterCategory.addEventListener('change', scheduleCashflowReload);
  if (cashflowCreatedBy) cashflowCreatedBy.addEventListener('input', scheduleCashflowReload);

  $$('[data-cashflow-type]').forEach((button) => {
    button.addEventListener('click', () => {
      setCashflowType(state, button.getAttribute('data-cashflow-type') || 'IN');
    });
  });

  const cashflowForm = $('#cashflowEntryForm');
  if (cashflowForm) {
    cashflowForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      await submitCashflowEntry(state);
    });
  }

  const cashflowPrev = $('#financeCashflowPrev');
  const cashflowNext = $('#financeCashflowNext');
  if (cashflowPrev) {
    cashflowPrev.addEventListener('click', async () => {
      if (state.cashflowPage <= 1 || state.cashflowLoading) return;
      state.cashflowPage -= 1;
      await loadCashflow(state);
    });
  }
  if (cashflowNext) {
    cashflowNext.addEventListener('click', async () => {
      if (state.cashflowPage >= state.cashflowTotalPages || state.cashflowLoading) return;
      state.cashflowPage += 1;
      await loadCashflow(state);
    });
  }

  if (state.activeTab === 'overview' || state.activeTab === 'trends') {
    await loadOverview(state);
  } else if (state.activeTab === 'debts') {
    await loadDebts(state);
  } else if (state.activeTab === 'cashflow') {
    await loadCashflow(state);
  } else {
    await loadOverview(state);
  }

  const AUTO_REFRESH_MS = 15000;
  const hasModalOpen = () => {
    const settleModal = $('#financeSettleModal');
    const cashflowModal = $('#cashflowEntryModal');
    return Boolean(
      (settleModal && !settleModal.classList.contains('hidden')) || (cashflowModal && !cashflowModal.classList.contains('hidden'))
    );
  };
  const isTyping = () => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    return (
      active.matches('input, textarea, select, [contenteditable="true"]') ||
      Boolean(active.closest('#financeTabDebts, #financeTabCashflow, #cashflowEntryForm'))
    );
  };
  const refreshActiveTab = async (force = false) => {
    if (!force && document.hidden) return;
    if (!force && (hasModalOpen() || isTyping())) return;
    if (state.overviewLoading || state.debtsLoading || state.cashflowLoading) return;

    const toNumber = (value) => {
      const parsed = Number(String(value ?? '').replace(/[^\d.-]/g, ''));
      return Number.isFinite(parsed) ? parsed : 0;
    };
    const shouldRefreshCurrentTab = () => {
      if (state.activeTab === 'debts') {
        const unsettledCount =
          (Array.isArray(state.debtGroups) ? state.debtGroups : []).reduce(
            (sum, group) => sum + Number(group?.unsettledVoyages || 0),
            0
          ) || 0;
        const reimbursementTotal =
          (Array.isArray(state.debtReimbursements) ? state.debtReimbursements : []).reduce(
            (sum, row) => sum + Number(row?.totalReimbursement || 0),
            0
          ) || 0;
        return unsettledCount > 0 || reimbursementTotal > 0;
      }
      if (state.activeTab === 'cashflow') {
        return Array.isArray(state.cashflowRows) && state.cashflowRows.length > 0;
      }
      if (state.activeTab === 'overview' || state.activeTab === 'trends') {
        const kpis = state.overview?.kpis || {};
        const unsettled =
          Number(kpis.unsettledVoyages ?? state.overview?.unsettledVoyages ?? state.overview?.totals?.unsettledVoyages ?? 0) || 0;
        const voyages = Number(kpis.voyageCount ?? state.overview?.voyageCount ?? state.overview?.totals?.voyageCount ?? 0) || 0;
        const ongoing = Number(kpis.ongoingVoyages ?? state.overview?.ongoingVoyages ?? 0) || 0;
        return unsettled > 0 || voyages > 0 || ongoing > 0;
      }
      return false;
    };
    if (!shouldRefreshCurrentTab()) return;

    if (state.activeTab === 'overview' || state.activeTab === 'trends') {
      await loadOverview(state);
      return;
    }
    if (state.activeTab === 'debts') {
      await loadDebts(state);
      return;
    }
    if (state.activeTab === 'cashflow') {
      await loadCashflow(state);
    }
  };
  window.setInterval(() => {
    void refreshActiveTab(false);
  }, AUTO_REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refreshActiveTab(true);
  });
}

init().catch((error) => {
  console.error('finances init error', error);
  setFeedback(`Failed to load finance module: ${error.message || 'Unknown error'}`, 'error');
});









