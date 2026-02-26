PRAGMA foreign_keys=OFF;

-- Drop in dependency order
DROP TABLE IF EXISTS disciplinary_actions;
DROP TABLE IF EXISTS notes;
DROP TABLE IF EXISTS activity_events;
DROP TABLE IF EXISTS voyages;
DROP TABLE IF EXISTS employees;

-- Drop FTS artifacts
DROP TABLE IF EXISTS employees_fts;
DROP TRIGGER IF EXISTS employees_ai;
DROP TRIGGER IF EXISTS employees_ad;
DROP TRIGGER IF EXISTS employees_au;

PRAGMA foreign_keys=ON;

-- Core
CREATE TABLE employees (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  robloxUserId TEXT NOT NULL,
  robloxUsername TEXT NOT NULL,
  serial TEXT,
  rank TEXT,
  grade TEXT,
  status TEXT NOT NULL CHECK(status IN ('Active','Inactive','Suspended')) DEFAULT 'Active',
  hireDate TEXT,        -- ISO date YYYY-MM-DD
  lastUpdated TEXT      -- ISO timestamp
);

CREATE TABLE voyages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employeeId INTEGER NOT NULL,
  vesselName TEXT NOT NULL,
  route TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ONGOING','ENDED')),
  startedAt TEXT NOT NULL,
  endedAt TEXT,
  FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employeeId INTEGER NOT NULL,
  type TEXT NOT NULL,
  message TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  createdByName TEXT,
  FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employeeId INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('USER','SYSTEM')),
  title TEXT,
  body TEXT NOT NULL,
  createdAt TEXT NOT NULL,
  createdByName TEXT,
  FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE disciplinary_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  employeeId INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('OPEN','CLOSED')) DEFAULT 'OPEN',
  level TEXT NOT NULL CHECK(level IN ('WARNING','STRIKE','SUSPENSION','TERMINATION','OTHER')),
  reason TEXT NOT NULL,
  details TEXT,
  issuedAt TEXT NOT NULL,
  issuedByName TEXT,
  closedAt TEXT,
  closedByName TEXT,
  FOREIGN KEY (employeeId) REFERENCES employees(id) ON DELETE CASCADE
);

-- Indexes (critical on D1)
CREATE UNIQUE INDEX idx_employees_robloxUserId ON employees(robloxUserId);
CREATE INDEX idx_employees_status ON employees(status);
CREATE INDEX idx_employees_rank ON employees(rank);
CREATE INDEX idx_employees_grade ON employees(grade);
CREATE INDEX idx_employees_hireDate ON employees(hireDate);
CREATE INDEX idx_employees_serial ON employees(serial);
CREATE INDEX idx_employees_username ON employees(robloxUsername);

-- Composite index for common filters
CREATE INDEX idx_employees_filters ON employees(status, rank, grade, hireDate);

-- FK indexes
CREATE INDEX idx_voyages_employeeId ON voyages(employeeId);
CREATE INDEX idx_notes_employeeId ON notes(employeeId);
CREATE INDEX idx_activity_employeeId ON activity_events(employeeId);
CREATE INDEX idx_disc_employeeId ON disciplinary_actions(employeeId);

-- FTS5 for fast search across username/robloxUserId/serial
CREATE VIRTUAL TABLE employees_fts USING fts5(
  robloxUsername,
  robloxUserId,
  serial,
  content='employees',
  content_rowid='id'
);

-- Keep FTS in sync
CREATE TRIGGER employees_ai AFTER INSERT ON employees BEGIN
  INSERT INTO employees_fts(rowid, robloxUsername, robloxUserId, serial)
  VALUES (new.id, new.robloxUsername, new.robloxUserId, COALESCE(new.serial,''));
END;

CREATE TRIGGER employees_ad AFTER DELETE ON employees BEGIN
  INSERT INTO employees_fts(employees_fts, rowid, robloxUsername, robloxUserId, serial)
  VALUES ('delete', old.id, old.robloxUsername, old.robloxUserId, COALESCE(old.serial,''));
END;

CREATE TRIGGER employees_au AFTER UPDATE ON employees BEGIN
  INSERT INTO employees_fts(employees_fts, rowid, robloxUsername, robloxUserId, serial)
  VALUES ('delete', old.id, old.robloxUsername, old.robloxUserId, COALESCE(old.serial,''));
  INSERT INTO employees_fts(rowid, robloxUsername, robloxUserId, serial)
  VALUES (new.id, new.robloxUsername, new.robloxUserId, COALESCE(new.serial,''));
END;