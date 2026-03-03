function parseStartingBalance(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.round(parsed);
}

let schemaBootstrapPromise = null;
let schemaCheckedAtMs = 0;
const SCHEMA_CHECK_TTL_MS = 24 * 60 * 60 * 1000;
const CORE_DATA_SEED_VERSION = '2026-02-28-core-v3';
const SCHEMA_BOOTSTRAP_VERSION = '2026-03-03-schema-v3';

export async function ensureCoreSchema(env) {
  if (!env.DB) throw new Error('D1 binding `DB` is not configured.');
  const now = Date.now();
  if (schemaCheckedAtMs && now - schemaCheckedAtMs < SCHEMA_CHECK_TTL_MS) return;
  if (schemaBootstrapPromise) return schemaBootstrapPromise;

  schemaBootstrapPromise = (async () => {
  // Fast-path for warm schemas on cold isolates: avoid full bootstrap probes.
  try {
    const schemaMarker = await env.DB
      .prepare(`SELECT meta_value FROM app_runtime_meta WHERE meta_key = 'schema_bootstrap_version'`)
      .first();
    if (String(schemaMarker?.meta_value || '') === SCHEMA_BOOTSTRAP_VERSION) {
      const liveNotificationsTable = await env.DB
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'live_notifications'`)
        .first();
      if (String(liveNotificationsTable?.name || '') === 'live_notifications') {
        schemaCheckedAtMs = Date.now();
        return;
      }
    }
  } catch {
    // Table may not exist yet; continue to full bootstrap.
  }

  const permissionSeed = [
    ['super.admin', 'roles', 'Super Admin', 'Global bypass permission.'],
    ['admin.read_only', 'admin', 'Admin Read Only', 'Read-only access across all admin areas.'],
    ['admin.override', 'admin', 'Admin Override', 'Grant all permissions across the application.'],
    ['employees.read', 'employees', 'View Employees', 'View employee lists and employee profiles.'],
    ['employees.create', 'employees', 'Create Employees', 'Create employee records.'],
    ['employees.edit', 'employees', 'Edit Employees', 'Edit employee profile fields.'],
    ['employees.delete', 'employees', 'Delete Employees', 'Delete employee records and related onboarding data.'],
    ['employees.discipline', 'employees', 'Manage Discipline', 'Create and update disciplinary records.'],
    ['employees.notes', 'employees', 'Manage Notes', 'Add employee notes and activity log entries.'],
    ['employees.access_requests.review', 'employees', 'Review Access Requests', 'Approve or deny access requests.'],
    ['config.manage', 'config', 'Manage Config', 'Manage statuses, ranks, grades, and disciplinary types.'],
    ['user_groups.read', 'user_groups', 'View User Groups', 'View user group definitions and permissions.'],
    ['user_groups.manage', 'user_groups', 'Manage User Groups', 'Create, edit, delete, and reorder user groups.'],
    ['user_groups.assign', 'user_groups', 'Assign User Groups', 'Assign and unassign user groups for employees.'],
    ['user_ranks.manage', 'user_ranks', 'Manage User Ranks', 'Create, edit, delete, and reorder user ranks.'],
    ['user_ranks.permissions.manage', 'user_ranks', 'Manage User Rank Permissions', 'Edit permission mappings granted by user ranks.'],
    ['activity_tracker.view', 'activity_tracker', 'View Activity Tracker', 'View employee voyage activity statistics.'],
    ['activity_tracker.manage', 'activity_tracker', 'Manage Activity Tracker', 'Manage advanced activity tracker features.'],
    ['voyages.read', 'voyages', 'View Voyages', 'View voyage tracker.'],
    ['voyages.create', 'voyages', 'Create Voyages', 'Create voyage entries.'],
    ['voyages.edit', 'voyages', 'Edit Voyages', 'Edit voyage entries.'],
    ['voyages.end', 'voyages', 'End Voyages', 'End voyages and finalize voyage accounting.'],
    ['voyages.delete', 'voyages', 'Delete Voyages', 'Delete archived voyages with financial reversal and audit trail.'],
    ['voyages.config.manage', 'voyages', 'Manage Voyage Config', 'Manage voyage config lists for ports and vessels.'],
    ['cargo.manage', 'voyages', 'Manage Cargo', 'Manage cargo type definitions for manifests.'],
    ['finances.view', 'finances', 'View Finances', 'View the finance dashboard and debt summaries.'],
    ['finances.debts.settle', 'finances', 'Settle Finance Debts', 'Settle outstanding company share debts.'],
    ['finances.audit.view', 'finances', 'View Finance Audit', 'View finance settlement audit logs.']
  ];

  const tables = [
    `CREATE TABLE IF NOT EXISTS intranet_allowed_roles (
      role_id TEXT PRIMARY KEY,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS employees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      discord_user_id TEXT NOT NULL UNIQUE,
      discord_display_name TEXT,
      discord_username TEXT,
      discord_avatar_url TEXT,
      roblox_username TEXT,
      roblox_user_id TEXT,
      rank TEXT,
      grade TEXT,
      serial_number TEXT,
      employee_status TEXT,
      user_status TEXT NOT NULL DEFAULT 'ACTIVE_STAFF',
      activation_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (activation_status IN ('PENDING','ACTIVE','REJECTED','DISABLED')),
      activated_at TEXT,
      activated_by_employee_id INTEGER,
      onboarding_submitted_at TEXT,
      onboarding_review_note TEXT,
      hire_date TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(activated_by_employee_id) REFERENCES employees(id)
    )`,
    `CREATE TABLE IF NOT EXISTS disciplinary_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      type_key TEXT,
      status TEXT NOT NULL DEFAULT 'ACTIVE',
      effective_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      ends_at TEXT,
      reason_text TEXT,
      internal_notes TEXT,
      issued_by_employee_id INTEGER,
      issued_by_name TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      closed_at TEXT,
      closed_by_employee_id INTEGER,
      close_note TEXT,
      record_type TEXT,
      record_date TEXT,
      record_status TEXT,
      notes TEXT,
      issued_by TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(employee_id) REFERENCES employees(id),
      FOREIGN KEY(issued_by_employee_id) REFERENCES employees(id),
      FOREIGN KEY(closed_by_employee_id) REFERENCES employees(id)
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
      key TEXT UNIQUE,
      label TEXT,
      value TEXT UNIQUE,
      severity INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      default_status TEXT NOT NULL DEFAULT 'ACTIVE',
      requires_end_date INTEGER NOT NULL DEFAULT 0,
      default_duration_days INTEGER,
      apply_suspension_rank INTEGER NOT NULL DEFAULT 0,
      set_employee_status TEXT,
      restrict_intranet INTEGER NOT NULL DEFAULT 0,
      restrict_voyages INTEGER NOT NULL DEFAULT 0,
      restrict_finance INTEGER NOT NULL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
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
      discord_role_id TEXT,
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
    `CREATE TABLE IF NOT EXISTS rank_discord_role_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rank_id INTEGER NOT NULL,
      discord_role_id TEXT NOT NULL,
      discord_role_name TEXT,
      guild_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(rank_id, discord_role_id),
      FOREIGN KEY(rank_id) REFERENCES config_ranks(id)
    )`,
    `CREATE TABLE IF NOT EXISTS rank_group_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rank_id INTEGER NOT NULL,
      group_key TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(rank_id, group_key),
      FOREIGN KEY(rank_id) REFERENCES config_ranks(id)
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
      company_share_status TEXT NOT NULL DEFAULT 'UNSETTLED',
      company_share_settled_at TEXT,
      company_share_settled_by_employee_id INTEGER,
      company_share_settled_by_discord_id TEXT,
      company_share_amount REAL,
      cargo_lost_json TEXT,
      settlement_lines_json TEXT,
      deleted_at TEXT,
      deleted_by_employee_id INTEGER,
      deleted_reason TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(owner_employee_id) REFERENCES employees(id),
      FOREIGN KEY(officer_of_watch_employee_id) REFERENCES employees(id),
      FOREIGN KEY(deleted_by_employee_id) REFERENCES employees(id)
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
    `CREATE TABLE IF NOT EXISTS finance_settlement_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      voyage_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      amount REAL NOT NULL DEFAULT 0,
      settled_by_employee_id INTEGER,
      settled_by_discord_user_id TEXT,
      oow_employee_id INTEGER,
      details_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(voyage_id) REFERENCES voyages(id),
      FOREIGN KEY(settled_by_employee_id) REFERENCES employees(id),
      FOREIGN KEY(oow_employee_id) REFERENCES employees(id)
    )`,
    `CREATE TABLE IF NOT EXISTS finance_cash_settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      starting_balance INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS finance_cash_ledger_entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      created_by_employee_id INTEGER NOT NULL,
      created_by_name TEXT,
      created_by_discord_user_id TEXT,
      type TEXT NOT NULL CHECK (type IN ('IN', 'OUT')),
      amount INTEGER NOT NULL,
      reason TEXT NOT NULL,
      category TEXT,
      voyage_id INTEGER,
      balance_after INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      deleted_by_employee_id INTEGER,
      deleted_reason TEXT,
      FOREIGN KEY(created_by_employee_id) REFERENCES employees(id),
      FOREIGN KEY(deleted_by_employee_id) REFERENCES employees(id),
      FOREIGN KEY(voyage_id) REFERENCES voyages(id)
    )`,
    `CREATE TABLE IF NOT EXISTS finance_cashflow_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id INTEGER NOT NULL,
      action TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      performed_by_employee_id INTEGER,
      performed_by_discord_user_id TEXT,
      details_json TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(entry_id) REFERENCES finance_cash_ledger_entries(id),
      FOREIGN KEY(performed_by_employee_id) REFERENCES employees(id)
    )`,
    `CREATE TABLE IF NOT EXISTS admin_activity_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      actor_employee_id INTEGER,
      actor_name TEXT,
      actor_discord_user_id TEXT,
      action_type TEXT NOT NULL,
      target_employee_id INTEGER,
      summary TEXT NOT NULL,
      metadata_json TEXT,
      FOREIGN KEY(actor_employee_id) REFERENCES employees(id),
      FOREIGN KEY(target_employee_id) REFERENCES employees(id)
    )`,
    `CREATE TABLE IF NOT EXISTS app_runtime_meta (
      meta_key TEXT PRIMARY KEY,
      meta_value TEXT,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS config_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS live_notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      sender_employee_id INTEGER,
      sender_name TEXT,
      severity TEXT NOT NULL CHECK (severity IN ('STANDARD', 'URGENT')),
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      target_mode TEXT NOT NULL CHECK (target_mode IN ('ALL', 'SPECIFIC')),
      target_json TEXT,
      expires_at TEXT,
      FOREIGN KEY(sender_employee_id) REFERENCES employees(id)
    )`
  ];

  await env.DB.batch(tables.map((sql) => env.DB.prepare(sql)));

  // Ensure core admin permission/role always exist, even on already-seeded databases.
  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description)
       VALUES ('admin.read_only', 'admin', 'Admin Read Only', 'Read-only access across all admin areas.')`
    )
    .run();

  await env.DB
    .prepare(
      `INSERT OR IGNORE INTO app_roles (role_key, name, description, sort_order, is_system, updated_at)
       VALUES ('admin_read_only', 'Admin Read Only', 'Read-only visibility across admin pages without write actions.', 10, 0, CURRENT_TIMESTAMP)`
    )
    .run();

  const adminReadOnlyRole = await env.DB.prepare(`SELECT id FROM app_roles WHERE role_key = 'admin_read_only'`).first();
  if (adminReadOnlyRole?.id) {
    await env.DB
      .prepare(`INSERT OR IGNORE INTO app_role_permissions (role_id, permission_key) VALUES (?, 'admin.read_only')`)
      .bind(adminReadOnlyRole.id)
      .run();
  }

  // Backfill critical columns for legacy table variants so auth can always bootstrap.
  const employeeColumns = await env.DB.prepare(`PRAGMA table_info(employees)`).all();
  const employeeColumnNames = new Set((employeeColumns?.results || []).map((row) => String(row.name || '').toLowerCase()));
  if (!employeeColumnNames.has('user_status')) {
    await env.DB.prepare(`ALTER TABLE employees ADD COLUMN user_status TEXT NOT NULL DEFAULT 'ACTIVE_STAFF'`).run();
  }
  if (!employeeColumnNames.has('discord_display_name')) {
    await env.DB.prepare(`ALTER TABLE employees ADD COLUMN discord_display_name TEXT`).run();
  }
  if (!employeeColumnNames.has('discord_username')) {
    await env.DB.prepare(`ALTER TABLE employees ADD COLUMN discord_username TEXT`).run();
  }
  if (!employeeColumnNames.has('discord_avatar_url')) {
    await env.DB.prepare(`ALTER TABLE employees ADD COLUMN discord_avatar_url TEXT`).run();
  }
  if (!employeeColumnNames.has('activation_status')) {
    await env.DB.prepare(`ALTER TABLE employees ADD COLUMN activation_status TEXT NOT NULL DEFAULT 'PENDING'`).run();
  }
  if (!employeeColumnNames.has('activated_at')) {
    await env.DB.prepare(`ALTER TABLE employees ADD COLUMN activated_at TEXT`).run();
  }
  if (!employeeColumnNames.has('activated_by_employee_id')) {
    await env.DB.prepare(`ALTER TABLE employees ADD COLUMN activated_by_employee_id INTEGER`).run();
  }
  if (!employeeColumnNames.has('onboarding_submitted_at')) {
    await env.DB.prepare(`ALTER TABLE employees ADD COLUMN onboarding_submitted_at TEXT`).run();
  }
  if (!employeeColumnNames.has('onboarding_review_note')) {
    await env.DB.prepare(`ALTER TABLE employees ADD COLUMN onboarding_review_note TEXT`).run();
  }
  if (!employeeColumnNames.has('suspension_rank_before')) {
    await env.DB.prepare(`ALTER TABLE employees ADD COLUMN suspension_rank_before TEXT`).run();
  }
  if (!employeeColumnNames.has('suspension_active_record_id')) {
    await env.DB.prepare(`ALTER TABLE employees ADD COLUMN suspension_active_record_id INTEGER`).run();
  }
  if (!employeeColumnNames.has('suspension_started_at')) {
    await env.DB.prepare(`ALTER TABLE employees ADD COLUMN suspension_started_at TEXT`).run();
  }
  if (!employeeColumnNames.has('suspension_ends_at')) {
    await env.DB.prepare(`ALTER TABLE employees ADD COLUMN suspension_ends_at TEXT`).run();
  }

  const disciplinaryTypeColumns = await env.DB.prepare(`PRAGMA table_info(config_disciplinary_types)`).all();
  const disciplinaryTypeColumnNames = new Set((disciplinaryTypeColumns?.results || []).map((row) => String(row.name || '').toLowerCase()));
  if (!disciplinaryTypeColumnNames.has('key')) {
    await env.DB.prepare(`ALTER TABLE config_disciplinary_types ADD COLUMN key TEXT`).run();
  }
  if (!disciplinaryTypeColumnNames.has('label')) {
    await env.DB.prepare(`ALTER TABLE config_disciplinary_types ADD COLUMN label TEXT`).run();
  }
  if (!disciplinaryTypeColumnNames.has('severity')) {
    await env.DB.prepare(`ALTER TABLE config_disciplinary_types ADD COLUMN severity INTEGER NOT NULL DEFAULT 1`).run();
  }
  if (!disciplinaryTypeColumnNames.has('is_active')) {
    await env.DB.prepare(`ALTER TABLE config_disciplinary_types ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1`).run();
  }
  if (!disciplinaryTypeColumnNames.has('default_status')) {
    await env.DB.prepare(`ALTER TABLE config_disciplinary_types ADD COLUMN default_status TEXT NOT NULL DEFAULT 'ACTIVE'`).run();
  }
  if (!disciplinaryTypeColumnNames.has('requires_end_date')) {
    await env.DB.prepare(`ALTER TABLE config_disciplinary_types ADD COLUMN requires_end_date INTEGER NOT NULL DEFAULT 0`).run();
  }
  if (!disciplinaryTypeColumnNames.has('default_duration_days')) {
    await env.DB.prepare(`ALTER TABLE config_disciplinary_types ADD COLUMN default_duration_days INTEGER`).run();
  }
  if (!disciplinaryTypeColumnNames.has('apply_suspension_rank')) {
    await env.DB.prepare(`ALTER TABLE config_disciplinary_types ADD COLUMN apply_suspension_rank INTEGER NOT NULL DEFAULT 0`).run();
  }
  if (!disciplinaryTypeColumnNames.has('set_employee_status')) {
    await env.DB.prepare(`ALTER TABLE config_disciplinary_types ADD COLUMN set_employee_status TEXT`).run();
  }
  if (!disciplinaryTypeColumnNames.has('restrict_intranet')) {
    await env.DB.prepare(`ALTER TABLE config_disciplinary_types ADD COLUMN restrict_intranet INTEGER NOT NULL DEFAULT 0`).run();
  }
  if (!disciplinaryTypeColumnNames.has('restrict_voyages')) {
    await env.DB.prepare(`ALTER TABLE config_disciplinary_types ADD COLUMN restrict_voyages INTEGER NOT NULL DEFAULT 0`).run();
  }
  if (!disciplinaryTypeColumnNames.has('restrict_finance')) {
    await env.DB.prepare(`ALTER TABLE config_disciplinary_types ADD COLUMN restrict_finance INTEGER NOT NULL DEFAULT 0`).run();
  }
  if (!disciplinaryTypeColumnNames.has('updated_at')) {
    await env.DB.prepare(`ALTER TABLE config_disciplinary_types ADD COLUMN updated_at TEXT`).run();
  }

  const disciplinaryColumns = await env.DB.prepare(`PRAGMA table_info(disciplinary_records)`).all();
  const disciplinaryColumnNames = new Set((disciplinaryColumns?.results || []).map((row) => String(row.name || '').toLowerCase()));
  if (!disciplinaryColumnNames.has('type_key')) {
    await env.DB.prepare(`ALTER TABLE disciplinary_records ADD COLUMN type_key TEXT`).run();
  }
  if (!disciplinaryColumnNames.has('status')) {
    await env.DB.prepare(`ALTER TABLE disciplinary_records ADD COLUMN status TEXT NOT NULL DEFAULT 'ACTIVE'`).run();
  }
  if (!disciplinaryColumnNames.has('effective_at')) {
    await env.DB.prepare(`ALTER TABLE disciplinary_records ADD COLUMN effective_at TEXT`).run();
  }
  if (!disciplinaryColumnNames.has('ends_at')) {
    await env.DB.prepare(`ALTER TABLE disciplinary_records ADD COLUMN ends_at TEXT`).run();
  }
  if (!disciplinaryColumnNames.has('reason_text')) {
    await env.DB.prepare(`ALTER TABLE disciplinary_records ADD COLUMN reason_text TEXT`).run();
  }
  if (!disciplinaryColumnNames.has('internal_notes')) {
    await env.DB.prepare(`ALTER TABLE disciplinary_records ADD COLUMN internal_notes TEXT`).run();
  }
  if (!disciplinaryColumnNames.has('issued_by_employee_id')) {
    await env.DB.prepare(`ALTER TABLE disciplinary_records ADD COLUMN issued_by_employee_id INTEGER`).run();
  }
  if (!disciplinaryColumnNames.has('issued_by_name')) {
    await env.DB.prepare(`ALTER TABLE disciplinary_records ADD COLUMN issued_by_name TEXT`).run();
  }
  if (!disciplinaryColumnNames.has('updated_at')) {
    await env.DB.prepare(`ALTER TABLE disciplinary_records ADD COLUMN updated_at TEXT`).run();
  }
  if (!disciplinaryColumnNames.has('closed_at')) {
    await env.DB.prepare(`ALTER TABLE disciplinary_records ADD COLUMN closed_at TEXT`).run();
  }
  if (!disciplinaryColumnNames.has('closed_by_employee_id')) {
    await env.DB.prepare(`ALTER TABLE disciplinary_records ADD COLUMN closed_by_employee_id INTEGER`).run();
  }
  if (!disciplinaryColumnNames.has('close_note')) {
    await env.DB.prepare(`ALTER TABLE disciplinary_records ADD COLUMN close_note TEXT`).run();
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
    await env.DB.prepare(`ALTER TABLE config_ranks ADD COLUMN updated_at TEXT`).run();
  }

  const permissionColumns = await env.DB.prepare(`PRAGMA table_info(app_permissions)`).all();
  const permissionColumnNames = new Set((permissionColumns?.results || []).map((row) => String(row.name || '').toLowerCase()));
  if (!permissionColumnNames.has('permission_group')) {
    await env.DB.prepare(`ALTER TABLE app_permissions ADD COLUMN permission_group TEXT`).run();
  }
  if (!permissionColumnNames.has('label')) {
    await env.DB.prepare(`ALTER TABLE app_permissions ADD COLUMN label TEXT`).run();
  }
  if (!permissionColumnNames.has('description')) {
    await env.DB.prepare(`ALTER TABLE app_permissions ADD COLUMN description TEXT`).run();
  }

  const roleColumns = await env.DB.prepare(`PRAGMA table_info(app_roles)`).all();
  const roleColumnNames = new Set((roleColumns?.results || []).map((row) => String(row.name || '').toLowerCase()));
  if (!roleColumnNames.has('role_key')) {
    await env.DB.prepare(`ALTER TABLE app_roles ADD COLUMN role_key TEXT`).run();
  }
  if (!roleColumnNames.has('discord_role_id')) {
    await env.DB.prepare(`ALTER TABLE app_roles ADD COLUMN discord_role_id TEXT`).run();
  }
  if (!roleColumnNames.has('sort_order')) {
    await env.DB.prepare(`ALTER TABLE app_roles ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`).run();
  }
  if (!roleColumnNames.has('is_system')) {
    await env.DB.prepare(`ALTER TABLE app_roles ADD COLUMN is_system INTEGER NOT NULL DEFAULT 0`).run();
  }
  if (!roleColumnNames.has('updated_at')) {
    await env.DB.prepare(`ALTER TABLE app_roles ADD COLUMN updated_at TEXT`).run();
  }

  const voyageColumns = await env.DB.prepare(`PRAGMA table_info(voyages)`).all();
  const voyageColumnNames = new Set((voyageColumns?.results || []).map((row) => String(row.name || '').toLowerCase()));
  if (!voyageColumnNames.has('ship_status')) {
    await env.DB.prepare(`ALTER TABLE voyages ADD COLUMN ship_status TEXT NOT NULL DEFAULT 'IN_PORT'`).run();
  }
  if (!voyageColumnNames.has('settlement_lines_json')) {
    await env.DB.prepare(`ALTER TABLE voyages ADD COLUMN settlement_lines_json TEXT`).run();
  }
  if (!voyageColumnNames.has('company_share_status')) {
    await env.DB.prepare(`ALTER TABLE voyages ADD COLUMN company_share_status TEXT NOT NULL DEFAULT 'UNSETTLED'`).run();
  }
  if (!voyageColumnNames.has('company_share_settled_at')) {
    await env.DB.prepare(`ALTER TABLE voyages ADD COLUMN company_share_settled_at TEXT`).run();
  }
  if (!voyageColumnNames.has('company_share_settled_by_employee_id')) {
    await env.DB.prepare(`ALTER TABLE voyages ADD COLUMN company_share_settled_by_employee_id INTEGER`).run();
  }
  if (!voyageColumnNames.has('company_share_settled_by_discord_id')) {
    await env.DB.prepare(`ALTER TABLE voyages ADD COLUMN company_share_settled_by_discord_id TEXT`).run();
  }
  if (!voyageColumnNames.has('company_share_amount')) {
    await env.DB.prepare(`ALTER TABLE voyages ADD COLUMN company_share_amount REAL`).run();
  }
  if (!voyageColumnNames.has('deleted_at')) {
    await env.DB.prepare(`ALTER TABLE voyages ADD COLUMN deleted_at TEXT`).run();
  }
  if (!voyageColumnNames.has('deleted_by_employee_id')) {
    await env.DB.prepare(`ALTER TABLE voyages ADD COLUMN deleted_by_employee_id INTEGER`).run();
  }
  if (!voyageColumnNames.has('deleted_reason')) {
    await env.DB.prepare(`ALTER TABLE voyages ADD COLUMN deleted_reason TEXT`).run();
  }

  const voyageLogColumns = await env.DB.prepare(`PRAGMA table_info(voyage_logs)`).all();
  const voyageLogColumnNames = new Set((voyageLogColumns?.results || []).map((row) => String(row.name || '').toLowerCase()));
  if (!voyageLogColumnNames.has('log_type')) {
    await env.DB.prepare(`ALTER TABLE voyage_logs ADD COLUMN log_type TEXT NOT NULL DEFAULT 'manual'`).run();
  }

  const optionalIndexes = [
    `CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(employee_status)`,
    `CREATE INDEX IF NOT EXISTS idx_employees_activation_status ON employees(activation_status)`,
    `CREATE INDEX IF NOT EXISTS idx_employees_user_status ON employees(user_status)`,
    `CREATE INDEX IF NOT EXISTS idx_employees_rank ON employees(rank)`,
    `CREATE INDEX IF NOT EXISTS idx_employees_grade ON employees(grade)`,
    `CREATE INDEX IF NOT EXISTS idx_employees_serial ON employees(serial_number)`,
    `CREATE INDEX IF NOT EXISTS idx_employees_roblox_user_id ON employees(roblox_user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_employees_hire_date ON employees(hire_date)`,
    `CREATE INDEX IF NOT EXISTS idx_rank_discord_links_rank_id ON rank_discord_role_links(rank_id)`,
    `CREATE INDEX IF NOT EXISTS idx_rank_discord_links_role_id ON rank_discord_role_links(discord_role_id)`,
    `CREATE INDEX IF NOT EXISTS idx_rank_group_links_rank_id ON rank_group_links(rank_id)`,
    `CREATE INDEX IF NOT EXISTS idx_rank_group_links_group_key ON rank_group_links(group_key)`,
    `CREATE INDEX IF NOT EXISTS idx_voyages_status ON voyages(status)`,
    `CREATE INDEX IF NOT EXISTS idx_voyages_deleted_at ON voyages(deleted_at)`,
    `CREATE INDEX IF NOT EXISTS idx_voyages_ended_at ON voyages(ended_at)`,
    `CREATE INDEX IF NOT EXISTS idx_finance_settlement_audit_voyage ON finance_settlement_audit(voyage_id)`,
    `CREATE INDEX IF NOT EXISTS idx_finance_cash_ledger_voyage ON finance_cash_ledger_entries(voyage_id)`,
    `CREATE INDEX IF NOT EXISTS idx_voyages_company_share_status ON voyages(company_share_status)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS ux_voyages_active_vessel_callsign
      ON voyages (LOWER(vessel_name), LOWER(vessel_callsign))
      WHERE status = 'ONGOING'`,
    `CREATE INDEX IF NOT EXISTS idx_voyage_participants_employee ON voyage_participants(employee_id)`,
    `CREATE INDEX IF NOT EXISTS idx_voyage_crew_members_employee ON voyage_crew_members(employee_id)`,
    `CREATE INDEX IF NOT EXISTS idx_voyage_manifest_voyage ON voyage_manifest_lines(voyage_id)`,
    `CREATE INDEX IF NOT EXISTS idx_voyage_logs_voyage ON voyage_logs(voyage_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_finance_settlement_audit_created_at ON finance_settlement_audit(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_finance_cash_ledger_created_at ON finance_cash_ledger_entries(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_finance_cash_ledger_type ON finance_cash_ledger_entries(type)`,
    `CREATE INDEX IF NOT EXISTS idx_finance_cash_ledger_deleted_at ON finance_cash_ledger_entries(deleted_at)`,
    `CREATE INDEX IF NOT EXISTS idx_finance_cashflow_audit_created_at ON finance_cashflow_audit(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_admin_activity_created_at ON admin_activity_events(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_admin_activity_action_type ON admin_activity_events(action_type)`,
    `CREATE INDEX IF NOT EXISTS idx_admin_activity_target_employee ON admin_activity_events(target_employee_id)`,
    `CREATE INDEX IF NOT EXISTS idx_admin_activity_actor_employee ON admin_activity_events(actor_employee_id)`,
    `CREATE INDEX IF NOT EXISTS idx_disciplinary_employee_status ON disciplinary_records(employee_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_disciplinary_ends_at ON disciplinary_records(ends_at)`,
    `CREATE INDEX IF NOT EXISTS idx_live_notifications_created ON live_notifications(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_live_notifications_expires ON live_notifications(expires_at)`
  ];

  for (const sql of optionalIndexes) {
    try {
      await env.DB.prepare(sql).run();
    } catch {
      // Keep schema bootstrap non-fatal if index creation fails on odd legacy states.
    }
  }

  const markerRow = await env.DB
    .prepare(`SELECT meta_value FROM app_runtime_meta WHERE meta_key = 'core_data_seed_version'`)
    .first();
  const dataBootstrapRequired = String(markerRow?.meta_value || '') !== CORE_DATA_SEED_VERSION;

  if (dataBootstrapRequired) {
    const startingBalanceSeed = parseStartingBalance(env.FINANCE_STARTING_BALANCE);
    await env.DB
      .prepare(
        `INSERT OR IGNORE INTO finance_cash_settings (id, starting_balance, updated_at)
         VALUES (1, ?, CURRENT_TIMESTAMP)`
      )
      .bind(startingBalanceSeed)
      .run();

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
      await env.DB
        .prepare(`INSERT OR IGNORE INTO app_role_permissions (role_id, permission_key) VALUES (?, 'super.admin')`)
        .bind(ownerRole.id)
        .run();
    }

    if (employeeRole?.id) {
      await env.DB.batch([
        env.DB
          .prepare(`INSERT OR IGNORE INTO app_role_permissions (role_id, permission_key) VALUES (?, 'voyages.read')`)
          .bind(employeeRole.id),
        env.DB
          .prepare(`INSERT OR IGNORE INTO app_role_permissions (role_id, permission_key) VALUES (?, 'finances.view')`)
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

    await env.DB.batch([
      env.DB
        .prepare(
          `DELETE FROM app_role_permissions
           WHERE permission_key IN ('admin.access', 'dashboard.view', 'my_details.view', 'roles.read', 'roles.manage', 'roles.assign')`
        ),
      env.DB
        .prepare(
          `DELETE FROM rank_permission_mappings
           WHERE permission_key IN ('admin.access', 'dashboard.view', 'my_details.view', 'roles.read', 'roles.manage', 'roles.assign')`
        ),
      env.DB
        .prepare(
          `DELETE FROM app_permissions
           WHERE permission_key IN ('admin.access', 'dashboard.view', 'my_details.view', 'roles.read', 'roles.manage', 'roles.assign')`
        )
    ]);

    await env.DB.prepare(`UPDATE config_ranks SET updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)`).run();
    await env.DB.prepare(`UPDATE employees SET user_status = COALESCE(NULLIF(user_status, ''), 'ACTIVE_STAFF')`).run();
    await env.DB
      .prepare(
        `UPDATE employees
         SET activation_status = CASE
           WHEN UPPER(COALESCE(activation_status, '')) IN ('ACTIVE','PENDING','REJECTED','DISABLED') THEN UPPER(activation_status)
           ELSE CASE WHEN id > 0 THEN 'ACTIVE' ELSE 'PENDING' END
         END`
      )
      .run();
    await env.DB.prepare(`UPDATE voyages SET company_share_amount = COALESCE(company_share_amount, ROUND(COALESCE(company_share, 0)))`).run();
    await env.DB
      .prepare(
        `UPDATE voyages
         SET company_share_status = COALESCE(NULLIF(company_share_status, ''), 'UNSETTLED')`
      )
      .run();

    try {
      await env.DB
        .prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS ux_app_roles_discord_role_id
           ON app_roles(discord_role_id)
           WHERE discord_role_id IS NOT NULL AND TRIM(discord_role_id) != ''`
        )
        .run();
    } catch {
      // Keep bootstrap non-fatal.
    }

    try {
      await env.DB
        .prepare(
          `CREATE UNIQUE INDEX IF NOT EXISTS ux_config_disciplinary_types_key
           ON config_disciplinary_types(key)
           WHERE key IS NOT NULL AND TRIM(key) != ''`
        )
        .run();
    } catch {
      // Keep bootstrap non-fatal.
    }

    await env.DB
      .prepare(
        `INSERT INTO config_settings (key, value, updated_at)
         VALUES ('SUSPENDED_RANK_VALUE', 'Suspended', CURRENT_TIMESTAMP)
         ON CONFLICT(key) DO NOTHING`
      )
      .run();

    await env.DB.prepare(`UPDATE config_disciplinary_types SET label = COALESCE(NULLIF(TRIM(label), ''), value)`).run();
    await env.DB
      .prepare(
        `UPDATE config_disciplinary_types
         SET key = COALESCE(
           NULLIF(TRIM(key), ''),
           UPPER(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(label, value, '')), ' ', '_'), '-', '_'), '__', '_'))
         )`
      )
      .run();
    await env.DB.prepare(`UPDATE config_disciplinary_types SET updated_at = COALESCE(updated_at, CURRENT_TIMESTAMP)`).run();
    await env.DB
      .prepare(
        `UPDATE config_disciplinary_types
         SET
           apply_suspension_rank = CASE WHEN UPPER(COALESCE(key, '')) = 'SUSPENSION' THEN 1 ELSE COALESCE(apply_suspension_rank, 0) END,
           requires_end_date = CASE WHEN UPPER(COALESCE(key, '')) = 'SUSPENSION' THEN 1 ELSE COALESCE(requires_end_date, 0) END,
           set_employee_status = CASE
             WHEN UPPER(COALESCE(key, '')) = 'SUSPENSION' AND COALESCE(NULLIF(TRIM(set_employee_status), ''), '') = '' THEN 'Suspended'
             ELSE set_employee_status
           END
         WHERE key IS NOT NULL`
      )
      .run();

    await env.DB
      .prepare(
        `UPDATE disciplinary_records
         SET
           type_key = COALESCE(NULLIF(TRIM(type_key), ''), UPPER(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(record_type, 'WARNING')), ' ', '_'), '-', '_'), '__', '_'))),
           status = CASE
             WHEN UPPER(COALESCE(status, '')) IN ('ACTIVE','OPEN','CLOSED','REVOKED','EXPIRED') THEN UPPER(status)
             WHEN UPPER(COALESCE(record_status, '')) IN ('OPEN','ACTIVE') THEN 'ACTIVE'
             WHEN UPPER(COALESCE(record_status, '')) IN ('RESOLVED','CLOSED') THEN 'CLOSED'
             WHEN UPPER(COALESCE(record_status, '')) = 'REVOKED' THEN 'REVOKED'
             WHEN UPPER(COALESCE(record_status, '')) = 'EXPIRED' THEN 'EXPIRED'
             ELSE 'ACTIVE'
           END,
           effective_at = COALESCE(NULLIF(TRIM(effective_at), ''), NULLIF(TRIM(record_date), ''), created_at, CURRENT_TIMESTAMP),
           reason_text = COALESCE(NULLIF(TRIM(reason_text), ''), NULLIF(TRIM(notes), ''), 'No reason provided.'),
           issued_by_name = COALESCE(NULLIF(TRIM(issued_by_name), ''), NULLIF(TRIM(issued_by), ''), 'System'),
           updated_at = CURRENT_TIMESTAMP`
      )
      .run();

    await env.DB
      .prepare(
        `INSERT INTO app_runtime_meta (meta_key, meta_value, updated_at)
         VALUES ('core_data_seed_version', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(meta_key) DO UPDATE SET
           meta_value = excluded.meta_value,
           updated_at = excluded.updated_at`
      )
      .bind(CORE_DATA_SEED_VERSION)
      .run();
  }
  await env.DB
    .prepare(
      `INSERT INTO app_runtime_meta (meta_key, meta_value, updated_at)
       VALUES ('schema_bootstrap_version', ?, CURRENT_TIMESTAMP)
       ON CONFLICT(meta_key) DO UPDATE SET
         meta_value = excluded.meta_value,
         updated_at = excluded.updated_at`
    )
    .bind(SCHEMA_BOOTSTRAP_VERSION)
    .run();
  schemaCheckedAtMs = Date.now();
  })();

  try {
    await schemaBootstrapPromise;
  } finally {
    schemaBootstrapPromise = null;
  }
}

export async function ensureLiveNotificationsSchema(env) {
  if (!env?.DB) throw new Error('D1 binding `DB` is not configured.');
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS live_notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        sender_employee_id INTEGER,
        sender_name TEXT,
        severity TEXT NOT NULL CHECK (severity IN ('STANDARD', 'URGENT')),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        target_mode TEXT NOT NULL CHECK (target_mode IN ('ALL', 'SPECIFIC')),
        target_json TEXT,
        expires_at TEXT,
        FOREIGN KEY(sender_employee_id) REFERENCES employees(id)
      )`
    ),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_live_notifications_created ON live_notifications(created_at DESC)`),
    env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_live_notifications_expires ON live_notifications(expires_at)`)
  ]);
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

