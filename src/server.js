import express from 'express';
import multer from 'multer';
import { timingSafeEqual, createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync, mkdirSync } from 'node:fs';
import { config } from './config.js';
import { openDb, seedDemo } from './db.js';
import { createSettings, validateSettings } from './settings.js';
import { getRewardsBalance, getSolUsd, getTokenBalance, getMintInfo, getDexStats } from './solana.js';
import { verifySignedAction, isValidPublicKey, MESSAGE_HEADER, MESSAGE_FOOTER } from './verify.js';
import { processImage, removeFiles } from './uploads.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = join(__dirname, '..', 'public');
const DESIGN_DIR = join(config.UPLOAD_DIR, 'designs');
const MEDIA_DIR = join(config.UPLOAD_DIR, 'media');
mkdirSync(DESIGN_DIR, { recursive: true }); mkdirSync(MEDIA_DIR, { recursive: true });

const db = openDb();
const settings = createSettings(db);
if (config.DEMO) seedDemo(db, settings);
const S = () => settings.get();

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '32kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  next();
});

// ---------- helpers ----------
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch((e) => {
  console.error(e);
  res.status(500).json({ error: 'Server error' });
});
const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const str = (v, max = 200) => (typeof v === 'string' ? v.replace(/[\r\n]+/g, ' ').trim().slice(0, max) : '');
const safeUrl = (v) => {
  const s = str(v, 500);
  if (!s) return null;
  if (/^\/(uploads|examples)\/[\w\-./]+$/.test(s) && !s.includes('..')) return s;
  try { const u = new URL(s); return ['http:', 'https:'].includes(u.protocol) ? u.toString() : null; } catch { return null; }
};
const ipHash = (req) => createHash('sha256').update('ip:' + req.ip).digest('hex').slice(0, 24);
const baseUrl = (req) => config.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function requireAdmin(req, res, next) {
  if (!config.ADMIN_TOKEN) return bad(res, 'Admin disabled (ADMIN_TOKEN not set)', 403);
  const a = createHash('sha256').update(String(req.get('x-admin-token') || '')).digest();
  const b = createHash('sha256').update(config.ADMIN_TOKEN).digest();
  if (!timingSafeEqual(a, b)) return bad(res, 'Bad admin token', 401);
  next();
}

const hits = new Map();
function rateLimit(max, windowMs, name) {
  return (req, res, next) => {
    const key = req.ip + (name || req.path);
    const now = Date.now();
    const h = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (h.length >= max) return bad(res, 'Too many requests, slow down', 429);
    h.push(now); hits.set(key, h); next();
  };
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some((t) => now - t < 3600_000)) hits.delete(k); }, 600_000).unref();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_UPLOAD_BYTES, files: 1, fields: 12, fieldSize: 4096, parts: 14 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(png|jpeg|webp)$/.test(file.mimetype)),
});
const single = (field) => (req, res, next) => upload.single(field)(req, res, (err) => {
  if (!err) return next();
  if (err.code === 'LIMIT_FILE_SIZE') return bad(res, `File too large (max ${config.MAX_UPLOAD_BYTES / 1048576} MB)`, 413);
  return bad(res, 'Upload rejected: ' + err.message);
});

const notLaunched = (res) => bad(res, 'The coin has not launched yet. Voting opens at launch.', 409);
function roundIsOpen(r) { return r.status === 'open' && Date.parse(r.ends_at) > Date.now(); }

