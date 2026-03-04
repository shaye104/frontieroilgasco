import { dismissLiveNotification, getLiveNotifications } from './admin-api.js?v=20260304a';

let initialized = false;
let lastId = 0;
let pollTimer = null;
const seenNotificationIds = new Set();
const dismissedNotificationIds = new Set();
const DISMISSED_STORAGE_KEY = 'fog_live_notifications_dismissed_ids_v1';
let pendingSoundSeverity = '';
let retrySoundBound = false;
let liveAudioContext = null;
const pendingSoundQueue = [];
const activeAudioElements = new Set();
const DEFAULT_SOUND_URL = '/MorseAlert.mp3';
const liveSoundUrls = {
  standard: DEFAULT_SOUND_URL,
  urgent: DEFAULT_SOUND_URL
};
const NOTIFICATION_AUTO_EXPIRE_MS = 30 * 60 * 1000;
const ACTIVE_POLL_INTERVAL_MS = 7000;
const BACKGROUND_POLL_INTERVAL_MS = 15000;

function text(value) {
  return String(value || '').trim();
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function ensureToastRoot() {
  let root = document.querySelector('#liveNotificationsRoot');
  if (root) return root;
  root = document.createElement('div');
  root.id = 'liveNotificationsRoot';
  root.className = 'live-notifications-root';
  document.body.append(root);
  return root;
}

function loadDismissedNotificationIds() {
  try {
    const raw = window.localStorage.getItem(DISMISSED_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    parsed
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
      .forEach((value) => dismissedNotificationIds.add(value));
  } catch {
    // no-op
  }
}

function persistDismissedNotificationIds() {
  try {
    const ids = [...dismissedNotificationIds].slice(-500);
    window.localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // no-op
  }
}

function markNotificationDismissed(notificationId) {
  const id = Number(notificationId || 0);
  if (!id) return;
  dismissedNotificationIds.add(id);
  persistDismissedNotificationIds();
}

function bindRetryAfterInteraction() {
  if (retrySoundBound) return;
  retrySoundBound = true;
  const retry = () => {
    const context = getAudioContext();
    if (context && context.state === 'suspended') {
      void context.resume().catch(() => {});
    }
    flushPendingSounds();
    const severity = pendingSoundSeverity;
    if (!severity) return;
    pendingSoundSeverity = '';
    void playNotificationSound(severity);
  };
  document.addEventListener('pointerdown', retry, { passive: true, capture: true });
  document.addEventListener('keydown', retry, { passive: true, capture: true });
  document.addEventListener('touchstart', retry, { passive: true, capture: true });
}

function getAudioContext() {
  if (liveAudioContext) return liveAudioContext;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  liveAudioContext = new AudioCtx();
  liveAudioContext.onstatechange = () => {
    if (liveAudioContext?.state === 'running') {
      flushPendingSounds();
    }
  };
  return liveAudioContext;
}

function enqueuePendingSound(severity) {
  if (!severity) return;
  if (pendingSoundQueue.length >= 20) pendingSoundQueue.shift();
  pendingSoundQueue.push(severity);
}

function flushPendingSounds() {
  if (!pendingSoundQueue.length) return;
  const queue = pendingSoundQueue.splice(0, pendingSoundQueue.length);
  queue.forEach((severity, index) => {
    window.setTimeout(() => {
      void playNotificationSound(severity);
    }, index * 180);
  });
}

function normalizeSoundUrl(value, fallback) {
  const normalized = String(value || '').trim();
  if (!normalized) return fallback;
  if (normalized.startsWith('/')) return normalized;
  if (/^https?:\/\//i.test(normalized)) return normalized;
  if (normalized.startsWith('data:audio/')) return normalized;
  return fallback;
}

function applySoundConfig(payload) {
  const sounds = payload && typeof payload === 'object' ? payload.sounds || {} : {};
  liveSoundUrls.standard = normalizeSoundUrl(sounds.standard, DEFAULT_SOUND_URL);
  liveSoundUrls.urgent = normalizeSoundUrl(sounds.urgent, liveSoundUrls.standard || DEFAULT_SOUND_URL);
}

function trackAudioElement(audio) {
  activeAudioElements.add(audio);
  const cleanup = () => {
    activeAudioElements.delete(audio);
  };
  audio.addEventListener('ended', cleanup, { once: true });
  audio.addEventListener('error', cleanup, { once: true });
  window.setTimeout(cleanup, 120_000);
}

async function playConfiguredSound(severity) {
  const key = severity === 'URGENT' ? 'urgent' : 'standard';
  const url = String(liveSoundUrls[key] || '').trim();
  if (!url) return false;

  const first = new Audio(url);
  first.preload = 'auto';
  first.volume = 1;
  first.playsInline = true;
  trackAudioElement(first);
  await first.play();

  if (severity === 'URGENT') {
    const followup = new Audio(url);
    followup.preload = 'auto';
    followup.volume = 1;
    followup.playsInline = true;
    trackAudioElement(followup);
    window.setTimeout(() => {
      void followup.play().catch(() => {
        // no-op
      });
    }, 420);
  }

  return true;
}

async function playFallbackBeep(severity) {
  const context = getAudioContext();
  if (!context) return false;
  if (context.state === 'suspended') await context.resume();
  const now = context.currentTime;
  const pattern = severity === 'URGENT'
    ? [
        { start: 0.00, end: 0.08, hzA: 1120, hzB: 980, gain: 0.28, type: 'square' },
        { start: 0.11, end: 0.19, hzA: 1120, hzB: 980, gain: 0.28, type: 'square' },
        { start: 0.22, end: 0.30, hzA: 1120, hzB: 980, gain: 0.28, type: 'square' },
        { start: 0.38, end: 0.60, hzA: 1280, hzB: 1020, gain: 0.30, type: 'sawtooth' },
        { start: 0.64, end: 0.86, hzA: 1280, hzB: 1020, gain: 0.30, type: 'sawtooth' },
        { start: 0.90, end: 1.12, hzA: 1280, hzB: 1020, gain: 0.30, type: 'sawtooth' },
        { start: 1.20, end: 1.28, hzA: 1120, hzB: 980, gain: 0.30, type: 'square' },
        { start: 1.31, end: 1.39, hzA: 1120, hzB: 980, gain: 0.30, type: 'square' },
        { start: 1.42, end: 1.50, hzA: 1120, hzB: 980, gain: 0.30, type: 'square' }
      ]
    : [
        { start: 0.00, end: 0.12, hzA: 960, hzB: 840, gain: 0.16, type: 'triangle' },
        { start: 0.18, end: 0.30, hzA: 1180, hzB: 980, gain: 0.17, type: 'triangle' },
        { start: 0.36, end: 0.48, hzA: 960, hzB: 840, gain: 0.16, type: 'triangle' }
      ];

  for (const pulse of pattern) {
    const gain = context.createGain();
    gain.connect(context.destination);
    gain.gain.setValueAtTime(0.0001, now + pulse.start);
    gain.gain.exponentialRampToValueAtTime(pulse.gain, now + pulse.start + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + pulse.end);

    const osc = context.createOscillator();
    osc.type = pulse.type;
    osc.frequency.setValueAtTime(pulse.hzA, now + pulse.start);
    osc.frequency.exponentialRampToValueAtTime(pulse.hzB, now + pulse.end);
    osc.connect(gain);
    osc.start(now + pulse.start);
    osc.stop(now + pulse.end + 0.01);
  }
  return true;
}

async function playNotificationSound(severity) {
  const normalizedSeverity = String(severity || '').toUpperCase() === 'URGENT' ? 'URGENT' : 'STANDARD';
  try {
    const playedUrl = await playConfiguredSound(normalizedSeverity);
    if (playedUrl) {
      if (normalizedSeverity === 'URGENT') {
        void playFallbackBeep('URGENT').catch(() => {
          // no-op
        });
      }
      return;
    }
  } catch {
    // no-op
  }
  try {
    const playedFallback = await playFallbackBeep(normalizedSeverity);
    if (playedFallback) return;
  } catch {
    // no-op
  }
  try {
    enqueuePendingSound(normalizedSeverity);
    pendingSoundSeverity = normalizedSeverity;
    bindRetryAfterInteraction();
  } catch {
    // no-op
  }
}

function parseTimestampMs(value) {
  const raw = String(value || '').trim();
  if (!raw) return 0;
  const parsedNative = Date.parse(raw);
  if (Number.isFinite(parsedNative)) return parsedNative;
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T');
  const parsedUtc = Date.parse(`${normalized}Z`);
  if (Number.isFinite(parsedUtc)) return parsedUtc;
  return 0;
}

function notificationExpiryMs(notification) {
  const explicit = parseTimestampMs(notification?.expiresAt || notification?.expires_at);
  if (explicit > 0) return explicit;
  const createdAt = parseTimestampMs(notification?.createdAt || notification?.created_at);
  if (createdAt > 0) return createdAt + NOTIFICATION_AUTO_EXPIRE_MS;
  return Date.now() + NOTIFICATION_AUTO_EXPIRE_MS;
}

function showToast(notification) {
  const root = ensureToastRoot();
  const toast = document.createElement('article');
  const severity = text(notification.severity).toUpperCase() === 'URGENT' ? 'URGENT' : 'STANDARD';
  toast.className = `live-notification-toast ${severity === 'URGENT' ? 'is-urgent' : 'is-standard'}`;
  toast.innerHTML = `
    <div class="live-notification-head">
      <span class="live-notification-badge">${severity}</span>
      <button class="live-notification-close" type="button" aria-label="Close">×</button>
    </div>
    <h4>${escapeHtml(text(notification.title) || 'Notification')}</h4>
    <p>${escapeHtml(text(notification.message) || '')}</p>
    <small>From ${escapeHtml(text(notification.senderName) || 'System')}</small>
  `;
  root.append(toast);

  let isClosed = false;
  let expiryTimer = null;

  const cleanup = () => {
    if (isClosed) return;
    isClosed = true;
    if (expiryTimer) window.clearTimeout(expiryTimer);
    toast.classList.add('is-leaving');
    window.setTimeout(() => toast.remove(), 220);
  };
  toast.querySelector('.live-notification-close')?.addEventListener('click', () => {
    const notificationId = Number(notification?.id || 0);
    if (notificationId > 0) {
      markNotificationDismissed(notificationId);
      void dismissLiveNotification(notificationId).catch(() => {
        // Local dismissal is still honored as fallback.
      });
    }
    cleanup();
  });

  const expiresAtMs = notificationExpiryMs(notification);
  const ttlMs = Math.max(1_000, expiresAtMs - Date.now());
  expiryTimer = window.setTimeout(cleanup, ttlMs);
}

function handleIncomingNotification(notification) {
  if (document.hidden || !document.hasFocus()) return;
  const id = Number(notification?.id || 0);
  if (id > 0) {
    if (dismissedNotificationIds.has(id)) return;
    if (seenNotificationIds.has(id)) return;
    seenNotificationIds.add(id);
  }
  showToast(notification);
  playNotificationSound(text(notification.severity).toUpperCase());
}

async function pollOnce() {
  try {
    const payload = await getLiveNotifications(lastId, {
      currentPath: window.location.pathname || '/',
      visible: !document.hidden,
      focused: document.hasFocus()
    });
    applySoundConfig(payload);
    const notifications = Array.isArray(payload?.notifications) ? payload.notifications : [];
    if (Number(payload?.lastId) > lastId) lastId = Number(payload.lastId);
    if (!notifications.length) return;
    notifications.forEach((notification) => handleIncomingNotification(notification));
  } catch {
    // Keep polling non-fatal.
  }
}

function schedule() {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    void pollOnce();
  }, document.hidden ? BACKGROUND_POLL_INTERVAL_MS : ACTIVE_POLL_INTERVAL_MS);
}

export function initLiveNotifications() {
  if (initialized) return;
  initialized = true;
  loadDismissedNotificationIds();
  bindRetryAfterInteraction();
  window.addEventListener('fog:live-notification-sent', (event) => {
    const notification = event?.detail?.notification;
    if (!notification) return;
    handleIncomingNotification(notification);
  });
  void pollOnce();
  schedule();
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) flushPendingSounds();
    void pollOnce();
    schedule();
  });
}
