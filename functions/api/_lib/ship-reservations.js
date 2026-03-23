import { json } from '../auth/_lib/auth.js';

function text(value) {
  return String(value || '').trim();
}

export const SHIP_RESERVATION_HOLD_SECONDS = 60;
export const SHIP_RESERVATION_COOLDOWN_SECONDS = 60;

export async function ensureShipReservationTables(env) {
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS voyage_ship_reservations (
         id INTEGER PRIMARY KEY AUTOINCREMENT,
         reservation_token TEXT NOT NULL UNIQUE,
         ship_id INTEGER NOT NULL,
         reserved_by_employee_id INTEGER NOT NULL,
         reserved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
         expires_at TEXT NOT NULL
       )`
    ),
    env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_voyage_ship_reservations_expires
       ON voyage_ship_reservations(expires_at)`
    ),
    env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_voyage_ship_reservations_ship_active
       ON voyage_ship_reservations(ship_id, expires_at)`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS voyage_ship_reservation_cooldowns (
         employee_id INTEGER PRIMARY KEY,
         cooldown_until TEXT NOT NULL,
         updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
       )`
    ),
    env.DB.prepare(
      `CREATE INDEX IF NOT EXISTS idx_voyage_ship_reservation_cooldowns_until
       ON voyage_ship_reservation_cooldowns(cooldown_until)`
    )
  ]);
}

export async function purgeExpiredShipReservations(env) {
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM voyage_ship_reservations WHERE expires_at <= CURRENT_TIMESTAMP`),
    env.DB.prepare(`DELETE FROM voyage_ship_reservation_cooldowns WHERE cooldown_until <= CURRENT_TIMESTAMP`)
  ]);
}

export async function getShipReservationCooldown(env, employeeId) {
  const row = await env.DB
    .prepare(
      `SELECT
         cooldown_until,
         CAST((strftime('%s', cooldown_until) - strftime('%s', CURRENT_TIMESTAMP)) AS INTEGER) AS seconds_left
       FROM voyage_ship_reservation_cooldowns
       WHERE employee_id = ?
         AND cooldown_until > CURRENT_TIMESTAMP
       LIMIT 1`
    )
    .bind(Number(employeeId || 0))
    .first();
  const secondsLeft = Math.max(0, Number(row?.seconds_left || 0));
  return {
    active: secondsLeft > 0,
    secondsLeft,
    cooldownUntil: row?.cooldown_until || null
  };
}

async function selectRandomAvailableShip(env) {
  return env.DB
    .prepare(
      `SELECT
         s.id,
         s.ship_name,
         s.vessel_class,
         s.vessel_callsign
       FROM shipyard_ships s
       WHERE COALESCE(s.is_active, 1) = 1
         AND TRIM(COALESCE(s.ship_name, '')) <> ''
         AND TRIM(COALESCE(s.vessel_class, '')) <> ''
         AND TRIM(COALESCE(s.vessel_callsign, '')) <> ''
         AND NOT EXISTS (
           SELECT 1
           FROM voyages v
           WHERE v.deleted_at IS NULL
             AND v.status = 'ONGOING'
             AND LOWER(COALESCE(v.vessel_callsign, '')) = LOWER(COALESCE(s.vessel_callsign, ''))
         )
         AND NOT EXISTS (
           SELECT 1
           FROM voyage_ship_reservations r
           WHERE r.ship_id = s.id
             AND r.expires_at > CURRENT_TIMESTAMP
         )
       ORDER BY RANDOM()
       LIMIT 1`
    )
    .first();
}

export async function reserveShipForStart(env, employeeId) {
  const numericEmployeeId = Number(employeeId || 0);
  if (!Number.isInteger(numericEmployeeId) || numericEmployeeId <= 0) {
    return json({ error: 'Employee profile required.' }, 403);
  }

  await ensureShipReservationTables(env);
  await purgeExpiredShipReservations(env);

  const cooldown = await getShipReservationCooldown(env, numericEmployeeId);
  if (cooldown.active) {
    return json(
      {
        error: `Please wait ${cooldown.secondsLeft}s before starting another voyage.`,
        cooldown: {
          secondsLeft: cooldown.secondsLeft,
          cooldownUntil: cooldown.cooldownUntil
        }
      },
      429
    );
  }

  await env.DB.prepare('DELETE FROM voyage_ship_reservations WHERE reserved_by_employee_id = ?').bind(numericEmployeeId).run();

  const ship = await selectRandomAvailableShip(env);
  if (!ship) {
    return json({ error: 'No ships are currently available. Wait for an active voyage to end or add more ships.' }, 409);
  }

  const token = text(crypto.randomUUID?.()) || `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  await env.DB
    .prepare(
      `INSERT INTO voyage_ship_reservations
       (reservation_token, ship_id, reserved_by_employee_id, expires_at)
       VALUES (?, ?, ?, datetime('now', ?))`
    )
    .bind(token, Number(ship.id), numericEmployeeId, `+${SHIP_RESERVATION_HOLD_SECONDS} seconds`)
    .run();

  const row = await env.DB
    .prepare(
      `SELECT
         r.reservation_token,
         r.ship_id,
         r.expires_at,
         s.ship_name,
         s.vessel_callsign,
         s.vessel_class
       FROM voyage_ship_reservations r
       JOIN shipyard_ships s ON s.id = r.ship_id
       WHERE r.reservation_token = ?
       LIMIT 1`
    )
    .bind(token)
    .first();

  return json({
    reservation: {
      token,
      shipId: Number(row?.ship_id || ship.id || 0),
      vesselName: text(row?.ship_name),
      vesselCallsign: text(row?.vessel_callsign),
      vesselClass: text(row?.vessel_class),
      expiresAt: row?.expires_at || null,
      holdSeconds: SHIP_RESERVATION_HOLD_SECONDS
    }
  });
}