function roundResults(roundId) {
  const r = db.prepare('SELECT * FROM rounds WHERE id = ?').get(roundId);
  if (!r) return null;
  const closed = r.status === 'closed';
  const weightCol = closed ? 'COALESCE(v.final_weight, 0)' : 'v.weight_at_vote';
  const cands = db.prepare(`
    SELECT c.id, c.name, c.description, c.status, c.proposed_by, c.design_id,
      d.thumb_url AS design_thumb, d.image_url AS design_image, d.title AS design_title, d.x_handle AS design_by,
      COUNT(v.wallet) AS votes,
      COALESCE(SUM(${weightCol}), 0) AS weight,
      COALESCE(SUM(CASE WHEN v.wallet IS NOT NULL ${closed ? 'AND COALESCE(v.final_weight,0) > 0' : ''} THEN 1 ELSE 0 END),0) AS valid_votes
    FROM candidates c
    LEFT JOIN designs d ON d.id = c.design_id
    LEFT JOIN votes v ON v.candidate_id = c.id AND v.round_id = c.round_id
    WHERE c.round_id = ? AND c.status = 'approved'
    GROUP BY c.id ORDER BY weight DESC, votes DESC, c.id`).all(roundId);
  const pending = db.prepare(`SELECT id, name, description, proposed_by, created_at FROM candidates WHERE round_id = ? AND status = 'pending' ORDER BY id`).all(roundId);
  const totals = cands.reduce((t, c) => ({ weight: t.weight + c.weight, votes: t.votes + c.votes }), { weight: 0, votes: 0 });
  return { round: { ...r, open: roundIsOpen(r), allow_proposals: !!r.allow_proposals && r.kind === 'location' }, candidates: cands, pending, totals };
}

/** Close a round: re-weigh every vote at current balances to blunt buy-vote-sell gaming. */
async function finalizeRound(roundId) {
  const { token_mint, min_holding } = S();
  const votes = db.prepare('SELECT wallet, weight_at_vote FROM votes WHERE round_id = ?').all(roundId);
  const upd = db.prepare('UPDATE votes SET final_weight = ? WHERE round_id = ? AND wallet = ?');
  let failures = 0;
  for (const v of votes) {
    let w;
    if (config.DEMO && v.wallet.startsWith('Demo')) w = v.weight_at_vote; // seeded demo voters
    else {
      try {
        const bal = await getTokenBalance(v.wallet, token_mint);
        w = bal >= min_holding ? Math.min(bal, v.weight_at_vote) : 0; // lower of vote-time and close-time balance
      } catch { failures++; continue; }
      await new Promise((r) => setTimeout(r, 150)); // be gentle with public RPC
    }
    upd.run(w, roundId, v.wallet);
  }
  if (failures) throw new Error(`${failures} balance lookups failed; round left open, retry close`);
  db.prepare(`UPDATE rounds SET status='closed', closed_at=datetime('now') WHERE id=?`).run(roundId);
}

let finalizing = false;
setInterval(async () => {
  if (finalizing) return;
  finalizing = true;
  try {
    const due = db.prepare(`SELECT id, ends_at FROM rounds WHERE status='open'`).all().filter((r) => Date.parse(r.ends_at) <= Date.now());
    for (const r of due) { try { await finalizeRound(r.id); console.log(`Round ${r.id} finalized`); } catch (e) { console.error(e.message); } }
  } finally { finalizing = false; }
}, 60_000).unref();

// ---------- public API ----------
function publicSettings() {
  const s = S();
  return {
    demo: config.DEMO, launched: s.launched,
    coinName: s.coin_name, tokenSymbol: s.token_symbol, tokenMint: s.token_mint || null,
    rewardsWallet: s.rewards_wallet || null,
    siteTitle: s.site_title, tagline: s.tagline, launchNote: s.launch_note, mascotUrl: s.mascot_url || null,
    links: { website: s.website_url, x: s.x_url, tiktok: s.tiktok_url, telegram: s.telegram_url, dexscreener: s.dexscreener_url },
    reviewXHandle: s.review_x_handle,
    theme: { primary: s.theme_primary, secondary: s.theme_secondary, accent: s.theme_accent, snow: s.snow },
    minHolding: s.min_holding, maxUploadMb: config.MAX_UPLOAD_BYTES / 1048576,
    adminEnabled: Boolean(config.ADMIN_TOKEN),
    message: { header: MESSAGE_HEADER, footer: MESSAGE_FOOTER },
  };
}
app.get('/api/config', (req, res) => res.json(publicSettings()));

