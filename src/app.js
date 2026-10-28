import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import express from 'express';
import multer from 'multer';
import { openDatabase, stamp, iso } from './db.js';
import { SETTING_KEYS, readSettings, publicConfig, adminView } from './settings.js';
import { isSolanaAddress, verifySignature, parseSignedMessage, freshTimestamp } from './solana.js';
import { saveImage, removeUpload } from './media.js';
import { renderHtml } from './html.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');

function httpError(status, message, errors) {
  const err = new Error(message);
  err.status = status;
  if (errors) err.errors = errors;
  return err;
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    timingSafeEqual(left, left);
    return false;
  }
  return timingSafeEqual(left, right);
}

function num(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function cleanHandle(value) {
  return String(value || '').trim().replace(/^@/, '');
}

function isHandle(value) {
  return /^[A-Za-z0-9_]{1,15}$/.test(value);
}

function isHttpUrl(value) {
  return /^https?:\/\/\S+$/i.test(value);
}

function isColor(value) {
  return /^#[0-9a-fA-F]{6}$/.test(value);
}

function safeMediaUrl(value) {
  if (!value) return '';
  if (/^https?:\/\/\S+$/i.test(value)) return value;
  if (/^\/(uploads|examples)\//.test(value) || value === '/mascot.webp' || value.startsWith('/mascot.')) return value;
  return null;
}

export function createApp({
  env = process.env,
  dbPath,
  uploadDir,
  solana,
  market,
  publicDir = PUBLIC_DIR,
} = {}) {
  const dataDir = env.DATA_DIR || path.resolve(process.cwd(), 'data');
  const resolvedDb = dbPath || env.DATABASE_PATH || path.join(dataDir, 'site.db');
  const resolvedUploads = uploadDir || env.UPLOAD_DIR || path.join(dataDir, 'uploads');
  fs.mkdirSync(resolvedUploads, { recursive: true });
  const db = openDatabase(resolvedDb);
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self' https: data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });
  app.use(express.json({ limit: '1mb' }));

  const settingsOf = () => readSettings(db, env);
  const cfgOf = () => publicConfig(settingsOf());

  function originOf(req) {
    const settings = settingsOf();
    if (settings.publicUrl) return settings.publicUrl;
    return `${req.protocol}://${req.get('host')}`;
  }

  function requireAdmin(req, _res, next) {
    const token = req.get('x-admin-token') || '';
    const expected = env.ADMIN_TOKEN || '';
    const demoOk = settingsOf().demo && token === 'demo-admin';
    if ((expected && safeEqual(token, expected)) || demoOk) return next();
    next(httpError(401, 'Unauthorized'));
  }

  const upload = () => multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: settingsOf().maxUploadMb * 1024 * 1024 },
  }).single('image');

  function designRow(row, { full = false } = {}) {
    if (!row) return null;
    const base = {
      id: row.id,
      title: row.title,
      x_handle: row.x_handle || '',
      wallet: row.wallet || null,
      image_url: row.image_url,
      thumb_url: row.thumb_url,
      official: Boolean(row.official),
      status: row.status,
      width: row.width,
      height: row.height,
      created_at: row.created_at,
    };
    if (full) base.holder_balance = row.holder_balance;
    return base;
  }

  function spent() {
    const row = db.prepare('SELECT COUNT(*) AS count, COALESCE(SUM(cost_sol), 0) AS sol, COALESCE(SUM(cost_usd), 0) AS usd FROM billboards').get();
    return { count: Number(row.count), sol: Number(row.sol), usd: Number(row.usd) };
  }

  function roundBundle(id) {
    const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(id);
    if (!round) return null;
    const approved = db.prepare(`
      SELECT c.*, d.title AS design_title, d.x_handle AS design_by, d.thumb_url AS design_thumb
      FROM candidates c
      LEFT JOIN designs d ON d.id = c.design_id
      WHERE c.round_id = ? AND c.status = 'approved'
      ORDER BY c.sort_order, c.id
    `).all(id);
    const pending = db.prepare(`
      SELECT id, name, proposed_by FROM candidates
      WHERE round_id = ? AND status = 'pending' ORDER BY id
    `).all(id);
    const voteRows = db.prepare('SELECT candidate_id, weight, valid FROM votes WHERE round_id = ?').all(id);
    const byCand = new Map();
    for (const vote of voteRows) {
      const slot = byCand.get(vote.candidate_id) || { weight: 0, votes: 0, valid_votes: 0 };
      slot.votes += 1;
      if (vote.valid && vote.weight > 0) {
        slot.weight += vote.weight;
        slot.valid_votes += 1;
      }
      byCand.set(vote.candidate_id, slot);
    }
    let totalWeight = 0;
    let totalVotes = 0;
    const candidates = approved.map((c) => {
      const slot = byCand.get(c.id) || { weight: 0, votes: 0, valid_votes: 0 };
      totalWeight += slot.weight;
      totalVotes += slot.valid_votes;
      return {
        id: c.id,
        name: c.name,
        description: c.description || '',
        design_id: c.design_id || null,
        design_title: c.design_title || null,
        design_by: c.design_by || null,
        design_thumb: c.design_thumb || null,
        weight: slot.weight,
        votes: slot.votes,
        valid_votes: slot.valid_votes,
      };
    }).sort((a, b) => b.weight - a.weight || a.id - b.id);
    const open = round.status === 'open' && Date.parse(round.ends_at) > Date.now();
    return {
      round: {
        id: round.id,
        title: round.title,
        description: round.description || '',
        kind: round.kind,
        status: round.status,
        open,
        ends_at: round.ends_at,
        allow_proposals: Boolean(round.allow_proposals),
      },
      candidates,
      totals: { weight: totalWeight, votes: totalVotes },
      pending: pending.map((p) => ({ id: p.id, name: p.name, proposed_by: p.proposed_by })),
    };
  }

  async function holderBalance(wallet) {
    const settings = settingsOf();
    if (!settings.launched) return { balance: 0, eligible: false };
    const balance = await solana.getTokenBalance(wallet, settings.tokenMint);
    return { balance, eligible: balance >= settings.minHolding };
  }

  function checkSigned(body, cfg, action, extra) {
    const fields = parseSignedMessage(body.message, cfg);
    if (!fields) throw httpError(400, 'That signature message does not match this site.');
    if (fields.Action !== action) throw httpError(400, 'Wrong signature action.');
    if (fields.Wallet !== body.wallet) throw httpError(400, 'Signature wallet does not match.');
    if (fields.Mint !== (cfg.tokenMint || '')) throw httpError(400, 'Signature is for a different token.');
    if (!freshTimestamp(fields.Timestamp)) throw httpError(400, 'Signature is too old. Sign again.');
    for (const [key, value] of Object.entries(extra)) {
      if (String(fields[key]) !== String(value)) throw httpError(400, `Signature ${key.toLowerCase()} does not match.`);
    }
    if (!verifySignature(body.message, body.signature, body.wallet)) throw httpError(400, 'Bad signature.');
    return fields;
  }

  async function buildDashboard() {
    const settings = settingsOf();
    const cfg = publicConfig(settings);
    const out = {
      demo: cfg.demo,
      launched: cfg.launched,
      rewardsWalletSet: Boolean(settings.rewardsWallet),
      rewardsWallet: settings.rewardsWallet || null,
      balanceSol: null,
      balanceUsd: null,
      availableSol: null,
      availableUsd: null,
      reserveSol: settings.reserveSol,
      solUsd: null,
      priceSource: null,
      spent: spent(),
      totalFundedSol: null,
      nextTargetUsd: settings.nextTargetUsd,
      balanceError: null,
      mint: null,
      mintError: null,
      market: null,
      updatedAt: iso(),
    };
    if (market) {
      try {
        out.solUsd = await market.getSolUsd();
        out.priceSource = 'coingecko';
      } catch {
        out.solUsd = null;
      }
    }
    if (settings.launched && solana) {
      try {
        const info = await solana.getMintInfo(settings.tokenMint);
        if (!info) out.mintError = 'Mint account not found';
        else out.mint = { supply: info.supply, program: info.program, mintAuthority: info.mintAuthority };
      } catch (err) {
        out.mintError = err.message || 'Could not read mint';
      }
      if (market) {
        try { out.market = await market.getMarket(settings.tokenMint); } catch { out.market = null; }
      }
    }
    if (settings.rewardsWallet && solana) {
      try {
        const balanceSol = await solana.getSolBalance(settings.rewardsWallet);
        out.balanceSol = balanceSol;
        out.balanceUsd = out.solUsd == null ? null : balanceSol * out.solUsd;
        const available = Math.max(0, balanceSol - settings.reserveSol);
        out.availableSol = available;
        out.availableUsd = out.solUsd == null ? null : available * out.solUsd;
        out.totalFundedSol = balanceSol + out.spent.sol;
      } catch (err) {
        out.balanceError = err.message || 'RPC error';
      }
    }
    return out;
  }

  function normalizeCandidates(kind, raw) {
    if (!Array.isArray(raw) || raw.length < 2) {
      throw httpError(400, 'Add at least two options', { candidates: 'Add at least two options' });
    }
    return raw.map((item, index) => {
      const designId = item?.design_id || null;
      let name = String(item?.name || '').trim();
      let design = null;
      if (designId) {
        design = db.prepare(`SELECT * FROM designs WHERE id = ? AND status = 'approved'`).get(designId);
        if (!design) throw httpError(400, 'Each design must be an approved design', { candidates: 'Unknown or unapproved design' });
      }
      if (kind === 'location' && !name) throw httpError(400, 'Location rounds need a name on every option');
      if (kind === 'design' && !design) throw httpError(400, 'Design rounds need a design on every option');
      if (kind === 'pair' && (!name || !design)) throw httpError(400, 'Pair rounds need a location and a design on every option');
      if (!name) name = design.title;
      if (name.length > 80) throw httpError(400, 'Option names must be 80 characters or less');
      return { name, design_id: design ? design.id : null, description: String(item?.description || '').slice(0, 240), sort_order: index };
    });
  }

  const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  app.get('/api/config', (_req, res) => {
    res.json(cfgOf());
  });

  app.get('/api/dashboard', wrap(async (_req, res) => {
    res.json(await buildDashboard());
  }));

  app.get('/api/designs', (_req, res) => {
    const rows = db.prepare(`SELECT * FROM designs WHERE status = 'approved' ORDER BY official DESC, created_at DESC`).all();
    res.json(rows.map((row) => designRow(row)));
  });

  app.get('/api/designs/:id', (req, res) => {
    const row = db.prepare('SELECT * FROM designs WHERE id = ? AND status != ?').get(req.params.id, 'rejected');
    if (!row) return res.status(404).json({ error: 'Design not found' });
    res.json(designRow(row, { full: true }));
  });

  app.post('/api/designs', (req, res, next) => {
    upload()(req, res, (err) => {
      if (err) return next(err);
      wrap(async () => {
        const settings = settingsOf();
        const cfg = publicConfig(settings);
        const title = String(req.body?.title || '').trim();
        if (!title || title.length > 80) throw httpError(400, 'Title is required (80 characters max)');
        const handle = cleanHandle(req.body?.x_handle);
        if (handle && !isHandle(handle)) throw httpError(400, 'X handle should be letters, numbers, or underscore');
        if (!req.file) throw httpError(400, 'Image is required');
        let wallet = null;
        let holderBalance = null;
        if (req.body?.wallet || req.body?.signature) {
          if (!settings.launched) throw httpError(400, 'Holder badges open at launch');
          if (!isSolanaAddress(req.body.wallet)) throw httpError(400, 'Wallet address is not valid');
          checkSigned(req.body, cfg, 'submit-design', { Title: title });
          const held = await holderBalance(req.body.wallet);
          if (!held.eligible) throw httpError(400, 'Your wallet holds less than the minimum');
          wallet = req.body.wallet;
          holderBalance = held.balance;
        }
        const saved = await saveImage(req.file.buffer, resolvedUploads, req.file.mimetype);
        db.prepare(`INSERT INTO designs (id, title, x_handle, wallet, image_url, thumb_url, width, height, status, official, holder_balance, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`).run(
          saved.id, title, handle, wallet, saved.image_url, saved.thumb_url, saved.width, saved.height, holderBalance, stamp(),
        );
        res.status(201).json({ id: saved.id });
      })(req, res, next);
    });
  });

  app.get('/api/billboards', (_req, res) => {
    const rows = db.prepare('SELECT * FROM billboards ORDER BY run_date DESC, id DESC').all();
    res.json(rows);
  });

  app.get('/api/holder/:wallet', wrap(async (req, res) => {
    if (!isSolanaAddress(req.params.wallet)) throw httpError(400, 'Wallet address is not valid');
    res.json(await holderBalance(req.params.wallet));
  }));

  app.get('/api/rounds', (_req, res) => {
    const ids = db.prepare('SELECT id FROM rounds ORDER BY ends_at DESC, id DESC').all();
    res.json(ids.map((row) => roundBundle(row.id)));
  });

  app.get('/api/rounds/:id', (req, res) => {
    const bundle = roundBundle(Number(req.params.id));
    if (!bundle) return res.status(404).json({ error: 'Round not found' });
    res.json(bundle);
  });

  app.get('/api/rounds/:id/audit', (req, res) => {
    const round = db.prepare('SELECT id FROM rounds WHERE id = ?').get(Number(req.params.id));
    if (!round) return res.status(404).json({ error: 'Round not found' });
    const rows = db.prepare(`
      SELECT v.wallet, v.candidate_id, c.name AS candidate, v.message, v.signature,
             v.balance_at_vote, v.weight, v.valid, v.created_at, v.updated_at
      FROM votes v JOIN candidates c ON c.id = v.candidate_id
      WHERE v.round_id = ? ORDER BY v.updated_at
    `).all(round.id);
    res.json(rows.map((row) => ({
      wallet: row.wallet,
      candidateId: row.candidate_id,
      candidate: row.candidate,
      message: row.message,
      signature: row.signature,
      balanceAtVote: row.balance_at_vote,
      weight: row.weight,
      valid: Boolean(row.valid),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })));
  });

  app.get('/api/rounds/:id/vote/:wallet', (req, res) => {
    if (!isSolanaAddress(req.params.wallet)) return res.status(400).json({ error: 'Wallet address is not valid' });
    const vote = db.prepare('SELECT candidate_id FROM votes WHERE round_id = ? AND wallet = ?').get(Number(req.params.id), req.params.wallet);
    if (!vote) return res.status(404).json({ error: 'No vote' });
    res.json({ candidate_id: vote.candidate_id });
  });

  app.post('/api/rounds/:id/vote', wrap(async (req, res) => {
    const settings = settingsOf();
    const cfg = publicConfig(settings);
    if (!settings.launched) throw httpError(400, 'Holder voting opens at launch');
    const roundId = Number(req.params.id);
    const bundle = roundBundle(roundId);
    if (!bundle) throw httpError(404, 'Round not found');
    if (!bundle.round.open) throw httpError(400, 'This round is closed');
    const { wallet, candidateId, message, signature } = req.body || {};
    if (!isSolanaAddress(wallet)) throw httpError(400, 'Wallet address is not valid');
    const candidate = bundle.candidates.find((c) => c.id === Number(candidateId));
    if (!candidate) throw httpError(400, 'That option is not in this round');
    checkSigned(req.body || { wallet, message, signature }, cfg, 'vote', { Round: roundId, Candidate: Number(candidateId) });
    const held = await holderBalance(wallet);
    if (!held.eligible) throw httpError(400, 'Your wallet holds less than the minimum');
    const existing = db.prepare('SELECT id, candidate_id FROM votes WHERE round_id = ? AND wallet = ?').get(roundId, wallet);
    const now = stamp();
    if (existing) {
      db.prepare(`UPDATE votes SET candidate_id = ?, message = ?, signature = ?, balance_at_vote = ?, weight = ?, valid = 1, updated_at = ? WHERE id = ?`)
        .run(candidate.id, message, signature, held.balance, held.balance, now, existing.id);
    } else {
      db.prepare(`INSERT INTO votes (round_id, wallet, candidate_id, message, signature, balance_at_vote, weight, valid, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`).run(roundId, wallet, candidate.id, message, signature, held.balance, held.balance, now, now);
    }
    res.json({
      changed: Boolean(existing && existing.candidate_id !== candidate.id),
      weight: held.balance,
      results: roundBundle(roundId),
    });
  }));

  app.post('/api/rounds/:id/propose', wrap(async (req, res) => {
    const settings = settingsOf();
    const cfg = publicConfig(settings);
    if (!settings.launched) throw httpError(400, 'Holder voting opens at launch');
    const roundId = Number(req.params.id);
    const bundle = roundBundle(roundId);
    if (!bundle) throw httpError(404, 'Round not found');
    if (!bundle.round.open || !bundle.round.allow_proposals) throw httpError(400, 'This round is not taking location ideas');
    const name = String(req.body?.name || '').trim();
    if (!name || name.length > 80) throw httpError(400, 'Type a location (80 characters max)');
    if (!isSolanaAddress(req.body?.wallet)) throw httpError(400, 'Wallet address is not valid');
    checkSigned(req.body, cfg, 'propose', { Round: roundId, Location: name });
    const held = await holderBalance(req.body.wallet);
    if (!held.eligible) throw httpError(400, 'Your wallet holds less than the minimum');
    const dup = db.prepare(`SELECT id FROM candidates WHERE round_id = ? AND lower(name) = lower(?) AND status != 'rejected'`).get(roundId, name);
    if (dup) throw httpError(400, 'That location is already on the list');
    const order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM candidates WHERE round_id = ?').get(roundId).n;
    const info = db.prepare(`INSERT INTO candidates (round_id, name, status, proposed_by, proposal_message, proposal_signature, sort_order)
      VALUES (?, ?, 'pending', ?, ?, ?, ?)`).run(roundId, name, req.body.wallet, req.body.message, req.body.signature, order);
    res.status(201).json({ id: Number(info.lastInsertRowid) });
  }));

  const admin = express.Router();
  admin.use(requireAdmin);

  admin.get('/check', (_req, res) => res.json({ ok: true }));

  admin.get('/settings', (_req, res) => res.json(adminView(settingsOf())));

  admin.put('/settings', wrap(async (req, res) => {
    const body = req.body || {};
    const current = settingsOf();
    const errors = {};
    const next = {};
    for (const key of SETTING_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue;
      next[key] = body[key] === null || body[key] === undefined ? '' : String(body[key]).trim();
    }
    if (next.token_mint) {
      if (!isSolanaAddress(next.token_mint)) errors.token_mint = 'Not a valid Solana address';
    }
    if (next.rewards_wallet) {
      if (!isSolanaAddress(next.rewards_wallet)) errors.rewards_wallet = 'Not a valid Solana address';
    }
    for (const key of ['website_url', 'x_url', 'tiktok_url', 'telegram_url', 'dexscreener_url']) {
      if (next[key] && !isHttpUrl(next[key])) errors[key] = 'Use a full http(s) URL';
    }
    for (const key of ['theme_primary', 'theme_secondary', 'theme_accent']) {
      if (next[key] && !isColor(next[key])) errors[key] = 'Use a color like #d0122d';
    }
    if (next.review_x_handle !== undefined && next.review_x_handle && !isHandle(next.review_x_handle)) {
      errors.review_x_handle = 'Letters, numbers, or underscore, up to 15 characters';
    }
    if (next.mascot_url !== undefined && next.mascot_url && safeMediaUrl(next.mascot_url) == null) {
      errors.mascot_url = 'Use an uploaded image or an https URL';
    }
    if (next.min_holding !== undefined && next.min_holding !== '' && !(Number(next.min_holding) >= 0)) errors.min_holding = 'Enter a number';
    if (next.reserve_sol !== undefined && next.reserve_sol !== '' && !(Number(next.reserve_sol) >= 0)) errors.reserve_sol = 'Enter a number';
    if (next.next_billboard_target_usd !== undefined && next.next_billboard_target_usd !== '' && !(Number(next.next_billboard_target_usd) >= 0)) {
      errors.next_billboard_target_usd = 'Enter a number';
    }
    if (next.snow !== undefined && next.snow !== '' && !['true', 'false', '1', '0'].includes(next.snow)) errors.snow = 'Choose on or off';
    if (Object.keys(errors).length) throw httpError(400, 'Check the highlighted fields.', errors);

    const mintChanging = Object.prototype.hasOwnProperty.call(next, 'token_mint') && next.token_mint !== current.tokenMint;
    const voteCount = db.prepare('SELECT COUNT(*) AS n FROM votes').get().n;
    if (mintChanging && voteCount > 0 && req.query.force !== '1') {
      throw httpError(409, 'Changing the token mint affects existing votes. Resend with force=1 to confirm.');
    }
    if (next.token_mint && solana && req.query.force !== '1') {
      try {
        const info = await solana.getMintInfo(next.token_mint);
        if (!info) throw httpError(409, 'That address is not a token mint on Solana. Resend with force=1 to save it anyway.');
      } catch (err) {
        if (err.status) throw err;
      }
    }
    const upsert = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
    const del = db.prepare('DELETE FROM settings WHERE key = ?');
    db.exec('BEGIN');
    try {
      for (const [key, value] of Object.entries(next)) {
        if (value === '') del.run(key);
        else upsert.run(key, value);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json(adminView(settingsOf()));
  }));

  admin.post('/media', (req, res, next) => {
    upload()(req, res, (err) => {
      if (err) return next(err);
      wrap(async () => {
        if (!req.file) throw httpError(400, 'Image is required');
        const saved = await saveImage(req.file.buffer, resolvedUploads, req.file.mimetype);
        res.status(201).json({ url: saved.image_url, thumb_url: saved.thumb_url });
      })(req, res, next);
    });
  });

  admin.get('/designs', (_req, res) => {
    const rows = db.prepare(`SELECT * FROM designs ORDER BY created_at DESC`).all();
    res.json(rows.map((row) => designRow(row, { full: true })));
  });

  admin.post('/designs', (req, res, next) => {
    upload()(req, res, (err) => {
      if (err) return next(err);
      wrap(async () => {
        const title = String(req.body?.title || '').trim();
        if (!title) throw httpError(400, 'Title is required');
        if (!req.file) throw httpError(400, 'Image is required');
        const saved = await saveImage(req.file.buffer, resolvedUploads, req.file.mimetype);
        db.prepare(`INSERT INTO designs (id, title, x_handle, wallet, image_url, thumb_url, width, height, status, official, holder_balance, created_at)
          VALUES (?, ?, '', NULL, ?, ?, ?, ?, 'approved', 1, NULL, ?)`).run(
          saved.id, title.slice(0, 80), saved.image_url, saved.thumb_url, saved.width, saved.height, stamp(),
        );
        res.status(201).json({ id: saved.id });
      })(req, res, next);
    });
  });

  admin.post('/designs/:id/:action', (req, res) => {
    const row = db.prepare('SELECT * FROM designs WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Design not found' });
    const action = req.params.action;
    if (action === 'approve') {
      db.prepare(`UPDATE designs SET status = 'approved' WHERE id = ?`).run(row.id);
    } else if (action === 'reject') {
      const used = db.prepare(`SELECT id FROM candidates WHERE design_id = ? AND status != 'rejected'`).get(row.id);
      if (used) return res.status(400).json({ error: 'This design is on a vote. Remove it from the round first.' });
      removeUpload(resolvedUploads, row.image_url);
      removeUpload(resolvedUploads, row.thumb_url);
      db.prepare('DELETE FROM designs WHERE id = ?').run(row.id);
    } else if (action === 'official') {
      if (row.status !== 'approved') return res.status(400).json({ error: 'Approve the design first' });
      db.prepare('UPDATE designs SET official = 1 WHERE id = ?').run(row.id);
    } else if (action === 'unofficial') {
      db.prepare('UPDATE designs SET official = 0 WHERE id = ?').run(row.id);
    } else {
      return res.status(404).json({ error: 'Not found' });
    }
    res.json({ ok: true });
  });

  admin.post('/rounds', wrap(async (req, res) => {
    const title = String(req.body?.title || '').trim();
    const kind = String(req.body?.kind || 'location');
    const description = String(req.body?.description || '').trim().slice(0, 300);
    const ends = req.body?.ends_at;
    const errors = {};
    if (!title || title.length > 120) errors.title = 'Title is required';
    if (!['location', 'design', 'pair'].includes(kind)) errors.kind = 'Unknown round type';
    if (!ends || Number.isNaN(Date.parse(ends))) errors.ends_at = 'End time is required';
    if (Object.keys(errors).length) throw httpError(400, 'Check the highlighted fields.', errors);
    const candidates = normalizeCandidates(kind, req.body?.candidates);
    const allow = req.body?.allow_proposals ? 1 : 0;
    db.exec('BEGIN');
    try {
      const info = db.prepare(`INSERT INTO rounds (title, description, kind, status, ends_at, allow_proposals, created_at)
        VALUES (?, ?, ?, 'open', ?, ?, ?)`).run(title, description, kind, new Date(ends).toISOString(), allow, stamp());
      const id = Number(info.lastInsertRowid);
      const insert = db.prepare(`INSERT INTO candidates (round_id, name, description, design_id, status, sort_order) VALUES (?, ?, ?, ?, 'approved', ?)`);
      for (const cand of candidates) insert.run(id, cand.name, cand.description, cand.design_id, cand.sort_order);
      db.exec('COMMIT');
      res.status(201).json(roundBundle(id));
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }));

  admin.post('/rounds/:id/close', wrap(async (req, res) => {
    const roundId = Number(req.params.id);
    const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(roundId);
    if (!round) throw httpError(404, 'Round not found');
    if (round.status !== 'open') throw httpError(400, 'Round is already closed');
    const settings = settingsOf();
    const votes = db.prepare('SELECT * FROM votes WHERE round_id = ?').all(roundId);
    const weighed = [];
    for (const vote of votes) {
      let nowBal = vote.balance_at_vote;
      if (settings.launched && solana) nowBal = await solana.getTokenBalance(vote.wallet, settings.tokenMint);
      let weight = Math.min(vote.balance_at_vote, nowBal);
      let valid = 1;
      if (weight < settings.minHolding) {
        weight = 0;
        valid = 0;
      }
      weighed.push({ id: vote.id, weight, valid });
    }
    const update = db.prepare('UPDATE votes SET weight = ?, valid = ?, updated_at = ? WHERE id = ?');
    const now = stamp();
    db.exec('BEGIN');
    try {
      for (const vote of weighed) update.run(vote.weight, vote.valid, now, vote.id);
      db.prepare(`UPDATE rounds SET status = 'closed', closed_at = ? WHERE id = ?`).run(iso(), roundId);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    res.json(roundBundle(roundId));
  }));

  admin.post('/rounds/:id/candidates', (req, res) => {
    const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(Number(req.params.id));
    if (!round) return res.status(404).json({ error: 'Round not found' });
    if (round.status !== 'open') return res.status(400).json({ error: 'Round is closed' });
    try {
      const designId = req.body?.design_id || null;
      let name = String(req.body?.name || '').trim();
      let design = null;
      if (designId) {
        design = db.prepare(`SELECT * FROM designs WHERE id = ? AND status = 'approved'`).get(designId);
        if (!design) return res.status(400).json({ error: 'Unknown or unapproved design' });
      }
      if (round.kind === 'location' && !name) return res.status(400).json({ error: 'Location name is required' });
      if (round.kind === 'design' && !design) return res.status(400).json({ error: 'Design rounds need a design' });
      if (round.kind === 'pair' && (!name || !design)) return res.status(400).json({ error: 'Pair options need a location and a design' });
      if (!name) name = design.title;
      const order = db.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 AS n FROM candidates WHERE round_id = ?').get(round.id).n;
      const info = db.prepare(`INSERT INTO candidates (round_id, name, design_id, status, sort_order) VALUES (?, ?, ?, 'approved', ?)`).run(round.id, name, design ? design.id : null, order);
      res.status(201).json({ id: Number(info.lastInsertRowid), results: roundBundle(round.id) });
    } catch (err) {
      res.status(err.status || 500).json({ error: err.message });
    }
  });

  admin.get('/rounds/:id/votes.csv', (req, res) => {
    const round = db.prepare('SELECT * FROM rounds WHERE id = ?').get(Number(req.params.id));
    if (!round) return res.status(404).json({ error: 'Round not found' });
    const rows = db.prepare(`
      SELECT v.wallet, v.candidate_id, c.name AS candidate, v.weight, v.balance_at_vote, v.valid, v.signature, v.message, v.created_at
      FROM votes v JOIN candidates c ON c.id = v.candidate_id
      WHERE v.round_id = ? ORDER BY v.created_at
    `).all(round.id);
    const header = ['wallet', 'candidate_id', 'candidate', 'weight', 'balance_at_vote', 'valid', 'signature', 'message', 'voted_at'];
    const csv = [header.join(',')].concat(rows.map((row) => header.map((key) => {
      const value = row[key] ?? '';
      return `"${String(value).replace(/"/g, '""')}"`;
    }).join(','))).join('\n');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="round-${round.id}-votes.csv"`);
    res.send(csv + '\n');
  });

  admin.post('/candidates/:id/approve', (req, res) => {
    const cand = db.prepare('SELECT * FROM candidates WHERE id = ?').get(Number(req.params.id));
    if (!cand) return res.status(404).json({ error: 'Not found' });
    db.prepare(`UPDATE candidates SET status = 'approved' WHERE id = ?`).run(cand.id);
    res.json(roundBundle(cand.round_id));
  });

  admin.post('/candidates/:id/reject', (req, res) => {
    const cand = db.prepare('SELECT * FROM candidates WHERE id = ?').get(Number(req.params.id));
    if (!cand) return res.status(404).json({ error: 'Not found' });
    const votes = db.prepare('SELECT COUNT(*) AS n FROM votes WHERE candidate_id = ?').get(cand.id).n;
    if (votes) return res.status(400).json({ error: 'This option already has votes' });
    db.prepare(`UPDATE candidates SET status = 'rejected' WHERE id = ?`).run(cand.id);
    res.json(roundBundle(cand.round_id));
  });

  admin.post('/billboards', (req, res) => {
    const body = req.body || {};
    const location = String(body.location || '').trim();
    const runDate = String(body.run_date || '').trim();
    if (!location) return res.status(400).json({ error: 'Location is required', errors: { location: 'Location is required' } });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(runDate)) return res.status(400).json({ error: 'Run date is required', errors: { run_date: 'Use a date' } });
    const costUsd = num(body.cost_usd, 0);
    const costSol = num(body.cost_sol, 0);
    if (Number.isNaN(costUsd) || Number.isNaN(costSol)) return res.status(400).json({ error: 'Costs must be numbers' });
    const photo = body.photo_url ? safeMediaUrl(String(body.photo_url).trim()) : '';
    if (body.photo_url && photo == null) return res.status(400).json({ error: 'Photo must be an uploaded image or https URL' });
    const proof = body.proof_url ? String(body.proof_url).trim() : '';
    if (proof && !isHttpUrl(proof)) return res.status(400).json({ error: 'Proof must be an https URL' });
    const runDays = body.run_days === undefined || body.run_days === '' ? null : Number(body.run_days);
    const info = db.prepare(`INSERT INTO billboards (location, city, run_date, run_days, vendor, cost_usd, cost_sol, notes, photo_url, proof_url, tx_sig, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      location.slice(0, 120),
      String(body.city || '').trim().slice(0, 80),
      runDate,
      Number.isFinite(runDays) ? runDays : null,
      String(body.vendor || '').trim().slice(0, 80),
      costUsd,
      costSol,
      String(body.notes || '').trim().slice(0, 500),
      photo || '',
      proof,
      String(body.tx_sig || '').trim().slice(0, 128),
      stamp(),
    );
    const row = db.prepare('SELECT * FROM billboards WHERE id = ?').get(Number(info.lastInsertRowid));
    res.status(201).json(row);
  });

  admin.delete('/billboards/:id', (req, res) => {
    const info = db.prepare('DELETE FROM billboards WHERE id = ?').run(Number(req.params.id));
    if (!info.changes) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  });

  app.use('/api/admin', admin);
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

  app.use('/uploads', express.static(resolvedUploads, { maxAge: '1h', fallthrough: false }));
  app.use(express.static(publicDir, { maxAge: '5m' }));
  app.get('*', (req, res) => {
    const cfg = cfgOf();
    res.type('html').send(renderHtml(cfg, { origin: originOf(req), path: req.path }));
  });

  app.use((err, _req, res, _next) => {
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? `Max ${settingsOf().maxUploadMb} MB` : err.message;
      return res.status(400).json({ error: message });
    }
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    const body = { error: status >= 500 ? 'Something went wrong' : err.message };
    if (err.errors) body.errors = err.errors;
    res.status(status).json(body);
  });

  return {
    app,
    db,
    uploadDir: resolvedUploads,
    close() {
      try { db.close(); } catch { /* already closed */ }
    },
  };
}
