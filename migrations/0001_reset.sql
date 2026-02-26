PRAGMA foreign_keys=OFF;

-- Drop non-core and legacy tables first
DROP TABLE IF EXISTS college_audit_events;
DROP TABLE IF EXISTS college_exam_attempts;
DROP TABLE IF EXISTS college_exam_questions;
DROP TABLE IF EXISTS college_exams;
DROP TABLE IF EXISTS college_profiles;
DROP TABLE IF EXISTS college_role_assignments;
DROP TABLE IF EXISTS college_library_doc_links;
DROP TABLE IF EXISTS college_library_documents;
DROP TABLE IF EXISTS college_module_progress;
DROP TABLE IF EXISTS college_enrollments;
DROP TABLE IF EXISTS college_course_modules;
DROP TABLE IF EXISTS college_courses;
DROP TABLE IF EXISTS form_response_answers;
DROP TABLE IF EXISTS form_responses;
DROP TABLE IF EXISTS form_access_roles;
DROP TABLE IF EXISTS form_access_employees;
DROP TABLE IF EXISTS form_questions;
DROP TABLE IF EXISTS forms;
DROP TABLE IF EXISTS form_categories;

-- Drop core tables
DROP TABLE IF EXISTS finance_cashflow_audit;
DROP TABLE IF EXISTS finance_cash_ledger_entries;
DROP TABLE IF EXISTS finance_cash_settings;
DROP TABLE IF EXISTS finance_settlement_audit;
DROP TABLE IF EXISTS voyage_logs;
DROP TABLE IF EXISTS voyage_manifest_lines;
DROP TABLE IF EXISTS voyage_participants;
DROP TABLE IF EXISTS voyage_crew_members;
DROP TABLE IF EXISTS voyages;
DROP TABLE IF EXISTS config_vessel_callsigns;
DROP TABLE IF EXISTS config_vessel_classes;
DROP TABLE IF EXISTS config_vessel_names;
DROP TABLE IF EXISTS config_voyage_ports;
DROP TABLE IF EXISTS cargo_types;
DROP TABLE IF EXISTS rank_permission_mappings;
DROP TABLE IF EXISTS rank_group_links;
DROP TABLE IF EXISTS rank_discord_role_links;
DROP TABLE IF EXISTS auth_role_mappings;
DROP TABLE IF EXISTS employee_role_assignments;
DROP TABLE IF EXISTS app_role_permissions;
DROP TABLE IF EXISTS app_roles;
DROP TABLE IF EXISTS app_permissions;
DROP TABLE IF EXISTS config_grades;
DROP TABLE IF EXISTS config_ranks;
DROP TABLE IF EXISTS config_disciplinary_types;
DROP TABLE IF EXISTS config_employee_statuses;
DROP TABLE IF EXISTS access_requests;
DROP TABLE IF EXISTS admin_activity_events;
DROP TABLE IF EXISTS employee_notes;
DROP TABLE IF EXISTS disciplinary_records;
DROP TABLE IF EXISTS employees;
DROP TABLE IF EXISTS intranet_allowed_roles;

PRAGMA foreign_keys=ON;

CREATE TABLE intranet_allowed_roles (
  role_id TEXT PRIMARY KEY,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE employees (
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
  hire_date TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(activated_by_employee_id) REFERENCES employees(id)
);

CREATE TABLE disciplinary_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  record_type TEXT,
  record_date TEXT,
  record_status TEXT,
  notes TEXT,
  issued_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(employee_id) REFERENCES employees(id)
);

CREATE TABLE employee_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employee_id INTEGER NOT NULL,
  note TEXT NOT NULL,
  authored_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(employee_id) REFERENCES employees(id)
);

CREATE TABLE access_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_user_id TEXT NOT NULL UNIQUE,
  discord_display_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  requested_at TEXT DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TEXT,
  reviewed_by TEXT,
  review_note TEXT
);

