import { json } from '../../auth/_lib/auth.js';
import { requirePermission } from '../_lib/admin-auth.js';

function text(value) {
  return String(value || '').trim();
}

function parseEmployeeId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

async function serialExists(env, serialNumber, excludeEmployeeId = null) {
  const serial = text(serialNumber);
  if (!serial) return false;
  let sql = `SELECT 1 AS hit FROM employees WHERE TRIM(COALESCE(serial_number, '')) = ?`;
  const binds = [serial];
  if (Number.isInteger(excludeEmployeeId) && excludeEmployeeId > 0) {
    sql += ' AND id != ?';
    binds.push(excludeEmployeeId);
  }
  sql += ' LIMIT 1';
  const row = await env.DB.prepare(sql).bind(...binds).first();
  return Boolean(row?.hit);
}

async function generateRandomSerial(env, excludeEmployeeId = null) {
  for (let i = 0; i < 2500; i += 1) {
    const candidate = String(Math.floor(1000 + Math.random() * 9000));
    const exists = await serialExists(env, candidate, excludeEmployeeId);
    if (!exists) return candidate;
  }
  return null;
}

export async function onRequestGet(context) {
  const { env, request } = context;
  const { errorResponse } = await requirePermission(context, ['employees.create', 'employees.edit']);
  if (errorResponse) return errorResponse;

  const url = new URL(request.url);
  const serial = text(url.searchParams.get('serial'));
  const random = text(url.searchParams.get('random')) === '1';
  const employeeId = parseEmployeeId(url.searchParams.get('employeeId'));

  if (random) {
    const suggested = await generateRandomSerial(env, employeeId);
    if (!suggested) return json({ error: 'Unable to generate an unused serial number.' }, 500);
    return json({ serial: suggested, available: true });
  }

  if (!serial) return json({ error: 'serial is required.' }, 400);
  const exists = await serialExists(env, serial, employeeId);
  return json({ serial, available: !exists });
}