export async function upsertPendingEmployeeFromDiscordRoles(
  env,
  { discordUserId, discordDisplayName, discordUsername, discordAvatarUrl, mappedRoleIds = [], rankValue = '' }
) {
  await ensureCoreSchema(env);
  const normalized = normalizeDiscordUserId(discordUserId);
  if (!/^\d{6,30}$/.test(normalized)) return null;

  const existing = await env.DB.prepare('SELECT * FROM employees WHERE discord_user_id = ?').bind(normalized).first();
  let wasCreated = false;
  const normalizedRankValue = String(rankValue || '').trim();
  if (!existing) {
    wasCreated = true;
    await env.DB
      .prepare(
        `INSERT INTO employees
         (discord_user_id, discord_display_name, discord_username, discord_avatar_url, rank, activation_status, user_status, updated_at)
         VALUES (?, ?, ?, ?, ?, 'PENDING', 'APPLICANT_ACCEPTED', CURRENT_TIMESTAMP)`
      )
      .bind(
        normalized,
        String(discordDisplayName || '').trim() || null,
        String(discordUsername || '').trim() || null,
        String(discordAvatarUrl || '').trim() || null,
        normalizedRankValue || null
      )
      .run();
  } else {
    await env.DB
      .prepare(
        `UPDATE employees
         SET discord_display_name = COALESCE(?, discord_display_name),
             discord_username = COALESCE(?, discord_username),
             discord_avatar_url = COALESCE(?, discord_avatar_url),
             rank = CASE
               WHEN COALESCE(NULLIF(TRIM(rank), ''), '') = '' AND TRIM(COALESCE(?, '')) != '' THEN ?
               ELSE rank
             END,
             updated_at = CURRENT_TIMESTAMP
         WHERE discord_user_id = ?`
      )
      .bind(
        String(discordDisplayName || '').trim() || null,
        String(discordUsername || '').trim() || null,
        String(discordAvatarUrl || '').trim() || null,
        normalizedRankValue || null,
        normalizedRankValue || null,
        normalized
      )
      .run();
  }

  const employee = await env.DB.prepare('SELECT * FROM employees WHERE discord_user_id = ?').bind(normalized).first();
  const employeeId = Number(employee?.id || 0);
  if (employeeId > 0 && Array.isArray(mappedRoleIds) && mappedRoleIds.length) {
    await env.DB.batch(
      [...new Set(mappedRoleIds.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))].map((roleId) =>
        env.DB.prepare('INSERT OR IGNORE INTO employee_role_assignments (employee_id, role_id) VALUES (?, ?)').bind(employeeId, roleId)
      )
    );
  }

  if (wasCreated && employeeId > 0) {
    await env.DB
      .prepare(`INSERT INTO employee_notes (employee_id, note, authored_by) VALUES (?, ?, ?)`)
      .bind(employeeId, '[System] AUTO_EMPLOYEE_CREATED_FROM_DISCORD_ROLE: Account created and pending activation.', 'System')
      .run();
    await writeAdminActivityEvent(env, {
      actorEmployeeId: null,
      actorName: 'System',
      actorDiscordUserId: '',
      actionType: 'AUTO_EMPLOYEE_CREATED_FROM_DISCORD_ROLE',
      targetEmployeeId: employeeId,
      summary: 'Employee account auto-created from Discord role mapping.',
      metadata: {
        mappedRoleIds
      }
    });
  }

  return employee || null;
}

