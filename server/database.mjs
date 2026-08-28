import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { config } from './config.mjs'

mkdirSync(config.dataDir, { recursive: true })

export const db = new Database(join(config.dataDir, 'app.db'))

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')
db.pragma('busy_timeout = 5000')

db.exec(`
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    content TEXT NOT NULL DEFAULT '',
    link_url TEXT NOT NULL DEFAULT '',
    link_label TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'offline')),
    show_popup INTEGER NOT NULL DEFAULT 0,
    popup_once INTEGER NOT NULL DEFAULT 1,
    pinned INTEGER NOT NULL DEFAULT 0,
    show_bar INTEGER NOT NULL DEFAULT 0,
    dismissible INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 0,
    starts_at TEXT,
    ends_at TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_announcements_status_time
  ON announcements(status, starts_at, ends_at);

  CREATE TABLE IF NOT EXISTS admin_sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS visit_sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_hash TEXT NOT NULL,
    ip_address TEXT NOT NULL DEFAULT '',
    session_started_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_visit_sessions_ip_time
  ON visit_sessions(ip_hash, last_seen_at);

  CREATE TABLE IF NOT EXISTS generation_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL UNIQUE,
    ip_hash TEXT NOT NULL,
    ip_address TEXT NOT NULL DEFAULT '',
    endpoint TEXT NOT NULL,
    module TEXT NOT NULL DEFAULT 'gpt',
    action TEXT NOT NULL DEFAULT 'generate',
    model TEXT NOT NULL DEFAULT '',
    upstream_channel TEXT NOT NULL DEFAULT '',
    route_path TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    resolution_tier TEXT NOT NULL DEFAULT 'other',
    output_size TEXT NOT NULL DEFAULT '',
    output_resolution_tier TEXT NOT NULL DEFAULT 'other',
    quality TEXT NOT NULL DEFAULT '',
    image_count INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL CHECK (status IN ('started', 'success', 'failed')),
    upstream_status INTEGER,
    duration_ms INTEGER,
    error_summary TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    completed_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_generation_events_created_at
  ON generation_events(created_at);

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    request_id TEXT NOT NULL DEFAULT '',
    level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
    type TEXT NOT NULL,
    event TEXT NOT NULL,
    ip_hash TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT '',
    duration_ms INTEGER,
    details_json TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);
  CREATE INDEX IF NOT EXISTS idx_logs_type_event ON logs(type, event);

  CREATE TABLE IF NOT EXISTS blocked_ips (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ip_address TEXT NOT NULL UNIQUE,
    reason TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    expires_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_blocked_ips_address
  ON blocked_ips(ip_address);
`)

function ensureColumn(table, column, definition) {
  const columns = db.pragma(`table_info(${table})`)
  if (columns.some((item) => item.name === column)) return
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

ensureColumn('visit_sessions', 'ip_address', "TEXT NOT NULL DEFAULT ''")
ensureColumn('generation_events', 'ip_address', "TEXT NOT NULL DEFAULT ''")
ensureColumn('generation_events', 'module', "TEXT NOT NULL DEFAULT 'gpt'")
ensureColumn('generation_events', 'action', "TEXT NOT NULL DEFAULT 'generate'")
ensureColumn('generation_events', 'upstream_channel', "TEXT NOT NULL DEFAULT ''")
ensureColumn('generation_events', 'route_path', "TEXT NOT NULL DEFAULT ''")
ensureColumn('generation_events', 'prompt', "TEXT NOT NULL DEFAULT ''")
ensureColumn('generation_events', 'size', "TEXT NOT NULL DEFAULT ''")
ensureColumn('generation_events', 'resolution_tier', "TEXT NOT NULL DEFAULT 'other'")
ensureColumn('generation_events', 'output_size', "TEXT NOT NULL DEFAULT ''")
ensureColumn('generation_events', 'output_resolution_tier', "TEXT NOT NULL DEFAULT 'other'")
ensureColumn('generation_events', 'quality', "TEXT NOT NULL DEFAULT ''")