CREATE TABLE config_employee_statuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE config_disciplinary_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE config_ranks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE,
  level INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE config_grades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE app_permissions (
  permission_key TEXT PRIMARY KEY,
  permission_group TEXT NOT NULL,
  label TEXT NOT NULL,
  description TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE app_roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_key TEXT UNIQUE,
  name TEXT NOT NULL UNIQUE,
  discord_role_id TEXT,
  description TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_system INTEGER NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE app_role_permissions (
  role_id INTEGER NOT NULL,
  permission_key TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(role_id, permission_key),
  FOREIGN KEY(role_id) REFERENCES app_roles(id),
  FOREIGN KEY(permission_key) REFERENCES app_permissions(permission_key)
);

CREATE TABLE employee_role_assignments (
  employee_id INTEGER NOT NULL,
  role_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(employee_id, role_id),
  FOREIGN KEY(employee_id) REFERENCES employees(id),
  FOREIGN KEY(role_id) REFERENCES app_roles(id)
);

CREATE TABLE auth_role_mappings (
  discord_role_id TEXT NOT NULL,
  role_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(discord_role_id, role_id),
  FOREIGN KEY(role_id) REFERENCES app_roles(id)
);

CREATE TABLE rank_permission_mappings (
  rank_value TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(rank_value, permission_key),
  FOREIGN KEY(permission_key) REFERENCES app_permissions(permission_key)
);

CREATE TABLE rank_discord_role_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rank_id INTEGER NOT NULL,
  discord_role_id TEXT NOT NULL,
  discord_role_name TEXT,
  guild_id TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(rank_id, discord_role_id),
  FOREIGN KEY(rank_id) REFERENCES config_ranks(id)
);

CREATE TABLE rank_group_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rank_id INTEGER NOT NULL,
  group_key TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(rank_id, group_key),
  FOREIGN KEY(rank_id) REFERENCES config_ranks(id)
);

CREATE TABLE cargo_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  active INTEGER NOT NULL DEFAULT 1,
  default_price REAL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE config_voyage_ports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE config_vessel_names (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE config_vessel_classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE config_vessel_callsigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  value TEXT NOT NULL UNIQUE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE voyages (
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
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(owner_employee_id) REFERENCES employees(id),
  FOREIGN KEY(officer_of_watch_employee_id) REFERENCES employees(id)
);

CREATE TABLE voyage_crew_members (
  voyage_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(voyage_id, employee_id),
  FOREIGN KEY(voyage_id) REFERENCES voyages(id),
  FOREIGN KEY(employee_id) REFERENCES employees(id)
);

CREATE TABLE voyage_participants (
  voyage_id INTEGER NOT NULL,
  employee_id INTEGER NOT NULL,
  role_in_voyage TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(voyage_id, employee_id, role_in_voyage),
  FOREIGN KEY(voyage_id) REFERENCES voyages(id),
  FOREIGN KEY(employee_id) REFERENCES employees(id)
);

CREATE TABLE voyage_manifest_lines (
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
);

CREATE TABLE voyage_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  voyage_id INTEGER NOT NULL,
  author_employee_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  log_type TEXT NOT NULL DEFAULT 'manual',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(voyage_id) REFERENCES voyages(id),
  FOREIGN KEY(author_employee_id) REFERENCES employees(id)
);

CREATE TABLE finance_settlement_audit (
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
);

CREATE TABLE finance_cash_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  starting_balance INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE finance_cash_ledger_entries (
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
);

CREATE TABLE finance_cashflow_audit (
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
);

CREATE TABLE admin_activity_events (
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
);

CREATE INDEX idx_employees_status ON employees(employee_status);
CREATE INDEX idx_employees_user_status ON employees(user_status);
CREATE INDEX idx_employees_activation_status ON employees(activation_status);
CREATE INDEX idx_employees_rank ON employees(rank);
CREATE INDEX idx_employees_grade ON employees(grade);
CREATE INDEX idx_employees_serial ON employees(serial_number);
CREATE INDEX idx_employees_roblox_user_id ON employees(roblox_user_id);
CREATE INDEX idx_employees_hire_date ON employees(hire_date);
CREATE INDEX idx_rank_discord_links_rank_id ON rank_discord_role_links(rank_id);
CREATE INDEX idx_rank_discord_links_role_id ON rank_discord_role_links(discord_role_id);
CREATE INDEX idx_rank_group_links_rank_id ON rank_group_links(rank_id);
CREATE INDEX idx_rank_group_links_group_key ON rank_group_links(group_key);
CREATE INDEX idx_voyages_status ON voyages(status);
CREATE INDEX idx_voyages_ended_at ON voyages(ended_at);
CREATE INDEX idx_voyages_company_share_status ON voyages(company_share_status);
CREATE UNIQUE INDEX ux_voyages_active_vessel_callsign
  ON voyages (LOWER(vessel_name), LOWER(vessel_callsign))
  WHERE status = 'ONGOING';
