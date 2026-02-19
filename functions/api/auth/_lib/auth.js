const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(input) {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function signValue(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return bytesToBase64Url(new Uint8Array(signature));
}

function constantTimeEquals(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i += 1) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader) return out;

  cookieHeader.split(';').forEach((part) => {
    const [rawName, ...rest] = part.trim().split('=');
    if (!rawName || rest.length === 0) return;
    out[rawName] = decodeURIComponent(rest.join('='));
  });

  return out;
}

export function serializeCookie(name, value, options = {}) {
  const segments = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) segments.push(`Max-Age=${options.maxAge}`);
  if (options.path) segments.push(`Path=${options.path}`);
  if (options.httpOnly) segments.push('HttpOnly');
  if (options.secure) segments.push('Secure');
  if (options.sameSite) segments.push(`SameSite=${options.sameSite}`);
  return segments.join('; ');
}

export async function createStateToken(secret, state) {
  const signature = await signValue(secret, state);
  return `${state}.${signature}`;
}

export async function verifyStateToken(secret, token, state) {
  if (!token || !state) return false;
  const [storedState, signature] = token.split('.');
  if (!storedState || !signature || storedState !== state) return false;

  const expected = await signValue(secret, storedState);
  return constantTimeEquals(signature, expected);
}

export async function createSessionToken(secret, payload) {
  const payloadBase64 = bytesToBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = await signValue(secret, payloadBase64);
  return `${payloadBase64}.${signature}`;
}

export async function verifySessionToken(secret, token) {
  if (!token) return null;
  const [payloadBase64, signature] = token.split('.');
  if (!payloadBase64 || !signature) return null;

  const expected = await signValue(secret, payloadBase64);
  if (!constantTimeEquals(signature, expected)) return null;

  try {
    const payload = JSON.parse(decoder.decode(base64UrlToBytes(payloadBase64)));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function readSessionFromRequest(env, request) {
  if (!env?.SESSION_SECRET) return null;
  const cookies = parseCookies(request.headers.get('Cookie'));
  return verifySessionToken(env.SESSION_SECRET, cookies.fog_session);
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export function redirect(to, cookies = []) {
  const headers = new Headers({ Location: to, 'cache-control': 'no-store' });
  cookies.forEach((cookie) => headers.append('Set-Cookie', cookie));
  return new Response(null, { status: 302, headers });
}

export function getRequiredEnv(env, keys) {
  const missing = keys.filter((key) => !env[key]);
  return { missing, ok: missing.length === 0 };
}
