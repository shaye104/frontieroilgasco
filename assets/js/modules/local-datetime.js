function pad(value) {
  return String(value).padStart(2, '0');
}

function parseDateValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return null;

  // D1 CURRENT_TIMESTAMP style: "YYYY-MM-DD HH:MM:SS" (UTC, no timezone suffix).
  const d1Match = raw.match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/
  );
  if (d1Match) {
    const [, y, m, d, hh, mm, ss, ms] = d1Match;
    const isoUtc = `${y}-${m}-${d}T${hh}:${mm}:${ss}.${String(ms || '0').padEnd(3, '0')}Z`;
    const parsed = new Date(isoUtc);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }

  const native = new Date(raw);
  if (!Number.isNaN(native.getTime())) return native;

  return null;
}

export function getClientTimezoneOffsetMinutes() {
  try {
    const offset = Number(new Date().getTimezoneOffset());
    return Number.isFinite(offset) ? offset : 0;
  } catch {
    return 0;
  }
}

export function formatLocalDateTime(value, options = {}) {
  const raw = String(value || '').trim();
  if (!raw) return options.fallback || 'N/A';
  const date = parseDateValue(raw);
  if (!date) return raw;
  const resolvedTz =
    options.timeZone ||
    (typeof Intl !== 'undefined' && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined);
  return date.toLocaleString(options.locale || undefined, {
    ...(options.formatOptions || {}),
    ...(resolvedTz ? { timeZone: resolvedTz } : {})
  });
}

export function formatLocalDate(value, options = {}) {
  const raw = String(value || '').trim();
  if (!raw) return options.fallback || 'N/A';
  const date = parseDateValue(raw);
  if (!date) return raw;
  const resolvedTz =
    options.timeZone ||
    (typeof Intl !== 'undefined' && Intl.DateTimeFormat ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined);
  return date.toLocaleDateString(options.locale || undefined, {
    ...(options.formatOptions || {}),
    ...(resolvedTz ? { timeZone: resolvedTz } : {})
  });
}

export function toDateInputValueLocal(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toDateTimeLocalInputValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function dateInputToUtcIso(value, isEnd = false, tzOffsetMinutes = getClientTimezoneOffsetMinutes()) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    const parsed = new Date(raw);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString();
  }
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const hours = isEnd ? 23 : 0;
  const minutes = isEnd ? 59 : 0;
  const seconds = isEnd ? 59 : 0;
  const millis = isEnd ? 999 : 0;
  const utcMs = Date.UTC(year, month, day, hours, minutes, seconds, millis) + Number(tzOffsetMinutes || 0) * 60000;
  return new Date(utcMs).toISOString();
}