export function normalizeDiscordUserId(value) {
  const raw = String(value ?? '').trim();
  if (/^\d{6,30}$/.test(raw)) return raw;

  const digits = raw.replace(/\D/g, '');
  if (/^\d{6,30}$/.test(digits)) return digits;

  return raw;
}

export async function getLinkedRanksForDiscordRoles(env, discordRoleIds = []) {
  await ensureCoreSchema(env);
  const normalizedRoleIds = [...new Set((discordRoleIds || []).map((value) => String(value || '').trim()).filter(Boolean))];
  if (!normalizedRoleIds.length) return [];

  const placeholders = normalizedRoleIds.map(() => '?').join(', ');
  const query = `
    SELECT r.id, r.value, r.level, r.description, l.discord_role_id
    FROM rank_discord_role_links l
    JOIN config_ranks r ON r.id = l.rank_id
    WHERE l.discord_role_id IN (${placeholders})
    ORDER BY r.level DESC, r.value ASC, r.id ASC
  `;
  const rows = await env.DB.prepare(query).bind(...normalizedRoleIds).all();
  return rows?.results || [];
}

export async function getMappedRoleIdsForRankIds(env, rankIds = []) {
  await ensureCoreSchema(env);
  const normalizedRankIds = [...new Set((rankIds || []).map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0))];
  if (!normalizedRankIds.length) return [];
  const placeholders = normalizedRankIds.map(() => '?').join(', ');
  const query = `
    SELECT DISTINCT ar.id AS role_id
    FROM rank_group_links rgl
    JOIN app_roles ar
      ON LOWER(ar.role_key) = LOWER(rgl.group_key)
      OR LOWER(ar.name) = LOWER(rgl.group_key)
    WHERE rgl.rank_id IN (${placeholders})
  `;
  const rows = await env.DB.prepare(query).bind(...normalizedRankIds).all();
  return (rows?.results || []).map((row) => Number(row.role_id)).filter((value) => Number.isInteger(value) && value > 0);
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

