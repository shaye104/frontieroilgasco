import { json } from './auth/_lib/auth.js';
import { onRequestGet as onLiveGet } from './notifications/live.js';
import {
  onRequestPatch as onSendPatch,
  onRequestPost as onSendPost,
  onRequestPut as onSendPut
} from './notifications/send.js';

export async function onRequestGet(context) {
  return onLiveGet(context);
}

export async function onRequestPost(context) {
  return onSendPost(context);
}

export async function onRequestPut(context) {
  return onSendPut(context);
}

export async function onRequestPatch(context) {
  return onSendPatch(context);
}

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
  if (method === 'OPTIONS') return onRequestOptions(context);
  return json({ error: 'Method not allowed.' }, 405);
}
