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
    ['roles.assign', 'roles', 'Assign Roles', 'Assign and unassign roles for employees.'],
    ['user_groups.read', 'user_groups', 'View User Groups', 'View user group definitions and permissions.'],
    ['user_groups.manage', 'user_groups', 'Manage User Groups', 'Create, edit, delete, and reorder user groups.'],
    ['user_groups.assign', 'user_groups', 'Assign User Groups', 'Assign and unassign user groups for employees.'],
    ['user_ranks.manage', 'user_ranks', 'Manage User Ranks', 'Create, edit, delete, and reorder user ranks.'],
    ['user_ranks.permissions.manage', 'user_ranks', 'Manage User Rank Permissions', 'Edit permission mappings granted by user ranks.'],
    ['admin.override', 'admin', 'Admin Override', 'Grant all permissions across the application.'],
    ['activity_tracker.view', 'activity_tracker', 'View Activity Tracker', 'View employee voyage activity statistics.'],
    ['activity_tracker.manage', 'activity_tracker', 'Manage Activity Tracker', 'Manage advanced activity tracker features.'],
    ['forms.read', 'forms', 'View Forms', 'View forms list and form details.'],
    ['forms.submit', 'forms', 'Submit Forms', 'Submit form responses.'],
    ['forms.manage', 'forms', 'Manage Forms', 'Create/edit forms, categories, and question builders.'],
    ['forms.responses.read', 'forms', 'View Form Responses', 'Read form responses.'],
    ['forms.responses.manage', 'forms', 'Manage Form Responses', 'Manage/export/delete responses.'],
    ['voyages.read', 'voyages', 'View Voyages', 'View voyage tracker.'],
    ['voyages.create', 'voyages', 'Create Voyages', 'Create voyage entries.'],
    ['voyages.edit', 'voyages', 'Edit Voyages', 'Edit voyage entries.'],
    ['voyages.end', 'voyages', 'End Voyages', 'End voyages and finalize voyage accounting.'],
    ['voyages.config.manage', 'voyages', 'Manage Voyage Config', 'Manage voyage config lists for ports and vessels.'],
    ['cargo.manage', 'voyages', 'Manage Cargo', 'Manage cargo type definitions for manifests.'],
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
      level INTEGER NOT NULL DEFAULT 0,
      description TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
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
    `CREATE TABLE IF NOT EXISTS rank_permission_mappings (
      rank_value TEXT NOT NULL,
      permission_key TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(rank_value, permission_key),
      FOREIGN KEY(permission_key) REFERENCES app_permissions(permission_key)
    )`,
    `CREATE TABLE IF NOT EXISTS cargo_types (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      active INTEGER NOT NULL DEFAULT 1,
      default_price REAL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS config_voyage_ports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS config_vessel_names (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS config_vessel_classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS config_vessel_callsigns (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      value TEXT NOT NULL UNIQUE,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS voyages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status TEXT NOT NULL DEFAULT 'ONGOING',
      ship_status TEXT NOT NULL DEFAULT 'IN_PORT',
      owner_employee_id INTEGER NOT NULL,
      departure_port TEXT NOT NULL,
      destination_port TEXT NOT NULL,
      vessel_name TEXT NOT NULL,
      vessel_class TEXT NOT NULL,
      vessel_callsign TEXT NOT NULL,
      officer_of_watch_employee_id INTEGER NOT NULL,
      started_at TEXT DEFAULT CURRENT_TIMESTAMP,
      ended_at TEXT,
      sell_multiplier REAL,
      base_sell_price REAL,
      buy_total REAL,
      effective_sell REAL,
      profit REAL,
      company_share REAL,
      cargo_lost_json TEXT,
      settlement_lines_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(owner_employee_id) REFERENCES employees(id),
      FOREIGN KEY(officer_of_watch_employee_id) REFERENCES employees(id)
    )`,
    `CREATE TABLE IF NOT EXISTS voyage_crew_members (
      voyage_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(voyage_id, employee_id),
      FOREIGN KEY(voyage_id) REFERENCES voyages(id),
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    )`,
    `CREATE TABLE IF NOT EXISTS voyage_participants (
      voyage_id INTEGER NOT NULL,
      employee_id INTEGER NOT NULL,
      role_in_voyage TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(voyage_id, employee_id, role_in_voyage),
      FOREIGN KEY(voyage_id) REFERENCES voyages(id),
      FOREIGN KEY(employee_id) REFERENCES employees(id)
    )`,
    `CREATE TABLE IF NOT EXISTS voyage_manifest_lines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voyage_id INTEGER NOT NULL,
      cargo_type_id INTEGER NOT NULL,
      quantity INTEGER NOT NULL DEFAULT 0,
      buy_price REAL NOT NULL DEFAULT 0,
      line_total REAL NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(voyage_id, cargo_type_id),
      FOREIGN KEY(voyage_id) REFERENCES voyages(id),
      FOREIGN KEY(cargo_type_id) REFERENCES cargo_types(id)
    )`,
    `CREATE TABLE IF NOT EXISTS voyage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voyage_id INTEGER NOT NULL,
      author_employee_id INTEGER NOT NULL,
      message TEXT NOT NULL,
      log_type TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(voyage_id) REFERENCES voyages(id),
      FOREIGN KEY(author_employee_id) REFERENCES employees(id)
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_voyages_active_vessel_callsign
     ON voyages (LOWER(vessel_name), LOWER(vessel_callsign))
     WHERE status = 'ONGOING'`,
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

  const voyageColumns = await env.DB.prepare(`PRAGMA table_info(voyages)`).all();
  const voyageColumnNames = new Set((voyageColumns?.results || []).map((row) => String(row.name || '').toLowerCase()));
  if (!voyageColumnNames.has('ship_status')) {
    await env.DB.prepare(`ALTER TABLE voyages ADD COLUMN ship_status TEXT NOT NULL DEFAULT 'IN_PORT'`).run();
  }
  if (!voyageColumnNames.has('settlement_lines_json')) {
    await env.DB.prepare(`ALTER TABLE voyages ADD COLUMN settlement_lines_json TEXT`).run();
  }
  const voyageLogColumns = await env.DB.prepare(`PRAGMA table_info(voyage_logs)`).all();
  const voyageLogColumnNames = new Set((voyageLogColumns?.results || []).map((row) => String(row.name || '').toLowerCase()));
  if (!voyageLogColumnNames.has('log_type')) {
    await env.DB.prepare(`ALTER TABLE voyage_logs ADD COLUMN log_type TEXT NOT NULL DEFAULT 'manual'`).run();
  }
  const rankColumns = await env.DB.prepare(`PRAGMA table_info(config_ranks)`).all();
  const rankColumnNames = new Set((rankColumns?.results || []).map((row) => String(row.name || '').toLowerCase()));
  if (!rankColumnNames.has('level')) {
    await env.DB.prepare(`ALTER TABLE config_ranks ADD COLUMN level INTEGER NOT NULL DEFAULT 0`).run();
  }
  if (!rankColumnNames.has('description')) {
    await env.DB.prepare(`ALTER TABLE config_ranks ADD COLUMN description TEXT`).run();
  }
  if (!rankColumnNames.has('updated_at')) {
    await env.DB.prepare(`ALTER TABLE config_ranks ADD COLUMN updated_at TEXT DEFAULT CURRENT_TIMESTAMP`).run();
  }

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

export async function getRankLevelByValue(env, rankValue) {
  await ensureCoreSchema(env);
  const rank = String(rankValue || '').trim();
  if (!rank) return 0;
  const row = await env.DB
    .prepare(`SELECT level FROM config_ranks WHERE LOWER(value) = LOWER(?) LIMIT 1`)
    .bind(rank)
    .first();
  const level = Number(row?.level);
  return Number.isFinite(level) ? level : 0;
}

export async function canEditEmployeeByRank(env, actorEmployee, targetEmployee) {
  const actorRankLevel = await getRankLevelByValue(env, actorEmployee?.rank);
  const targetRankLevel = await getRankLevelByValue(env, targetEmployee?.rank);
  return actorRankLevel >= targetRankLevel;
}
