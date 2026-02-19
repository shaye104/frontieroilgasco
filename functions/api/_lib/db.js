export async function ensureCoreSchema(env) {
  if (!env.DB) throw new Error('D1 binding `DB` is not configured.');
  const permissionSeed = [
    ['super.admin', 'roles', 'Super Admin', 'Global bypass permission.'],
    ['admin.access', 'general', 'Admin Panel Access', 'View the admin panel entry points.'],
    ['dashboard.view', 'general', 'Dashboard View', 'Access the intranet dashboard.'],
    ['my_details.view', 'general', 'My Details View', 'View employee self-service details.'],
    ['employees.read', 'employees', 'View Employees', 'View employee lists and employee profiles.'],
    ['employees.create', 'employees', 'Create Employees', 'Create employee records.'],
    ['employees.edit', 'employees', 'Edit Employees', 'Edit employee profile fields.'],
    ['employees.discipline', 'employees', 'Manage Discipline', 'Create and update disciplinary records.'],
    ['employees.notes', 'employees', 'Manage Notes', 'Add employee notes and activity log entries.'],
    ['employees.access_requests.review', 'employees', 'Review Access Requests', 'Approve or deny access requests.'],
    ['config.manage', 'config', 'Manage Config', 'Manage statuses, ranks, grades, and disciplinary types.'],
    ['roles.read', 'roles', 'View Roles', 'View role definitions and permissions.'],
    ['roles.manage', 'roles', 'Manage Roles', 'Create, edit, delete, and reorder roles.'],
    ['forms.read', 'forms', 'View Forms', 'View forms list and form details.'],
    ['forms.submit', 'forms', 'Submit Forms', 'Submit form responses.'],
    ['forms.manage', 'forms', 'Manage Forms', 'Create/edit forms, categories, and question builders.'],
    ['forms.responses.read', 'forms', 'View Form Responses', 'Read form responses.'],
    ['forms.responses.manage', 'forms', 'Manage Form Responses', 'Manage/export/delete responses.'],
    ['voyages.read', 'voyages', 'View Voyages', 'View voyage tracker.'],
    ['voyages.create', 'voyages', 'Create Voyages', 'Create voyage entries.'],
    ['voyages.edit', 'voyages', 'Edit Voyages', 'Edit voyage entries.'],
    ['voyages.delete', 'voyages', 'Delete Voyages', 'Delete voyage entries.'],
    ['fleet.read', 'voyages', 'View Fleet', 'View fleet information.'],
    ['fleet.manage', 'voyages', 'Manage Fleet', 'Manage fleet assignments/settings.']
  ];

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
    )`,
    `CREATE TABLE IF NOT EXISTS app_permissions (
      permission_key TEXT PRIMARY KEY,
      permission_group TEXT NOT NULL,
      label TEXT NOT NULL,
      description TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS app_roles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role_key TEXT UNIQUE,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS app_role_permissions (
      role_id INTEGER NOT NULL,
      permission_key TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(role_id, permission_key),
      FOREIGN KEY(role_id) REFERENCES app_roles(id),
      FOREIGN KEY(permission_key) REFERENCES app_permissions(permission_key)
    )`,
    `CREATE TABLE IF NOT EXISTS employee_role_assignments (
      employee_id INTEGER NOT NULL,
      role_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(employee_id, role_id),
      FOREIGN KEY(employee_id) REFERENCES employees(id),
      FOREIGN KEY(role_id) REFERENCES app_roles(id)
    )`,
    `CREATE TABLE IF NOT EXISTS auth_role_mappings (
      discord_role_id TEXT NOT NULL,
      role_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(discord_role_id, role_id),
      FOREIGN KEY(role_id) REFERENCES app_roles(id)
    )`,
    `CREATE TABLE IF NOT EXISTS form_categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      description TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS forms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      instructions TEXT,
      category_id INTEGER,
      status TEXT NOT NULL DEFAULT 'draft',
      created_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(category_id) REFERENCES form_categories(id)
    )`,
    `CREATE TABLE IF NOT EXISTS form_questions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id INTEGER NOT NULL,
      label TEXT NOT NULL,
      question_type TEXT NOT NULL,
      is_required INTEGER NOT NULL DEFAULT 0,
      help_text TEXT,
      options_json TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(form_id) REFERENCES forms(id)
    )`,
    `CREATE TABLE IF NOT EXISTS form_access_employees (
      form_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(form_id, employee_id),
      FOREIGN KEY(form_id) REFERENCES forms(id),
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    )`,
    `CREATE TABLE IF NOT EXISTS form_access_roles (
      form_id INTEGER NOT NULL,
      role_id TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(form_id, role_id),
      FOREIGN KEY(form_id) REFERENCES forms(id)
    )`,
    `CREATE TABLE IF NOT EXISTS form_responses (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      form_id INTEGER NOT NULL,
      employee_id INTEGER,
      respondent_discord_user_id TEXT NOT NULL,
      submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(form_id) REFERENCES forms(id),
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    )`,
    `CREATE TABLE IF NOT EXISTS form_response_answers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      response_id INTEGER NOT NULL,
      question_id INTEGER NOT NULL,
      answer_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(response_id) REFERENCES form_responses(id),
      FOREIGN KEY(question_id) REFERENCES form_questions(id)
    )`
  ];

  await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));

  await env.DB.batch(
    permissionSeed.map(([permissionKey, permissionGroup, label, description]) =>
      env.DB
        .prepare(
          `INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description)
           VALUES (?, ?, ?, ?)`
        )
        .bind(permissionKey, permissionGroup, label, description)
    )
  );

  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO config_employee_statuses(value) VALUES (?)').bind('Active'),
    env.DB.prepare('INSERT OR IGNORE INTO config_employee_statuses(value) VALUES (?)').bind('On Leave'),
    env.DB.prepare('INSERT OR IGNORE INTO config_employee_statuses(value) VALUES (?)').bind('Suspended'),
    env.DB.prepare('INSERT OR IGNORE INTO config_employee_statuses(value) VALUES (?)').bind('Terminated'),
    env.DB.prepare('INSERT OR IGNORE INTO config_disciplinary_types(value) VALUES (?)').bind('Warning'),
    env.DB.prepare('INSERT OR IGNORE INTO config_disciplinary_types(value) VALUES (?)').bind('Final Warning'),
    env.DB.prepare('INSERT OR IGNORE INTO config_disciplinary_types(value) VALUES (?)').bind('Suspension')
  ]);

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO app_roles (role_key, name, description, sort_order, is_system)
         VALUES ('owner', 'Owner', 'System owner role with full access.', 1, 1)`
      ),
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO app_roles (role_key, name, description, sort_order, is_system)
         VALUES ('employee', 'Employee', 'Default employee intranet access.', 100, 1)`
      )
  ]);

  const ownerRole = await env.DB.prepare(`SELECT id FROM app_roles WHERE role_key = 'owner'`).first();
  const employeeRole = await env.DB.prepare(`SELECT id FROM app_roles WHERE role_key = 'employee'`).first();

  if (ownerRole?.id) {
    await env.DB.batch([
      env.DB
        .prepare(`INSERT OR IGNORE INTO app_role_permissions (role_id, permission_key) VALUES (?, 'super.admin')`)
        .bind(ownerRole.id)
    ]);
  }

  if (employeeRole?.id) {
    await env.DB.batch([
      env.DB
        .prepare(`INSERT OR IGNORE INTO app_role_permissions (role_id, permission_key) VALUES (?, 'dashboard.view')`)
        .bind(employeeRole.id),
      env.DB
        .prepare(`INSERT OR IGNORE INTO app_role_permissions (role_id, permission_key) VALUES (?, 'my_details.view')`)
        .bind(employeeRole.id),
      env.DB
        .prepare(`INSERT OR IGNORE INTO app_role_permissions (role_id, permission_key) VALUES (?, 'forms.read')`)
        .bind(employeeRole.id),
      env.DB
        .prepare(`INSERT OR IGNORE INTO app_role_permissions (role_id, permission_key) VALUES (?, 'forms.submit')`)
        .bind(employeeRole.id),
      env.DB
        .prepare(`INSERT OR IGNORE INTO app_role_permissions (role_id, permission_key) VALUES (?, 'forms.responses.read')`)
        .bind(employeeRole.id),
      env.DB
        .prepare(`INSERT OR IGNORE INTO app_role_permissions (role_id, permission_key) VALUES (?, 'voyages.read')`)
        .bind(employeeRole.id),
      env.DB
        .prepare(`INSERT OR IGNORE INTO app_role_permissions (role_id, permission_key) VALUES (?, 'fleet.read')`)
        .bind(employeeRole.id)
    ]);

    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO employee_role_assignments (employee_id, role_id)
         SELECT e.id, ?
         FROM employees e`
      )
      .bind(employeeRole.id)
      .run();
  }
}

