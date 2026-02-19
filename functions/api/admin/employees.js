import { json } from '../auth/_lib/auth.js';
import { requireAdmin } from './_lib/admin-auth.js';
import { normalizeDiscordUserId } from '../_lib/db.js';

export async function onRequestGet(context) {
  const { env } = context;
  const { errorResponse } = await requireAdmin(context);
  if (errorResponse) return errorResponse;

  const result = await env.DB.prepare(
    `SELECT id, discord_user_id, roblox_username, roblox_user_id, rank, grade, serial_number, employee_status, hire_date, updated_at
     FROM employees
     ORDER BY id DESC`
  ).all();

  return json({ employees: result?.results || [] });
}

export async function onRequestPost(context) {
  const { env } = context;
  const { errorResponse } = await requireAdmin(context);
  if (errorResponse) return errorResponse;

  let payload;
  try {
    payload = await context.request.json();
  } catch {
    return json({ error: 'Invalid JSON payload.' }, 400);
  }

  const discordUserId = normalizeDiscordUserId(payload?.discordUserId);
  if (!/^\d{6,30}$/.test(discordUserId)) {
    return json({ error: 'discordUserId is required and must be a Discord snowflake.' }, 400);
  }

  try {
    await env.DB.prepare(
      `INSERT INTO employees
       (discord_user_id, roblox_username, roblox_user_id, rank, grade, serial_number, employee_status, hire_date, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
      .bind(
        discordUserId,
        String(payload?.robloxUsername || '').trim(),
        String(payload?.robloxUserId || '').trim(),
        String(payload?.rank || '').trim(),
        String(payload?.grade || '').trim(),
        String(payload?.serialNumber || '').trim(),
        String(payload?.employeeStatus || '').trim(),
        String(payload?.hireDate || '').trim()
      )
      .run();
  } catch (error) {
    return json({ error: error.message || 'Unable to create employee.' }, 500);
  }

  const created = await env.DB.prepare('SELECT * FROM employees WHERE discord_user_id = ?').bind(discordUserId).first();
  return json({ employee: created }, 201);
}