CREATE INDEX idx_voyage_participants_employee ON voyage_participants(employee_id);
CREATE INDEX idx_voyage_crew_members_employee ON voyage_crew_members(employee_id);
CREATE INDEX idx_voyage_manifest_voyage ON voyage_manifest_lines(voyage_id);
CREATE INDEX idx_voyage_logs_voyage ON voyage_logs(voyage_id, created_at DESC);
CREATE INDEX idx_finance_settlement_audit_created_at ON finance_settlement_audit(created_at DESC);
CREATE INDEX idx_finance_cash_ledger_created_at ON finance_cash_ledger_entries(created_at DESC);
CREATE INDEX idx_finance_cash_ledger_type ON finance_cash_ledger_entries(type);
CREATE INDEX idx_finance_cash_ledger_deleted_at ON finance_cash_ledger_entries(deleted_at);
CREATE INDEX idx_finance_cashflow_audit_created_at ON finance_cashflow_audit(created_at DESC);
CREATE INDEX idx_admin_activity_created_at ON admin_activity_events(created_at DESC);
CREATE INDEX idx_admin_activity_action_type ON admin_activity_events(action_type);
CREATE INDEX idx_admin_activity_target_employee ON admin_activity_events(target_employee_id);
CREATE INDEX idx_admin_activity_actor_employee ON admin_activity_events(actor_employee_id);
CREATE UNIQUE INDEX ux_app_roles_discord_role_id
  ON app_roles(discord_role_id)
  WHERE discord_role_id IS NOT NULL AND TRIM(discord_role_id) != '';

INSERT OR IGNORE INTO finance_cash_settings (id, starting_balance, updated_at) VALUES (1, 0, CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO config_employee_statuses(value) VALUES ('Active');
INSERT OR IGNORE INTO config_employee_statuses(value) VALUES ('On Leave');
INSERT OR IGNORE INTO config_employee_statuses(value) VALUES ('Suspended');
INSERT OR IGNORE INTO config_employee_statuses(value) VALUES ('Terminated');
INSERT OR IGNORE INTO config_disciplinary_types(value) VALUES ('Warning');
INSERT OR IGNORE INTO config_disciplinary_types(value) VALUES ('Final Warning');
INSERT OR IGNORE INTO config_disciplinary_types(value) VALUES ('Suspension');

INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('super.admin','roles','Super Admin','Global bypass permission.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('admin.override','admin','Admin Override','Grant all permissions across the application.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('admin.access','general','Admin Panel Access','View the admin panel entry points.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('dashboard.view','general','Dashboard View','Access the intranet dashboard.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('my_details.view','general','My Details View','View employee self-service details.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('employees.read','employees','View Employees','View employee lists and employee profiles.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('employees.create','employees','Create Employees','Create employee records.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('employees.edit','employees','Edit Employees','Edit employee profile fields.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('employees.discipline','employees','Manage Discipline','Create and update disciplinary records.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('employees.notes','employees','Manage Notes','Add employee notes and activity log entries.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('employees.access_requests.review','employees','Review Access Requests','Approve or deny access requests.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('config.manage','config','Manage Config','Manage statuses, ranks, grades, and disciplinary types.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('roles.read','user_groups','View User Groups','View role definitions and permissions.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('roles.manage','user_groups','Manage User Groups','Create, edit, delete, and reorder user groups.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('roles.assign','user_groups','Assign User Groups','Assign and unassign user groups for employees.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('user_groups.read','user_groups','View User Groups','View user group definitions and permissions.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('user_groups.manage','user_groups','Manage User Groups','Create, edit, delete, and reorder user groups.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('user_groups.assign','user_groups','Assign User Groups','Assign and unassign user groups for employees.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('user_ranks.manage','user_ranks','Manage User Ranks','Create, edit, delete, and reorder user ranks.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('user_ranks.permissions.manage','user_ranks','Manage User Rank Permissions','Edit permission mappings granted by user ranks.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('activity_tracker.view','activity_tracker','View Activity Tracker','View employee voyage activity statistics.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('activity_tracker.manage','activity_tracker','Manage Activity Tracker','Manage advanced activity tracker features.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('voyages.read','voyages','View Voyages','View voyage tracker.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('voyages.create','voyages','Create Voyages','Create voyage entries.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('voyages.edit','voyages','Edit Voyages','Edit voyage entries.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('voyages.end','voyages','End Voyages','End voyages and finalize voyage accounting.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('voyages.config.manage','voyages','Manage Voyage Config','Manage voyage config lists for ports and vessels.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('cargo.manage','voyages','Manage Cargo','Manage cargo type definitions for manifests.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('finances.view','finances','View Finances','View the finance dashboard and debt summaries.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('finances.debts.settle','finances','Settle Finance Debts','Settle outstanding company share debts.');
INSERT OR IGNORE INTO app_permissions (permission_key, permission_group, label, description) VALUES ('finances.audit.view','finances','View Finance Audit','View finance settlement audit logs.');

INSERT OR IGNORE INTO app_roles (role_key, name, description, sort_order, is_system)
VALUES ('owner', 'Owner', 'System owner role with full access.', 1, 1);

INSERT OR IGNORE INTO app_roles (role_key, name, description, sort_order, is_system)
VALUES ('employee', 'Employee', 'Default employee intranet access.', 100, 1);
