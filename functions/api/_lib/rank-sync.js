const encoder = new TextEncoder();

function text(value) {
  return String(value || '').trim();
}

function toHex(buffer) {
  const bytes = new Uint8Array(buffer);
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

async function signHmacSha256(secret, payload) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return toHex(sig);
}

export function getRankSyncConfig(env) {
  return {
    webhookUrl: text(env?.RANK_SYNC_WEBHOOK_URL),
    secret: text(env?.RANK_SYNC_SECRET),
    timeoutMs: Math.max(1000, Number(env?.RANK_SYNC_TIMEOUT_MS || 5000))
  };
}

export async function sendRankSyncWebhook(env, payload) {
  const { webhookUrl, secret, timeoutMs } = getRankSyncConfig(env);
  if (!webhookUrl || !secret) {
    return { ok: false, skipped: true, error: 'Rank sync webhook not configured.', webhookUrl: webhookUrl || null };
  }

  const timestamp = String(Date.now());
  const body = JSON.stringify(payload || {});
  const base = `${timestamp}.${body}`;
  const signature = await signHmacSha256(secret, base);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'x-rank-signature': `sha256=${signature}`,
        'x-rank-timestamp': timestamp,
        'x-rank-event': text(payload?.event || 'employee.rank.changed')
      },
      body,
      signal: controller.signal
    });

    const responseText = text(await response.text());
    return {
      ok: response.ok,
      skipped: false,
      status: response.status,
      responseText: responseText.slice(0, 500),
      webhookUrl
    };
  } catch (error) {
    return {
      ok: false,
      skipped: false,
      error: text(error?.message || 'Webhook request failed.'),
      webhookUrl
    };
  } finally {
    clearTimeout(timer);
  }
}