export async function getEmployeeByDiscordUserId(env, discordUserId) {
  await ensureCoreSchema(env);
  const normalized = normalizeDiscordUserId(discordUserId);
  if (!/^\d{6,30}$/.test(normalized)) return null;

  const result = await env.DB.prepare('SELECT * FROM employees WHERE discord_user_id = ?').bind(normalized).first();
  return result || null;
}

export async function getEmployeeById(env, employeeId) {
  await ensureCoreSchema(env);
  const result = await env.DB.prepare('SELECT * FROM employees WHERE id = ?').bind(employeeId).first();
  return result || null;
}

export async function createOrRefreshAccessRequest(env, { discordUserId, displayName }) {
  await ensureCoreSchema(env);
  const normalized = normalizeDiscordUserId(discordUserId);
  if (!/^\d{6,30}$/.test(normalized)) return;

  await env.DB.batch([
    env.DB
      .prepare(
        `INSERT OR IGNORE INTO access_requests (discord_user_id, discord_display_name, status, requested_at)
         VALUES (?, ?, 'pending', CURRENT_TIMESTAMP)`
      )
      .bind(normalized, displayName),
    env.DB
      .prepare(
        `UPDATE access_requests
         SET discord_display_name = ?, status = 'pending', requested_at = CURRENT_TIMESTAMP, reviewed_at = NULL, reviewed_by = NULL, review_note = NULL
         WHERE discord_user_id = ? AND status != 'approved'`
      )
      .bind(displayName, normalized)
  ]);
}

export function normalizeDiscordUserId(value) {
  const raw = String(value ?? '').trim();
  if (/^\d{6,30}$/.test(raw)) return raw;

  // Allow pasted mention-like values such as <@123...> by extracting the snowflake digits.
  const digits = raw.replace(/\D/g, '');
  if (/^\d{6,30}$/.test(digits)) return digits;

  return raw;
}

export function calculateTenureDays(hireDateText) {
  if (!hireDateText) return null;
  const hire = new Date(hireDateText);
  if (Number.isNaN(hire.getTime())) return null;

  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(0, Math.floor((now.getTime() - hire.getTime()) / msPerDay));
}
