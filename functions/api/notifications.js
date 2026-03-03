export { onRequestGet } from './notifications/live.js';
export { onRequestPost, onRequestPut, onRequestPatch } from './notifications/send.js';
import { json } from './auth/_lib/auth.js';
import { onRequestGet, onRequestOptions as onLiveOptions } from './notifications/live.js';
import { onRequestPatch, onRequestPost, onRequestPut, onRequestOptions as onSendOptions } from './notifications/send.js';

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      allow: 'GET, POST, PUT, PATCH, OPTIONS'
    }
  });
}

export async function onRequest(context) {
  const method = String(context.request.method || '').toUpperCase();
  if (method === 'GET') return onRequestGet(context);
  if (method === 'POST') return onRequestPost(context);
  if (method === 'PUT') return onRequestPut(context);
  if (method === 'PATCH') return onRequestPatch(context);
  if (method === 'OPTIONS') {
    // Keep behavior consistent with both child handlers.
    await onLiveOptions(context);
    await onSendOptions(context);
    return onRequestOptions(context);
  }
  return json({ error: 'Method not allowed.' }, 405);
}
