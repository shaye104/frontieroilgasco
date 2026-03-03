import { getLiveNotifications } from './admin-api.js';

let initialized = false;
let lastId = 0;
let pollTimer = null;
let standardSoundUrl = '';
let urgentSoundUrl = '';
let muted = false;
let audioBlockedHintShown = false;

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

function toastDuration(severity) {
  return severity === 'URGENT' ? 9000 : 6000;
}

function playNotificationSound(severity) {
  if (muted) return;
  const source = severity === 'URGENT' ? urgentSoundUrl : standardSoundUrl;
  if (!source) return;
  try {
    const audio = new Audio(source);
    audio.volume = severity === 'URGENT' ? 0.9 : 0.75;
    const promise = audio.play();
    if (promise && typeof promise.catch === 'function') {
      promise.catch(() => {
        if (audioBlockedHintShown) return;
        audioBlockedHintShown = true;
        showToast({
          severity: 'STANDARD',
          title: 'Notification sounds blocked',
          message: 'Click anywhere on the page once, then sounds will work.',
          senderName: 'System'
        });
      });
    }
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
  toast.querySelector('.live-notification-close')?.addEventListener('click', cleanup);
  window.setTimeout(cleanup, toastDuration(severity));
}

async function pollOnce() {
  try {
    const payload = await getLiveNotifications(lastId);
    standardSoundUrl = text(payload?.sounds?.standard);
    urgentSoundUrl = text(payload?.sounds?.urgent);
    const notifications = Array.isArray(payload?.notifications) ? payload.notifications : [];
    if (Number(payload?.lastId) > lastId) lastId = Number(payload.lastId);
    if (!notifications.length) return;
    notifications.forEach((notification) => {
      showToast(notification);
      playNotificationSound(text(notification.severity).toUpperCase());
    });
  } catch {
    // Keep polling non-fatal.
  }
}

function schedule() {
  if (pollTimer) window.clearInterval(pollTimer);
  pollTimer = window.setInterval(() => {
    void pollOnce();
  }, 15000);
}

function initMuteToggle() {
  muted = window.localStorage.getItem('fog_notifications_muted') === '1';
  const nav = document.querySelector('.site-nav');
  if (!nav) return;
  const muteBtn = document.createElement('button');
  muteBtn.type = 'button';
  muteBtn.className = 'btn btn-secondary';
  muteBtn.textContent = muted ? 'Unmute Alerts' : 'Mute Alerts';
  muteBtn.addEventListener('click', () => {
    muted = !muted;
    window.localStorage.setItem('fog_notifications_muted', muted ? '1' : '0');
    muteBtn.textContent = muted ? 'Unmute Alerts' : 'Mute Alerts';
  });
  nav.prepend(muteBtn);
}

export function initLiveNotifications() {
  if (initialized) return;
  initialized = true;
  initMuteToggle();
  void pollOnce();
  schedule();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (pollTimer) window.clearInterval(pollTimer);
      pollTimer = window.setInterval(() => {
        void pollOnce();
      }, 30000);
      return;
    }
    void pollOnce();
    schedule();
  });
}
