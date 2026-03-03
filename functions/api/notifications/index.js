import { json } from '../auth/_lib/auth.js';
import { onRequestGet as onLiveGet, onRequestOptions as onLiveOptions } from './live.js';
import {
  onRequestPatch as onSendPatch,
  onRequestPost as onSendPost,
  onRequestPut as onSendPut,
  onRequestOptions as onSendOptions
} from './send.js';

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
  if (method === 'GET') return onLiveGet(context);
  if (method === 'POST') return onSendPost(context);
  if (method === 'PUT') return onSendPut(context);
  if (method === 'PATCH') return onSendPatch(context);
  if (method === 'OPTIONS') {
    await onLiveOptions(context);
    await onSendOptions(context);
    return onRequestOptions(context);
  }
  return json({ error: 'Method not allowed.' }, 405);
}