export async function releaseShipReservation(env, employeeId, reservationToken, options = {}) {
  const numericEmployeeId = Number(employeeId || 0);
  const token = text(reservationToken);
  if (!Number.isInteger(numericEmployeeId) || numericEmployeeId <= 0 || !token) {
    return { released: false, cooldown: null };
  }

  await ensureShipReservationTables(env);
  await purgeExpiredShipReservations(env);

  const existing = await env.DB
    .prepare(
      `SELECT id
       FROM voyage_ship_reservations
       WHERE reservation_token = ?
         AND reserved_by_employee_id = ?
       LIMIT 1`
    )
    .bind(token, numericEmployeeId)
    .first();
  if (!existing?.id) {
    return { released: false, cooldown: null };
  }

  await env.DB.prepare('DELETE FROM voyage_ship_reservations WHERE id = ?').bind(Number(existing.id)).run();
  if (!options.applyCooldown) {
    return { released: true, cooldown: null };
  }

  await env.DB
    .prepare(
      `INSERT INTO voyage_ship_reservation_cooldowns (employee_id, cooldown_until, updated_at)
       VALUES (?, datetime('now', ?), CURRENT_TIMESTAMP)
       ON CONFLICT(employee_id) DO UPDATE SET
         cooldown_until = excluded.cooldown_until,
         updated_at = CURRENT_TIMESTAMP`
    )
    .bind(numericEmployeeId, `+${SHIP_RESERVATION_COOLDOWN_SECONDS} seconds`)
    .run();

  const cooldown = await getShipReservationCooldown(env, numericEmployeeId);
  return {
    released: true,
    cooldown: {
      secondsLeft: cooldown.secondsLeft,
      cooldownUntil: cooldown.cooldownUntil
    }
  };
}

export async function getActiveReservationForStart(env, employeeId, reservationToken) {
  const numericEmployeeId = Number(employeeId || 0);
  const token = text(reservationToken);
  if (!Number.isInteger(numericEmployeeId) || numericEmployeeId <= 0 || !token) return null;

  await ensureShipReservationTables(env);
  await purgeExpiredShipReservations(env);

  const row = await env.DB
    .prepare(
      `SELECT
         r.id,
         r.reservation_token,
         r.ship_id,
         r.expires_at,
         s.ship_name,
         s.vessel_class,
         s.vessel_callsign
       FROM voyage_ship_reservations r
       JOIN shipyard_ships s ON s.id = r.ship_id
       WHERE r.reservation_token = ?
         AND r.reserved_by_employee_id = ?
         AND r.expires_at > CURRENT_TIMESTAMP
       LIMIT 1`
    )
    .bind(token, numericEmployeeId)
    .first();
  if (!row?.id) return null;
  return {
    id: Number(row.id),
    token: text(row.reservation_token),
    shipId: Number(row.ship_id || 0),
    vesselName: text(row.ship_name),
    vesselClass: text(row.vessel_class),
    vesselCallsign: text(row.vessel_callsign),
    expiresAt: row.expires_at || null
  };
}