app.get('/api/dashboard', wrap(async (req, res) => {
  const s = S();
  const [bal, price] = await Promise.all([getRewardsBalance(s.rewards_wallet), getSolUsd()]);
  const spent = db.prepare('SELECT COUNT(*) n, COALESCE(SUM(cost_sol),0) sol, COALESCE(SUM(cost_usd),0) usd FROM billboards').get();
  let mint = null, mintError = null, market = null;
  if (s.launched) {
    [mint, market] = await Promise.all([getMintInfo(s.token_mint).catch((e) => { mintError = e.message; return null; }), getDexStats(s.token_mint)]);
  }
  const balanceSol = bal.sol;
  const availableSol = balanceSol === null ? null : Math.max(0, balanceSol - s.reserve_sol);
  const usd = price.usd;
  res.json({
    demo: config.DEMO, launched: s.launched,
    rewardsWalletSet: Boolean(s.rewards_wallet), rewardsWallet: s.rewards_wallet || null,
    balanceSol, balanceUsd: balanceSol !== null && usd ? balanceSol * usd : null,
    availableSol, availableUsd: availableSol !== null && usd ? availableSol * usd : null,
    reserveSol: s.reserve_sol, solUsd: usd, priceSource: price.source,
    spent: { count: spent.n, sol: spent.sol, usd: spent.usd },
    totalFundedSol: balanceSol !== null ? balanceSol + spent.sol : null,
    nextTargetUsd: s.next_billboard_target_usd,
    balanceError: bal.error || null,
    mint, mintError, market,
    updatedAt: new Date().toISOString(),
  });
}));

app.get('/api/billboards', (req, res) => res.json(db.prepare('SELECT * FROM billboards ORDER BY run_date DESC, id DESC').all()));

app.get('/api/rounds', (req, res) => res.json(db.prepare('SELECT id FROM rounds ORDER BY id DESC').all().map((r) => roundResults(r.id))));
app.get('/api/rounds/:id', (req, res) => {
  const r = roundResults(Number(req.params.id));
  if (!r) return bad(res, 'Round not found', 404);
  res.json(r);
});
app.get('/api/rounds/:id/vote/:wallet', (req, res) => {
  res.json(db.prepare('SELECT candidate_id, weight_at_vote, final_weight, updated_at FROM votes WHERE round_id=? AND wallet=?').get(Number(req.params.id), req.params.wallet) || null);
});
// Public audit: every signed vote so anyone can re-verify signatures independently.
app.get('/api/rounds/:id/audit', (req, res) => {
  res.json(db.prepare('SELECT wallet, candidate_id, weight_at_vote, final_weight, message, signature FROM votes WHERE round_id=? ORDER BY wallet').all(Number(req.params.id)));
});

app.get('/api/holder/:wallet', rateLimit(30, 60_000), wrap(async (req, res) => {
  const s = S();
  if (!s.launched && !config.DEMO) return notLaunched(res);
  if (!isValidPublicKey(req.params.wallet)) return bad(res, 'Invalid wallet');
  try {
    const balance = await getTokenBalance(req.params.wallet, s.token_mint);
    res.json({ balance, minHolding: s.min_holding, eligible: balance >= s.min_holding, demo: config.DEMO });
  } catch { bad(res, 'Could not read token balance from RPC', 502); }
}));

app.post('/api/rounds/:id/vote', rateLimit(10, 60_000), wrap(async (req, res) => {
  const s = S();
  if (!s.launched) return notLaunched(res);
  const roundId = Number(req.params.id);
  const { wallet, message, signature } = req.body || {};
  const candidateId = Number(req.body?.candidateId);
  const round = db.prepare('SELECT * FROM rounds WHERE id=?').get(roundId);
  if (!round) return bad(res, 'Round not found', 404);
  if (!roundIsOpen(round)) return bad(res, 'Voting is closed for this round');
  if (!db.prepare(`SELECT 1 FROM candidates WHERE id=? AND round_id=? AND status='approved'`).get(candidateId, roundId)) return bad(res, 'Unknown candidate');

  const check = verifySignedAction({ message, signature, wallet, maxAgeMs: config.MESSAGE_MAX_AGE_MS,
    expected: { Action: 'vote', Mint: s.token_mint, Round: roundId, Candidate: candidateId } });
  if (!check.ok) return bad(res, check.error, 401);
  const prev = db.prepare('SELECT signed_at FROM votes WHERE round_id=? AND wallet=?').get(roundId, wallet);
  if (prev && check.timestamp <= prev.signed_at) return bad(res, 'This signature was already used; sign again', 409);

  let balance;
  try { balance = await getTokenBalance(wallet, s.token_mint); } catch { return bad(res, 'Could not read token balance from RPC, try again', 502); }
  if (balance < s.min_holding) return bad(res, `You need at least ${s.min_holding.toLocaleString()} tokens to vote (you hold ${balance.toLocaleString()})`, 403);

  db.prepare(`INSERT INTO votes (round_id, wallet, candidate_id, weight_at_vote, message, signature, signed_at, updated_at)
    VALUES (?,?,?,?,?,?,?,datetime('now'))
    ON CONFLICT(round_id, wallet) DO UPDATE SET candidate_id=excluded.candidate_id, weight_at_vote=excluded.weight_at_vote,
      message=excluded.message, signature=excluded.signature, signed_at=excluded.signed_at, updated_at=excluded.updated_at`)
    .run(roundId, wallet, candidateId, balance, message, signature, check.timestamp);
  res.json({ ok: true, changed: !!prev, weight: balance, results: roundResults(roundId) });
}));