export async function canEditEmployeeByRank(env, actorEmployee, targetEmployee, options = {}) {
  const allowEqual = Boolean(options?.allowEqual);
  const allowSelf = options?.allowSelf !== false;
  const actorId = Number(actorEmployee?.id || 0);
  const targetId = Number(targetEmployee?.id || 0);
  if (allowSelf && actorId > 0 && targetId > 0 && actorId === targetId) return true;

  const actorRankLevel = await getRankLevelByValue(env, actorEmployee?.rank);
  const targetRankLevel = await getRankLevelByValue(env, targetEmployee?.rank);
  return allowEqual ? actorRankLevel >= targetRankLevel : actorRankLevel > targetRankLevel;
}

export async function writeAdminActivityEvent(env, event) {
  await ensureCoreSchema(env);
  const actionType = String(event?.actionType || '').trim();
  const summary = String(event?.summary || '').trim();
  if (!actionType || !summary) return null;
  const actorEmployeeId = Number(event?.actorEmployeeId);
  const targetEmployeeId = Number(event?.targetEmployeeId);
  const metadataJson = event?.metadata ? JSON.stringify(event.metadata) : null;
  const result = await env.DB
    .prepare(
      `INSERT INTO admin_activity_events
       (actor_employee_id, actor_name, actor_discord_user_id, action_type, target_employee_id, summary, metadata_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    )
    .bind(
      Number.isInteger(actorEmployeeId) && actorEmployeeId > 0 ? actorEmployeeId : null,
      String(event?.actorName || '').trim() || null,
      normalizeDiscordUserId(event?.actorDiscordUserId || ''),
      actionType,
      Number.isInteger(targetEmployeeId) && targetEmployeeId > 0 ? targetEmployeeId : null,
      summary,
      metadataJson
    )
    .run();
  return Number(result?.meta?.last_row_id || 0);
}
