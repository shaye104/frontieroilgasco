import { dismissLiveNotification, getLiveNotifications } from './admin-api.js?v=20260303e';

let initialized = false;
let lastId = 0;
let pollTimer = null;
let standardSoundUrl = '';
let urgentSoundUrl = '';
const seenNotificationIds = new Set();
const dismissedNotificationIds = new Set();
const DISMISSED_STORAGE_KEY = 'fog_live_notifications_dismissed_ids_v1';
const DEFAULT_SOUND_URL = '/MorseAlert.mp3';
let pendingSoundSeverity = '';
let retrySoundBound = false;
let liveAudioContext = null;

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

function toastDuration(severity) {
  return severity === 'URGENT' ? 9000 : 6000;
}

function getSoundSource(severity) {
  const preferred = severity === 'URGENT' ? urgentSoundUrl : standardSoundUrl;
  const fallback = severity === 'URGENT' ? standardSoundUrl : urgentSoundUrl;
  return text(preferred) || text(fallback) || DEFAULT_SOUND_URL;
}

function bindRetryAfterInteraction() {
  if (retrySoundBound) return;
  retrySoundBound = true;
  const retry = () => {
    const severity = pendingSoundSeverity;
    if (!severity) return;
    pendingSoundSeverity = '';
    void playNotificationSound(severity);
  };
  document.addEventListener('pointerdown', retry, { passive: true });
  document.addEventListener('keydown', retry, { passive: true });
  document.addEventListener('touchstart', retry, { passive: true });
}

function getAudioContext() {
  if (liveAudioContext) return liveAudioContext;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  if (!AudioCtx) return null;
  liveAudioContext = new AudioCtx();
  return liveAudioContext;
}

async function playFallbackBeep(severity) {
  const context = getAudioContext();
  if (!context) return false;
  if (context.state === 'suspended') await context.resume();
  const gain = context.createGain();
  gain.connect(context.destination);
  gain.gain.value = severity === 'URGENT' ? 0.12 : 0.08;

  const now = context.currentTime;
  const toneA = context.createOscillator();
  toneA.type = 'sine';
  toneA.frequency.value = severity === 'URGENT' ? 1050 : 780;
  toneA.connect(gain);
  toneA.start(now);
  toneA.stop(now + 0.11);

  if (severity === 'URGENT') {
    const toneB = context.createOscillator();
    toneB.type = 'square';
    toneB.frequency.value = 1320;
    toneB.connect(gain);
    toneB.start(now + 0.14);
    toneB.stop(now + 0.29);
  }
  return true;
}

async function playNotificationSound(severity) {
  const source = getSoundSource(severity);
  if (!source) {
    await playFallbackBeep(severity).catch(() => {});
    return;
  }
  try {
    const audio = new Audio(source);
    audio.volume = severity === 'URGENT' ? 0.9 : 0.75;
    const promise = audio.play();
    audio.onerror = () => {
      void playFallbackBeep(severity).catch(() => {});
    };
    if (promise && typeof promise.catch === 'function') {
      promise.catch(async () => {
        try {
          const playedFallback = await playFallbackBeep(severity);
          if (playedFallback) return;
        } catch {
          // no-op
        }
        pendingSoundSeverity = severity;
        bindRetryAfterInteraction();
      });
    }
  } catch {
    try {
      const playedFallback = await playFallbackBeep(severity);
      if (playedFallback) return;
    } catch {
      // no-op
    }
    pendingSoundSeverity = severity;
    bindRetryAfterInteraction();
  }
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

  const cleanup = () => {
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
  window.setTimeout(cleanup, toastDuration(severity));
}

function handleIncomingNotification(notification) {
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
    const payload = await getLiveNotifications(lastId);
    standardSoundUrl = text(payload?.sounds?.standard);
    urgentSoundUrl = text(payload?.sounds?.urgent);
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
  }, 7000);
}

export function initLiveNotifications() {
  if (initialized) return;
  initialized = true;
  loadDismissedNotificationIds();
  window.addEventListener('fog:live-notification-sent', (event) => {
    const notification = event?.detail?.notification;
    if (!notification) return;
    handleIncomingNotification(notification);
  });
  void pollOnce();
  schedule();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (pollTimer) window.clearInterval(pollTimer);
      pollTimer = window.setInterval(() => {
        void pollOnce();
      }, 20000);
      return;
    }
    void pollOnce();
    schedule();
  });
}