app.post('/api/rounds/:id/propose', rateLimit(5, 60_000), wrap(async (req, res) => {
  const s = S();
  if (!s.launched) return notLaunched(res);
  const roundId = Number(req.params.id);
  const { wallet, message, signature } = req.body || {};
  const name = str(req.body?.name, 80);
  if (!name) return bad(res, 'Location name required');
  const round = db.prepare('SELECT * FROM rounds WHERE id=?').get(roundId);
  if (!round || !roundIsOpen(round)) return bad(res, 'Round is not open');
  if (!round.allow_proposals || round.kind !== 'location') return bad(res, 'Proposals are disabled for this round');
  const check = verifySignedAction({ message, signature, wallet, maxAgeMs: config.MESSAGE_MAX_AGE_MS,
    expected: { Action: 'propose', Mint: s.token_mint, Round: roundId, Location: name } });
  if (!check.ok) return bad(res, check.error, 401);
  if (db.prepare(`SELECT COUNT(*) n FROM candidates WHERE round_id=? AND proposed_by=? AND status='pending'`).get(roundId, wallet).n >= 2)
    return bad(res, 'You already have 2 pending proposals in this round', 429);
  let balance;
  try { balance = await getTokenBalance(wallet, s.token_mint); } catch { return bad(res, 'Could not read token balance from RPC', 502); }
  if (balance < s.min_holding) return bad(res, `You need at least ${s.min_holding.toLocaleString()} tokens to propose`, 403);
  db.prepare(`INSERT INTO candidates (round_id, name, status, proposed_by) VALUES (?,?,?,?)`).run(roundId, name, 'pending', wallet);
  res.json({ ok: true });
}));

// ---------- designs ----------
const DESIGN_PUBLIC = 'id, title, x_handle, wallet, holder_balance, image_url, thumb_url, width, height, status, official, created_at';
app.get('/api/designs', (req, res) => {
  res.json(db.prepare(`SELECT ${DESIGN_PUBLIC} FROM designs WHERE status='approved' ORDER BY official DESC, reviewed_at DESC`).all());
});
app.get('/api/designs/:id', (req, res) => {
  const d = db.prepare(`SELECT ${DESIGN_PUBLIC} FROM designs WHERE id=? AND status != 'rejected'`).get(String(req.params.id));
  if (!d) return bad(res, 'Design not found', 404);
  res.json(d);
});

