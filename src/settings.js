// Coin/site settings. Precedence: admin-saved value (DB) > env var > default.
// Everything coin-specific is here so the site can go live before launch and be filled in after.

const HEX = /^#[0-9a-fA-F]{6}$/;
const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HANDLE = /^[A-Za-z0-9_]{1,15}$/;

const url = (v) => {
  if (v === '') return '';
  if (/^\/(assets|uploads|examples)\/[\w\-./]+$/.test(v) && !v.includes('..')) return v;
  const u = new URL(v); // throws on garbage
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('must be http(s)');
  return u.toString();
};
const text = (max) => (v) => String(v).replace(/[\r\n]+/g, ' ').trim().slice(0, max);
const numberIn = (min, max) => (v) => { const n = Number(v); if (!Number.isFinite(n) || n < min || n > max) throw new Error(`must be ${min}-${max}`); return n; };

// key: [ENV_VAR, default, validator, public?]
export const SCHEMA = {
  coin_name:        ['COIN_NAME', '', text(40), true],
  token_symbol:     ['TOKEN_SYMBOL', '', (v) => text(16)(v).replace(/^\$/, '').toUpperCase(), true],
  token_mint:       ['TOKEN_MINT', '', (v) => { v = String(v).trim(); if (v && !MINT.test(v)) throw new Error('not a Solana address'); return v; }, true],
  rewards_wallet:   ['REWARDS_WALLET', '', (v) => { v = String(v).trim(); if (v && !MINT.test(v)) throw new Error('not a Solana address'); return v; }, true],
  site_title:       ['SITE_TITLE', 'Billboard Fund', text(60), true],
  tagline:          ['TAGLINE', 'Creator rewards buy billboards. Holders pick where they go.', text(160), true],
  launch_note:      ['LAUNCH_NOTE', 'Launching soon. Rewards tracking and holder voting go live at launch. You can submit billboard designs now.', text(300), true],
  mascot_url:       ['MASCOT_URL', '', url, true],
  website_url:      ['WEBSITE_URL', '', url, true],
  x_url:            ['X_URL', '', url, true],
  tiktok_url:       ['TIKTOK_URL', '', url, true],
  telegram_url:     ['TELEGRAM_URL', '', url, true],
  dexscreener_url:  ['DEXSCREENER_URL', '', url, true],
  review_x_handle:  ['REVIEW_X_HANDLE', 'RiseofMemes', (v) => { v = String(v).trim().replace(/^@/, ''); if (!HANDLE.test(v)) throw new Error('invalid X handle'); return v; }, true],
  theme_primary:    ['THEME_PRIMARY', '#7c5cff', (v) => { if (!HEX.test(v)) throw new Error('hex color like #aabbcc'); return v; }, true],
  theme_secondary:  ['THEME_SECONDARY', '#22c55e', (v) => { if (!HEX.test(v)) throw new Error('hex color'); return v; }, true],
  theme_accent:     ['THEME_ACCENT', '#5eead4', (v) => { if (!HEX.test(v)) throw new Error('hex color'); return v; }, true],
  snow:             ['THEME_SNOW', 'false', (v) => (/^(1|true|on|yes)$/i.test(String(v)) ? 'true' : 'false'), true],
  min_holding:      ['MIN_HOLDING', '100000', (v) => String(numberIn(0, 1e15)(v)), true],
  reserve_sol:      ['RESERVE_SOL', '0.05', (v) => String(numberIn(0, 1000)(v)), true],
  next_billboard_target_usd: ['NEXT_BILLBOARD_TARGET_USD', '50', (v) => String(numberIn(0, 1e7)(v)), true],
};

/** Validate a partial update. Returns { values, errors }. Empty string clears back to env/default. */
export function validateSettings(input) {
  const values = {}, errors = {};
  for (const [k, v] of Object.entries(input || {})) {
    if (!SCHEMA[k]) continue;
    if (v === null || v === undefined || String(v).trim() === '') { values[k] = null; continue; }
    try { values[k] = SCHEMA[k][2](String(v).trim()); } catch (e) { errors[k] = e.message; }
  }
  return { values, errors };
}

export function createSettings(db, envSource = process.env) {
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT DEFAULT (datetime(\'now\')))');
  let cache = null;
  const load = () => {
    const saved = Object.fromEntries(db.prepare('SELECT key, value FROM settings').all().map((r) => [r.key, r.value]));
    const out = {};
    for (const [k, [envKey, def, validate]] of Object.entries(SCHEMA)) {
      let v = saved[k];
      if (v === undefined || v === null) {
        const e = envSource[envKey];
        if (e !== undefined && String(e).trim() !== '') { try { v = validate(String(e).trim()); } catch { v = def; console.warn(`Ignoring invalid env ${envKey}`); } }
        else v = def;
      }
      out[k] = v;
    }
    out.min_holding = Number(out.min_holding);
    out.reserve_sol = Number(out.reserve_sol);
    out.next_billboard_target_usd = Number(out.next_billboard_target_usd);
    out.snow = out.snow === 'true';
    out.launched = Boolean(out.token_mint);
    return out;
  };
  return {
    get() { return (cache ||= load()); },
    save(values) {
      const up = db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?,?,datetime('now')) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`);
      const del = db.prepare('DELETE FROM settings WHERE key=?');
      for (const [k, v] of Object.entries(values)) (v === null ? del.run(k) : up.run(k, v));
      cache = null;
      return this.get();
    },
    /** Which keys are overridden in the admin page (vs env/default). */
    savedKeys() { return db.prepare('SELECT key FROM settings').all().map((r) => r.key); },
  };
}
