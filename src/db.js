import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';
import { demoTokenBalance } from './solana.js';

function addColumn(db, table, col, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
}

export function openDb(path = config.DB_PATH) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS billboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      location TEXT NOT NULL, city TEXT, run_date TEXT NOT NULL, run_days INTEGER,
      cost_usd REAL NOT NULL DEFAULT 0, cost_sol REAL NOT NULL DEFAULT 0,
      vendor TEXT, photo_url TEXT, proof_url TEXT, tx_sig TEXT, notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL, description TEXT, ends_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',            -- open | closed
      allow_proposals INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), closed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS designs (
      id TEXT PRIMARY KEY,                             -- random, unguessable for submissions
      title TEXT NOT NULL,
      x_handle TEXT,
      wallet TEXT,                                     -- set only when the submitter signed
      holder_balance REAL,                             -- balance at submit time (if signed)
      image_url TEXT NOT NULL, thumb_url TEXT NOT NULL,
      mime TEXT, bytes INTEGER, width INTEGER, height INTEGER,
      status TEXT NOT NULL DEFAULT 'pending',          -- pending | approved | rejected
      official INTEGER NOT NULL DEFAULT 0,
      ip_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')), reviewed_at TEXT
    );
    CREATE TABLE IF NOT EXISTS candidates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
      name TEXT NOT NULL, description TEXT,
      status TEXT NOT NULL DEFAULT 'approved',         -- approved | pending | rejected
      proposed_by TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS votes (
      round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
      wallet TEXT NOT NULL,
      candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
      weight_at_vote REAL NOT NULL, final_weight REAL,
      message TEXT NOT NULL, signature TEXT NOT NULL, signed_at INTEGER NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (round_id, wallet)
    );
  `);
  // v2 migrations: round kind + design candidates
  addColumn(db, 'rounds', 'kind', "TEXT NOT NULL DEFAULT 'location'"); // location | design | pair
  addColumn(db, 'candidates', 'design_id', 'TEXT REFERENCES designs(id)');
  return db;
}

/** Example coin used by demo mode (and by .env.ansemmas.example). */
export const EXAMPLE_SETTINGS = {
  coin_name: 'Ansemmas', token_symbol: 'ANSEMMAS', token_mint: 'HXxJdaQbrYRvwTAM8M8mUPyoRPvmyuUbPFBRkiAAMASS',
  site_title: 'Merry Ansemmas', tagline: 'Creator rewards buy billboards. Holders pick where they go and what goes on them.',
  mascot_url: '/examples/ansemmas/mascot.webp', website_url: 'https://ansemmas.fun/', x_url: 'https://x.com/Ansemmas',
  tiktok_url: 'https://www.tiktok.com/@ansemmas', dexscreener_url: 'https://dexscreener.com/solana/6qirp44q2t8b1cfbgmnqexcldqhfqmncfaffpkg4n156',
  theme_primary: '#d62b35', theme_secondary: '#1f9d55', theme_accent: '#6ff2c9', snow: 'true',
};

export function seedExampleDesigns(db) {
  const ins = db.prepare(`INSERT OR IGNORE INTO designs (id, title, x_handle, image_url, thumb_url, mime, width, height, status, official, reviewed_at)
    VALUES (?,?,?,?,?,?,?,?, 'approved', 1, datetime('now'))`);
  ins.run('example-mint', 'Merry Ansemmas (mint)', null, '/examples/ansemmas/ansemmas-billboard-mint-qr.png', '/examples/ansemmas/ansemmas-billboard-mint-qr.jpg', 'image/png', 1920, 1080);
  ins.run('example-red', 'Merry Ansemmas (red)', null, '/examples/ansemmas/ansemmas-billboard-red-qr.png', '/examples/ansemmas/ansemmas-billboard-red-qr.jpg', 'image/png', 1920, 1080);
}

export function seedDemo(db, settings) {
  if (db.prepare('SELECT COUNT(*) n FROM billboards').get().n > 0) return;
  settings.save(EXAMPLE_SETTINGS);
  seedExampleDesigns(db);
  const ins = db.prepare(`INSERT INTO billboards (location, city, run_date, run_days, cost_usd, cost_sol, vendor, photo_url, proof_url, tx_sig, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`);
  ins.run('I-35 & Riverside Dr (digital)', 'Austin, TX', '2026-11-14', 7, 42.5, 0.2361, 'Blip', '/examples/ansemmas/ansemmas-billboard-mint-qr.jpg', 'https://example.com/demo-receipt-1', 'DEMOtx1', 'DEMO DATA - sample entry');
  ins.run('Times Square side screen', 'New York, NY', '2026-12-02', 1, 120, 0.6667, 'AdQuick', '/examples/ansemmas/ansemmas-billboard-red-qr.jpg', 'https://example.com/demo-receipt-2', 'DEMOtx2', 'DEMO DATA - sample entry');

  const insC = db.prepare('INSERT INTO candidates (round_id, name, description, status, proposed_by, design_id) VALUES (?,?,?,?,?,?)');
  const insV = db.prepare(`INSERT INTO votes (round_id, wallet, candidate_id, weight_at_vote, final_weight, message, signature, signed_at) VALUES (?,?,?,?,?,?,?,?)`);
  const seedVotes = (round, cands, picks, prefix, closed) => picks.forEach((p, i) => {
    const w = `${prefix}${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`.slice(0, 44);
    const b = demoTokenBalance(w);
    insV.run(round, w, cands[p], b, closed ? b : null, 'DEMO seed vote', 'demo', Date.now());
  });

  const past = db.prepare(`INSERT INTO rounds (title, description, ends_at, status, closed_at, kind) VALUES (?,?,?,?,?,?)`)
    .run('Round 1: Where does billboard #2 go?', 'DEMO DATA', '2026-11-25T23:00:00Z', 'closed', '2026-11-25T23:00:00Z', 'location').lastInsertRowid;
  const pc = ['New York, NY', 'Miami, FL', 'Chicago, IL'].map((n) => insC.run(past, n, null, 'approved', null, null).lastInsertRowid);
  seedVotes(past, pc, [0, 2, 0, 1, 0], 'DemoPastVoter', true);

  const ends = new Date(Date.now() + 3 * 86400_000 + 5 * 3600_000).toISOString();
  const cur = db.prepare(`INSERT INTO rounds (title, description, ends_at, kind) VALUES (?,?,?,?)`)
    .run('Round 2: Where does billboard #3 go?', 'Pick the city for the next digital billboard. Weight = tokens held, re-checked at close.', ends, 'location').lastInsertRowid;
  const cc = [['Miami, FL', 'Brickell digital board'], ['Las Vegas, NV', 'Strip, rotating digital slot'], ['Chicago, IL', 'Kennedy Expressway inbound'], ['Nashville, TN', 'Broadway, downtown']]
    .map(([n, d]) => insC.run(cur, n, d, 'approved', null, null).lastInsertRowid);
  insC.run(cur, 'Denver, CO', 'Proposed by a holder', 'pending', 'DemoHo1der99999999999999999999999999999999', null);
  seedVotes(cur, cc, [0, 0, 1, 0, 2, 1, 3, 0, 1, 2, 0, 3, 1], 'DemoVoter', false);

  const dr = db.prepare(`INSERT INTO rounds (title, description, ends_at, kind) VALUES (?,?,?,?)`)
    .run('Design vote: which ad runs on billboard #3?', 'Pick the artwork for the next billboard.', ends, 'design').lastInsertRowid;
  const dc = [['Merry Ansemmas (mint)', 'example-mint'], ['Merry Ansemmas (red)', 'example-red']]
    .map(([n, d]) => insC.run(dr, n, null, 'approved', null, d).lastInsertRowid);
  seedVotes(dr, dc, [1, 0, 1, 1, 0, 1, 0, 1], 'DemoDesignVoter', false);
}