// Submit a design. multipart: image (file), title, x_handle?, wallet?, message?, signature?
app.post('/api/designs', rateLimit(3, 10 * 60_000, 'design-upload'), single('image'), wrap(async (req, res) => {
  const s = S();
  const title = str(req.body?.title, 80);
  const xHandle = str(req.body?.x_handle, 16).replace(/^@/, '');
  if (!title) return bad(res, 'Title is required');
  if (xHandle && !/^[A-Za-z0-9_]{1,15}$/.test(xHandle)) return bad(res, 'X handle looks invalid');
  if (!req.file) return bad(res, 'Attach a PNG, JPG or WEBP image');
  const ip = ipHash(req);
  if (db.prepare(`SELECT COUNT(*) n FROM designs WHERE status='pending'`).get().n >= config.MAX_PENDING_DESIGNS) return bad(res, 'The review queue is full right now. Try again later.', 503);
  if (db.prepare(`SELECT COUNT(*) n FROM designs WHERE status='pending' AND ip_hash=?`).get(ip).n >= 5) return bad(res, 'You already have 5 designs waiting for review', 429);

  // Optional holder tag: wallet signs a message naming the design title.
  let wallet = null, holderBalance = null;
  if (req.body?.wallet) {
    if (!s.launched) return bad(res, 'Holder tagging opens at launch. Submit without a wallet for now.');
    const check = verifySignedAction({ message: req.body.message, signature: req.body.signature, wallet: req.body.wallet,
      maxAgeMs: config.MESSAGE_MAX_AGE_MS, expected: { Action: 'submit-design', Mint: s.token_mint, Title: title } });
    if (!check.ok) return bad(res, check.error, 401);
    try { holderBalance = await getTokenBalance(req.body.wallet, s.token_mint); } catch { return bad(res, 'Could not read token balance from RPC', 502); }
    wallet = req.body.wallet;
  }

  let img;
  try { img = await processImage(req.file.buffer, { dir: DESIGN_DIR, maxBytes: config.MAX_UPLOAD_BYTES }); }
  catch (e) { return bad(res, e.message, 415); }
  db.prepare(`INSERT INTO designs (id, title, x_handle, wallet, holder_balance, image_url, thumb_url, mime, bytes, width, height, status, ip_hash)
    VALUES (?,?,?,?,?,?,?,?,?,?,?, 'pending', ?)`)
    .run(img.id, title, xHandle || null, wallet, holderBalance, `/uploads/designs/${img.file}`, `/uploads/designs/${img.thumb}`, img.mime, img.bytes, img.width, img.height, ip);
  res.json({ ok: true, id: img.id, url: `${baseUrl(req)}/design/${img.id}` });
}));

// ---------- admin API ----------
const admin = express.Router();
admin.use(requireAdmin);
admin.get('/check', (req, res) => res.json({ ok: true }));

admin.get('/settings', (req, res) => res.json({ values: S(), saved: settings.savedKeys() }));
admin.put('/settings', (req, res) => {
  const { values, errors } = validateSettings(req.body || {});
  if (Object.keys(errors).length) return res.status(400).json({ error: 'Some fields are invalid', errors });
  if ('token_mint' in values && values.token_mint !== (S().token_mint || null)) {
    if (db.prepare(`SELECT COUNT(*) n FROM votes v JOIN rounds r ON r.id=v.round_id WHERE r.status='open'`).get().n > 0 && !req.query.force)
      return bad(res, 'Open rounds already have votes weighted by the old mint. Close them first (or add ?force=1).', 409);
  }
  settings.save(values);
  res.json({ ok: true, values: S() });
});

// Generic admin image upload (mascot, billboard photos). Returns a URL to use in settings/billboards.
admin.post('/media', single('image'), wrap(async (req, res) => {
  try {
    const img = await processImage(req.file?.buffer, { dir: MEDIA_DIR, maxBytes: config.MAX_UPLOAD_BYTES, minDim: 64 });
    res.json({ ok: true, url: `/uploads/media/${img.file}`, thumb: `/uploads/media/${img.thumb}` });
  } catch (e) { bad(res, e.message, 415); }
}));

// Official design (goes straight into the gallery).
admin.post('/designs', single('image'), wrap(async (req, res) => {
  const title = str(req.body?.title, 80) || 'Official design';
  let img;
  try { img = await processImage(req.file?.buffer, { dir: DESIGN_DIR, maxBytes: config.MAX_UPLOAD_BYTES }); } catch (e) { return bad(res, e.message, 415); }
  db.prepare(`INSERT INTO designs (id, title, image_url, thumb_url, mime, bytes, width, height, status, official, reviewed_at)
    VALUES (?,?,?,?,?,?,?,?, 'approved', 1, datetime('now'))`)
    .run(img.id, title, `/uploads/designs/${img.file}`, `/uploads/designs/${img.thumb}`, img.mime, img.bytes, img.width, img.height);
  res.json({ ok: true, id: img.id });
}));
admin.get('/designs', (req, res) => res.json(db.prepare(`SELECT ${DESIGN_PUBLIC} FROM designs WHERE status != 'rejected' ORDER BY status='pending' DESC, created_at DESC`).all()));
admin.post('/designs/:id/:action(approve|reject|unofficial|official)', (req, res) => {
  const d = db.prepare('SELECT * FROM designs WHERE id=?').get(String(req.params.id));
  if (!d) return bad(res, 'Not found', 404);
  const a = req.params.action;
  if (a === 'approve') db.prepare(`UPDATE designs SET status='approved', reviewed_at=datetime('now') WHERE id=?`).run(d.id);
  else if (a === 'official' || a === 'unofficial') db.prepare('UPDATE designs SET official=? WHERE id=?').run(a === 'official' ? 1 : 0, d.id);
  else {
    if (db.prepare('SELECT 1 FROM candidates WHERE design_id=?').get(d.id)) return bad(res, 'Design is a vote candidate; remove it from the round first');
    db.prepare(`UPDATE designs SET status='rejected', reviewed_at=datetime('now') WHERE id=?`).run(d.id);
    if (d.image_url.startsWith('/uploads/designs/')) removeFiles(DESIGN_DIR, d.image_url.split('/').pop(), d.thumb_url.split('/').pop());
  }
  res.json({ ok: true });
});

