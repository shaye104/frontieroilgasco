import { json } from '../auth/_lib/auth.js';
import { requirePermission } from './_lib/admin-auth.js';
import { readSiteSettings, writeSiteSettings } from '../_lib/site-settings.js';

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse } = await requirePermission(context, ['config.manage']);
  if (errorResponse) return errorResponse;

  const settings = await readSiteSettings(env);
  return json({ settings });
}

export async function onRequestPut(context) {
  const { env } = context;
  const { errorResponse, session } = await requirePermission(context, ['config.manage']);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const updatedBy = session?.displayName || session?.userId || 'system';
  const settings = await writeSiteSettings(env, payload || {}, updatedBy);
  return json({ settings });
}
