const DEFAULT_SITE_SETTINGS = {
  brandName: 'Frontier Oil & Gas Company',
  siteTagline: 'Internal Operations Portal',
  themeColor: '#112d72',
  headerLogoUrl: '',
  faviconUrl: '/assets/brand/favicon.svg',
  appleTouchIconUrl: '/assets/brand/favicon.svg',
  ogTitle: 'Frontier Oil & Gas Company',
  ogDescription: 'Internal operations portal for voyages, finances, and employee administration.',
  ogImageUrl: '/assets/brand/og-default.svg',
  twitterCard: 'summary_large_image',
  notificationSoundStandardUrl: '',
  notificationSoundUrgentUrl: ''
};

let settingsCache = null;
let settingsCacheAt = 0;
const SETTINGS_CACHE_TTL_MS = 30_000;

function normalizeSettingValue(value, fallback = '') {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizeThemeColor(value) {
  const normalized = normalizeSettingValue(value, DEFAULT_SITE_SETTINGS.themeColor);
  if (/^#[0-9a-fA-F]{6}$/.test(normalized) || /^#[0-9a-fA-F]{3}$/.test(normalized)) return normalized;
  return DEFAULT_SITE_SETTINGS.themeColor;
}

function normalizeUrlValue(value, fallback) {
  const normalized = normalizeSettingValue(value, fallback);
  if (normalized.startsWith('/')) return normalized;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return fallback;
}

function normalizeOptionalUrlValue(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';
  if (normalized.startsWith('/')) return normalized;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  return '';
}

export function getDefaultSiteSettings() {
  return { ...DEFAULT_SITE_SETTINGS };
}

export async function ensureSiteSettingsSchema(env) {
  if (!env?.DB) return;
  await env.DB
    .prepare(
      `CREATE TABLE IF NOT EXISTS site_settings (
        setting_key TEXT PRIMARY KEY,
        setting_value TEXT NOT NULL,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT
      )`
    )
    .run();
}

export async function readSiteSettings(env, { bypassCache = false } = {}) {
  const now = Date.now();
  if (!bypassCache && settingsCache && now - settingsCacheAt < SETTINGS_CACHE_TTL_MS) {
    return { ...settingsCache };
  }

  await ensureSiteSettingsSchema(env);
  const rows = await env.DB.prepare('SELECT setting_key, setting_value FROM site_settings').all();
  const map = Object.create(null);
  for (const row of rows?.results || []) {
    map[String(row.setting_key || '').trim()] = String(row.setting_value || '');
  }

  const next = {
    brandName: normalizeSettingValue(map.brandName, DEFAULT_SITE_SETTINGS.brandName),
    siteTagline: normalizeSettingValue(map.siteTagline, DEFAULT_SITE_SETTINGS.siteTagline),
    themeColor: normalizeThemeColor(map.themeColor),
    headerLogoUrl: normalizeOptionalUrlValue(map.headerLogoUrl),
    faviconUrl: normalizeUrlValue(map.faviconUrl, DEFAULT_SITE_SETTINGS.faviconUrl),
    appleTouchIconUrl: normalizeUrlValue(map.appleTouchIconUrl, DEFAULT_SITE_SETTINGS.appleTouchIconUrl),
    ogTitle: normalizeSettingValue(map.ogTitle, DEFAULT_SITE_SETTINGS.ogTitle),
    ogDescription: normalizeSettingValue(map.ogDescription, DEFAULT_SITE_SETTINGS.ogDescription),
    ogImageUrl: normalizeUrlValue(map.ogImageUrl, DEFAULT_SITE_SETTINGS.ogImageUrl),
    twitterCard: normalizeSettingValue(map.twitterCard, DEFAULT_SITE_SETTINGS.twitterCard),
    notificationSoundStandardUrl: normalizeOptionalUrlValue(map.notificationSoundStandardUrl),
    notificationSoundUrgentUrl: normalizeOptionalUrlValue(map.notificationSoundUrgentUrl)
  };

  settingsCache = { ...next };
  settingsCacheAt = now;
  return next;
}

export async function writeSiteSettings(env, updates, updatedBy = '') {
  await ensureSiteSettingsSchema(env);
  const merged = {
    ...(await readSiteSettings(env, { bypassCache: true })),
    ...updates
  };

  const normalized = {
    brandName: normalizeSettingValue(merged.brandName, DEFAULT_SITE_SETTINGS.brandName),
    siteTagline: normalizeSettingValue(merged.siteTagline, DEFAULT_SITE_SETTINGS.siteTagline),
    themeColor: normalizeThemeColor(merged.themeColor),
    headerLogoUrl: normalizeOptionalUrlValue(merged.headerLogoUrl),
    faviconUrl: normalizeUrlValue(merged.faviconUrl, DEFAULT_SITE_SETTINGS.faviconUrl),
    appleTouchIconUrl: normalizeUrlValue(merged.appleTouchIconUrl, DEFAULT_SITE_SETTINGS.appleTouchIconUrl),
    ogTitle: normalizeSettingValue(merged.ogTitle, DEFAULT_SITE_SETTINGS.ogTitle),
    ogDescription: normalizeSettingValue(merged.ogDescription, DEFAULT_SITE_SETTINGS.ogDescription),
    ogImageUrl: normalizeUrlValue(merged.ogImageUrl, DEFAULT_SITE_SETTINGS.ogImageUrl),
    twitterCard: normalizeSettingValue(merged.twitterCard, DEFAULT_SITE_SETTINGS.twitterCard),
    notificationSoundStandardUrl: normalizeOptionalUrlValue(merged.notificationSoundStandardUrl),
    notificationSoundUrgentUrl: normalizeOptionalUrlValue(merged.notificationSoundUrgentUrl)
  };

  const entries = Object.entries(normalized);
  const actor = String(updatedBy || '').trim() || null;
  for (const [key, value] of entries) {
    await env.DB
      .prepare(
        `INSERT INTO site_settings (setting_key, setting_value, updated_at, updated_by)
         VALUES (?, ?, CURRENT_TIMESTAMP, ?)
         ON CONFLICT(setting_key) DO UPDATE SET
           setting_value = excluded.setting_value,
           updated_at = CURRENT_TIMESTAMP,
           updated_by = excluded.updated_by`
      )
      .bind(key, String(value), actor)
      .run();
  }

  settingsCache = { ...normalized };
  settingsCacheAt = Date.now();
  return normalized;
}

export function toAbsoluteUrl(origin, value, fallback = '') {
  const safeOrigin = String(origin || '').trim();
  const normalized = String(value || '').trim() || String(fallback || '').trim();
  if (!normalized) return '';
  try {
    return new URL(normalized, safeOrigin).toString();
  } catch {
    return normalized;
  }
}
