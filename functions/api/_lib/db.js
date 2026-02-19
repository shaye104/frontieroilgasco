export async function ensureCoreSchema(env) {
  if (!env.DB) throw new Error('D1 binding `DB` is not configured.');

  const statements = [
    `CREATE TABLE IF NOT EXISTS intranet_allowed_roles (
      role_id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL UNIQUE,
      roblox_username TEXT,
      roblox_user_id TEXT,
      rank TEXT,
      grade TEXT,
      serial_number TEXT,
      employee_status TEXT,
      hire_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS disciplinary_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      record_type TEXT,
      record_date TEXT,
      record_status TEXT,
      notes TEXT,
      issued_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    )`,
    `CREATE TABLE IF NOT EXISTS employee_notes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      note TEXT NOT NULL,
      authored_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    )`,
    `CREATE TABLE IF NOT EXISTS access_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL UNIQUE,
      discord_display_name TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
      reviewed_at TEXT,
      reviewed_by TEXT,
      review_note TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS config_employee_statuses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS config_disciplinary_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS config_ranks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS config_grades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`
  ];

  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));

  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO config_employee_statuses(value) VALUES (?)').bind('Active'),
    env.DB.prepare('INSERT OR IGNORE INTO config_employee_statuses(value) VALUES (?)').bind('On Leave'),
    env.DB.prepare('INSERT OR IGNORE INTO config_employee_statuses(value) VALUES (?)').bind('Suspended'),
    env.DB.prepare('INSERT OR IGNORE INTO config_employee_statuses(value) VALUES (?)').bind('Terminated'),
    env.DB.prepare('INSERT OR IGNORE INTO config_disciplinary_types(value) VALUES (?)').bind('Warning'),
    env.DB.prepare('INSERT OR IGNORE INTO config_disciplinary_types(value) VALUES (?)').bind('Final Warning'),
    env.DB.prepare('INSERT OR IGNORE INTO config_disciplinary_types(value) VALUES (?)').bind('Suspension')
  ]);
}

export async function getEmployeeByDiscordUserId(env, discordUserId) {
  await ensureCoreSchema(env);
  const result = await env.DB.prepare('SELECT * FROM employees WHERE discord_user_id = ?').bind(discordUserId).first();
  return result || null;
}

export async function getEmployeeById(env, employeeId) {
  await ensureCoreSchema(env);
  const result = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  return result || null;
}

export async function createOrRefreshAccessRequest(env, { discordUserId, displayName }) {
  await ensureCoreSchema(env);

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO access_requests (discord_user_id, discord_display_name, status, requested_at)
         VALUES (?, ?, 'pending', CURRENT_TIMESTAMP)`
      )
      .bind(discordUserId, displayName),
    env.DB
      .prepare(
        `UPDATE access_requests
         SET discord_display_name = ?, status = 'pending', requested_at = CURRENT_TIMESTAMP, reviewed_at = NULL, reviewed_by = NULL, review_note = NULL
         WHERE discord_user_id = ? AND status != 'approved'`
      )
      .bind(displayName, discordUserId)
  ]);
}

export function calculateTenureDays(hireDateText) {
  if (!hireDateText) return null;
  const hire = new Date(hireDateText);
  if (Number.isNaN(hire.getTime())) return null;

  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((now.getTime() - hire.getTime()) / msPerDay));
}
