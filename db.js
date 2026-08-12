// =====================================================================
// db.js - SQLite schema + connection for the Zone Sports Portal
//
// Uses Node's built-in `node:sqlite` module (DatabaseSync) instead of a
// third-party native package. This ships with Node.js itself (v22.5+),
// so there is nothing to compile and nothing that can fail to install
// on a hosting platform - the database "just works" everywhere Node runs.
// =====================================================================
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'zonesports.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT UNIQUE,
  phone TEXT,
  role TEXT NOT NULL,
  school_id TEXT,
  photo_url TEXT,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS schools (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT,
  address TEXT,
  principal_name TEXT,
  phone TEXT,
  email TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  bib_start INTEGER,
  bib_end INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  designation TEXT,
  school_id TEXT,
  email TEXT,
  phone TEXT,
  photo_url TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  father_name TEXT,
  dob TEXT,
  gender TEXT,
  category TEXT,
  school_id TEXT NOT NULL,
  photo_url TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  bib_no INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sport TEXT,
  gender TEXT,
  category TEXT,
  event_type TEXT,
  venue TEXT,
  status TEXT NOT NULL DEFAULT 'SCHEDULED',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_schedule (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  event_date TEXT,
  start_time TEXT,
  reporting_time TEXT,
  venue TEXT,
  status TEXT NOT NULL DEFAULT 'UPCOMING',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS event_entries (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  school_id TEXT,
  bib_no TEXT,
  entry_status TEXT NOT NULL DEFAULT 'ENTERED',
  verified TEXT NOT NULL DEFAULT 'NO',
  verified_by TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS officials (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL,
  role TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS duties (
  id TEXT PRIMARY KEY,
  schedule_id TEXT NOT NULL,
  official_id TEXT NOT NULL,
  duty_role TEXT,
  duty_location TEXT,
  status TEXT NOT NULL DEFAULT 'ASSIGNED',
  acknowledged TEXT NOT NULL DEFAULT 'NO',
  completed TEXT NOT NULL DEFAULT 'NO',
  approved_by TEXT,
  approved_at TEXT,
  is_incharge TEXT NOT NULL DEFAULT 'NO',
  attendance TEXT NOT NULL DEFAULT 'PENDING',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_log (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL,
  event_id TEXT,
  student_id TEXT,
  verified TEXT,
  verified_by TEXT,
  remarks TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS results (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  school_id TEXT,
  position TEXT NOT NULL,
  timing TEXT,
  points INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'RECORDED',
  recorded_by TEXT,
  recorded_at TEXT NOT NULL,
  approved_by TEXT,
  approved_at TEXT,
  UNIQUE(event_id, student_id)
);

CREATE TABLE IF NOT EXISTS certificates (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  recipient_id TEXT NOT NULL,
  event_id TEXT,
  position TEXT,
  verification_code TEXT,
  status TEXT NOT NULL DEFAULT 'GENERATED',
  generated_at TEXT NOT NULL,
  approved_by TEXT
);

CREATE TABLE IF NOT EXISTS feedback (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT,
  module TEXT,
  record_id TEXT,
  details TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE INDEX IF NOT EXISTS idx_students_school ON students(school_id);
CREATE INDEX IF NOT EXISTS idx_teachers_school ON teachers(school_id);
CREATE INDEX IF NOT EXISTS idx_entries_event ON event_entries(event_id);
CREATE INDEX IF NOT EXISTS idx_entries_student ON event_entries(student_id);
CREATE INDEX IF NOT EXISTS idx_duties_official ON duties(official_id);
CREATE INDEX IF NOT EXISTS idx_results_event ON results(event_id);
CREATE INDEX IF NOT EXISTS idx_officials_teacher ON officials(teacher_id);
`);

// node:sqlite's DatabaseSync.prepare() does not accept template-tag calls
// with the spread operator the same way better-sqlite3 does for statements
// with a dynamic number of "?" placeholders (used by a couple of IN (...)
// queries in server.js). Wrap `.get`/`.all`/`.run` so spreading an array of
// params (e.g. `stmt.all(...ids)`) always works exactly like better-sqlite3.
module.exports = db;
