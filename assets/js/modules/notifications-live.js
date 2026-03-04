import { dismissLiveNotification, getLiveNotifications } from './admin-api.js?v=20260303e';

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
  if (document.hidden) return;
  if (!pendingSoundQueue.length) return;
  const queue = pendingSoundQueue.splice(0, pendingSoundQueue.length);
  queue.forEach((severity, index) => {
    window.setTimeout(() => {
      void playNotificationSound(severity);
    }, index * 180);
  });
}

async function playFallbackBeep(severity) {
  const context = getAudioContext();
  if (!context) return false;
  if (context.state === 'suspended') await context.resume();
  const now = context.currentTime;
  const pattern = severity === 'URGENT'
    ? [
        { start: 0.0, end: 0.10, hz: 920, gain: 0.16, type: 'triangle' },
        { start: 0.16, end: 0.26, hz: 920, gain: 0.16, type: 'triangle' },
        { start: 0.32, end: 0.44, hz: 920, gain: 0.18, type: 'triangle' }
      ]
    : [
        { start: 0.0, end: 0.09, hz: 880, gain: 0.10, type: 'sine' },
        { start: 0.14, end: 0.23, hz: 1040, gain: 0.10, type: 'sine' }
      ];

  for (const pulse of pattern) {
    const gain = context.createGain();
    gain.connect(context.destination);
    gain.gain.setValueAtTime(0.0001, now + pulse.start);
    gain.gain.exponentialRampToValueAtTime(pulse.gain, now + pulse.start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + pulse.end);

    const osc = context.createOscillator();
    osc.type = pulse.type;
    osc.frequency.setValueAtTime(pulse.hz, now + pulse.start);
    osc.connect(gain);
    osc.start(now + pulse.start);
    osc.stop(now + pulse.end + 0.01);
  }
  return true;
}

async function playNotificationSound(severity) {
  if (document.hidden) {
    enqueuePendingSound(severity);
    return;
  }
  try {
    const playedFallback = await playFallbackBeep(severity);
    if (playedFallback) return;
  } catch {
    // no-op
  }
  try {
    enqueuePendingSound(severity);
    pendingSoundSeverity = severity;
    bindRetryAfterInteraction();
  } catch {
    // no-op
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
  bindRetryAfterInteraction();
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
    flushPendingSounds();
    void pollOnce();
    schedule();
  });
}