admin.post('/billboards', (req, res) => {
  const b = req.body || {};
  const location = str(b.location), run_date = str(b.run_date, 20);
  if (!location || !/^\d{4}-\d{2}-\d{2}$/.test(run_date)) return bad(res, 'location and run_date (YYYY-MM-DD) required');
  const r = db.prepare(`INSERT INTO billboards (location, city, run_date, run_days, cost_usd, cost_sol, vendor, photo_url, proof_url, tx_sig, notes)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(location, str(b.city) || null, run_date, Number(b.run_days) || null,
    Number(b.cost_usd) || 0, Number(b.cost_sol) || 0, str(b.vendor) || null, safeUrl(b.photo_url), safeUrl(b.proof_url),
    str(b.tx_sig, 120) || null, str(b.notes, 500) || null);
  res.json({ ok: true, id: Number(r.lastInsertRowid) });
});
admin.delete('/billboards/:id', (req, res) => { db.prepare('DELETE FROM billboards WHERE id=?').run(Number(req.params.id)); res.json({ ok: true }); });

function parseCandidates(list) {
  // [{ name, description?, design_id? }] — design must exist and be approved
  const out = [];
  for (const c of Array.isArray(list) ? list : []) {
    const design_id = c?.design_id ? String(c.design_id) : null;
    let name = str(c?.name, 80);
    if (design_id) {
      const d = db.prepare(`SELECT title FROM designs WHERE id=? AND status='approved'`).get(design_id);
      if (!d) throw new Error(`Design ${design_id} is not approved`);
      if (!name) name = d.title;
    }
    if (name) out.push({ name, description: str(c?.description, 200) || null, design_id });
  }
  return out;
}
admin.post('/rounds', (req, res) => {
  const b = req.body || {};
  const title = str(b.title, 120);
  const ends = Date.parse(b.ends_at);
  const kind = ['location', 'design', 'pair'].includes(b.kind) ? b.kind : 'location';
  if (!title || !Number.isFinite(ends) || ends <= Date.now()) return bad(res, 'title and a future ends_at required');
  let cands;
  try { cands = parseCandidates(b.candidates); } catch (e) { return bad(res, e.message); }
  if (cands.length < 2) return bad(res, 'Add at least 2 candidates');
  const id = Number(db.prepare('INSERT INTO rounds (title, description, ends_at, allow_proposals, kind) VALUES (?,?,?,?,?)')
    .run(title, str(b.description, 500) || null, new Date(ends).toISOString(), b.allow_proposals === false ? 0 : 1, kind).lastInsertRowid);
  const ins = db.prepare(`INSERT INTO candidates (round_id, name, description, status, design_id) VALUES (?,?,?, 'approved', ?)`);
  for (const c of cands) ins.run(id, c.name, c.description, c.design_id);
  res.json({ ok: true, id });
});
admin.post('/rounds/:id/candidates', (req, res) => {
  let cands;
  try { cands = parseCandidates([req.body]); } catch (e) { return bad(res, e.message); }
  if (!cands.length) return bad(res, 'name or design_id required');
  const c = cands[0];
  db.prepare(`INSERT INTO candidates (round_id, name, description, status, design_id) VALUES (?,?,?,'approved',?)`).run(Number(req.params.id), c.name, c.description, c.design_id);
  res.json({ ok: true });
});
admin.post('/candidates/:id/:action(approve|reject)', (req, res) => {
  db.prepare('UPDATE candidates SET status=? WHERE id=?').run(req.params.action === 'approve' ? 'approved' : 'rejected', Number(req.params.id));
  res.json({ ok: true });
});
admin.post('/rounds/:id/close', wrap(async (req, res) => {
  const id = Number(req.params.id);
  const r = db.prepare('SELECT * FROM rounds WHERE id=?').get(id);
  if (!r) return bad(res, 'Round not found', 404);
  if (r.status === 'closed') return bad(res, 'Already closed');
  try { await finalizeRound(id); } catch (e) { return bad(res, e.message, 502); }
  res.json({ ok: true, results: roundResults(id) });
}));
admin.get('/rounds/:id/votes.csv', (req, res) => {
  const rows = db.prepare('SELECT wallet, candidate_id, weight_at_vote, final_weight, signed_at, signature, message FROM votes WHERE round_id=?').all(Number(req.params.id));
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  res.type('text/csv').send(['wallet,candidate_id,weight_at_vote,final_weight,signed_at,signature,message', ...rows.map((r) => Object.values(r).map(q).join(','))].join('\n'));
});
app.use('/api/admin', admin);
app.use('/api', (req, res) => bad(res, 'Not found', 404));

// ---------- static ----------
app.get('/vendor/nacl.min.js', (req, res) => res.sendFile(join(__dirname, '..', 'node_modules', 'tweetnacl', 'nacl-fast.min.js')));
app.use('/uploads', express.static(config.UPLOAD_DIR, {
  maxAge: '1h', index: false, dotfiles: 'deny',
  setHeaders: (res) => { res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox"); res.setHeader('X-Robots-Tag', 'noindex'); },
}));
app.use(express.static(PUBLIC_DIR, { maxAge: '5m', index: false }));

// HTML shell with per-page title / link-preview tags (so shared design links unfurl on X).
const TEMPLATE = readFileSync(join(PUBLIC_DIR, 'index.html'), 'utf8');
function renderShell(req, { title, description, image } = {}) {
  const s = S();
  const base = baseUrl(req);
  const abs = (u) => (u ? (u.startsWith('http') ? u : base + u) : '');
  const siteTitle = s.site_title || 'Billboard Fund';
  const theme = `:root{--primary:${s.theme_primary};--secondary:${s.theme_secondary};--accent:${s.theme_accent}}`;
  return TEMPLATE
    .replaceAll('__TITLE__', esc(title || siteTitle))
    .replaceAll('__DESC__', esc(description || s.tagline))
    .replaceAll('__OG_IMAGE__', esc(abs(image || s.mascot_url)))
    .replaceAll('__OG_URL__', esc(base + req.originalUrl.split('?')[0]))
    .replaceAll('__ICON__', esc(s.mascot_url || '/favicon.svg'))
    .replace('/*__THEME__*/', theme)
    .replace('__BODY_CLASS__', s.snow ? 'snow' : '');
}
app.get('/design/:id', (req, res) => {
  const d = db.prepare(`SELECT title, x_handle, thumb_url, status FROM designs WHERE id=? AND status != 'rejected'`).get(String(req.params.id));
  const s = S();
  res.type('html').send(renderShell(req, d ? {
    title: `${d.title} · billboard design${s.token_symbol ? ' for $' + s.token_symbol : ''}`,
    description: `${d.x_handle ? 'By @' + d.x_handle + '. ' : ''}${d.status === 'pending' ? 'Submitted for review.' : 'Approved design.'} Holders vote on which design goes on each billboard.`,
    image: d.thumb_url,
  } : {}));
});
app.get('*', (req, res) => res.type('html').send(renderShell(req)));

app.listen(config.PORT, () => {
  const s = S();
  console.log(`${s.site_title} on http://localhost:${config.PORT}  ${config.DEMO ? '[DEMO MODE - sample data]' : s.launched ? '[LIVE]' : '[PRE-LAUNCH: no TOKEN_MINT set]'}`);
  if (config.DEMO && config.ADMIN_TOKEN === 'demo-admin') console.log('Demo admin token: demo-admin');
  if (!config.ADMIN_TOKEN) console.warn('WARNING: ADMIN_TOKEN not set, admin disabled');
});
