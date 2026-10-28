import fs from 'node:fs';
import path from 'node:path';

// node:sqlite is stable enough for this app on Node 22, but still prints an
// experimental warning. Drop only that warning so test output stays readable.
const emit = process.emit.bind(process);
process.emit = function (event, warning, ...rest) {
  if (event === 'warning' && warning?.name === 'ExperimentalWarning' && /SQLite/i.test(String(warning.message))) {
    return false;
  }
  return emit(event, warning, ...rest);
};

const { DatabaseSync } = await import('node:sqlite');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS designs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  x_handle TEXT,
  wallet TEXT,
  image_url TEXT NOT NULL,
  thumb_url TEXT NOT NULL,
  width INTEGER,
  height INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  official INTEGER NOT NULL DEFAULT 0,
  holder_balance REAL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS billboards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  location TEXT NOT NULL,
  city TEXT,
  run_date TEXT NOT NULL,
  run_days INTEGER,
  vendor TEXT,
  cost_usd REAL NOT NULL DEFAULT 0,
  cost_sol REAL NOT NULL DEFAULT 0,
  notes TEXT,
  photo_url TEXT,
  proof_url TEXT,
  tx_sig TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  ends_at TEXT NOT NULL,
  allow_proposals INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  design_id TEXT,
  status TEXT NOT NULL DEFAULT 'approved',
  proposed_by TEXT,
  proposal_message TEXT,
  proposal_signature TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS votes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id INTEGER NOT NULL,
  wallet TEXT NOT NULL,
  candidate_id INTEGER NOT NULL,
  message TEXT NOT NULL,
  signature TEXT NOT NULL,
  balance_at_vote REAL NOT NULL,
  weight REAL NOT NULL,
  valid INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(round_id, wallet)
);
`;

export function openDatabase(dbPath) {
  if (dbPath !== ':memory:') {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  if (dbPath !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  return db;
}

export function stamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, '');
}

export function iso(date = new Date()) {
  return date.toISOString();
}
