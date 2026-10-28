import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import nacl from 'tweetnacl';
import { createApp } from '../src/app.js';
import { b58decode, b58encode, verifySignature } from '../src/solana.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const OLD_MINT = 'HXxJdaQbrYRvwTAM8M8mUPyoRPvmyuUbPFBRkiAAMASS';
const OLD_PAIR = '6qirp44q2t8b1cfbgmnqexcldqhfqmncfaffpkg4n156';

function wallet() {
  const kp = nacl.sign.keyPair();
  return { publicKey: b58encode(kp.publicKey), secretKey: kp.secretKey };
}

function sign(holder, message) {
  return Buffer.from(nacl.sign.detached(new TextEncoder().encode(message), holder.secretKey)).toString('base64');
}

function build(cfg, fields) {
  return [
    cfg.message.header,
    ...Object.entries(fields).map(([k, v]) => `${k}: ${String(v).replace(/[\r\n]+/g, ' ')}`),
    cfg.message.footer,
  ].join('\n');
}

function fakeSolana({ balances = {}, sol = {}, missing = [] } = {}) {
  return {
    async getSolBalance(addr) { return sol[addr] ?? 3.25; },
    async getTokenBalance(owner) { return Object.prototype.hasOwnProperty.call(balances, owner) ? balances[owner] : 250000; },
    async getMintInfo(mint) {
      if (missing.includes(mint)) return null;
      return { supply: 1_000_000_000, decimals: 6, program: 'spl-token', mintAuthority: null };
    },
  };
}

const market = {
  async getSolUsd() { return 100; },
  async getMarket() { return { priceUsd: 0.002, marketCap: 2_000_000, liquidityUsd: 80_000, change24h: 4 }; },
};

async function start(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ansemmas-'));
  const created = createApp({
    env: opts.env ?? {},
    dbPath: ':memory:',
    uploadDir: dir,
    solana: opts.solana ?? fakeSolana(),
    market: opts.market ?? market,
  });
  const server = created.app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    async stop() {
      await new Promise((resolve) => server.close(resolve));
      created.close();
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function json(url, opts) {
  const res = await fetch(url, opts);
  const data = await res.json();
  return { res, data };
}

function adminHeaders(extra = {}) {
  return { 'content-type': 'application/json', 'x-admin-token': 'test-admin', ...extra };
}

test('base58 round-trip and signature check', () => {
  const zeros = new Uint8Array(32);
  assert.equal(b58encode(zeros), '1'.repeat(32));
  assert.equal(b58decode('1'.repeat(32)).length, 32);
  const holder = wallet();
  const message = 'Merry Ansemmas - holder signature\nAction: vote\nMint: abc';
  const signature = sign(holder, message);
  assert.equal(verifySignature(message, signature, holder.publicKey), true);
  assert.equal(verifySignature(message + ' ', signature, holder.publicKey), false);
  assert.equal(b58decode(OLD_MINT)?.length, 32);
});

test('defaults stay in coming-soon mode without the old mint', async () => {
  const app = await start();
  try {
    const { data } = await json(app.base + '/api/config');
    assert.equal(data.launched, false);
    assert.equal(data.coinName, 'Ansemmas');
    assert.equal(data.tokenSymbol, 'ANSEMMAS');
    assert.equal(data.tokenMint, null);
    assert.equal(data.rewardsWallet, null);
    assert.equal(data.siteTitle, 'Merry Ansemmas');
    assert.match(data.tagline, /Merry Ansemmas/);
    assert.equal(data.links.website, 'https://ansemmas.fun');
    assert.equal(data.links.x, 'https://x.com/Ansemmas');
    assert.equal(data.links.tiktok, 'https://www.tiktok.com/@ansemmas');
    assert.equal(data.links.dexscreener, '');
    assert.equal(data.reviewXHandle, 'RiseofMemes');
    assert.equal(data.mascotUrl, '/mascot.webp');
    assert.equal(data.theme.snow, true);
    assert.equal(data.theme.primary, '#d0122d');
    assert.equal(data.theme.secondary, '#146b3a');
    assert.equal(data.theme.accent, '#f0c14a');
    assert.equal(data.adminEnabled, false);
    assert.equal(JSON.stringify(data).includes(OLD_MINT), false);
    assert.equal(JSON.stringify(data).includes(OLD_PAIR), false);

    const html = await (await fetch(app.base + '/')).text();
    assert.match(html, /<title>Merry Ansemmas<\/title>/);
    assert.match(html, /class="snow"/);
    assert.match(html, /og\.jpg/);
    assert.match(html, /--primary:#d0122d/);
    assert.equal(html.includes(OLD_MINT), false);
    assert.equal(html.includes(OLD_PAIR), false);

    const dash = await json(app.base + '/api/dashboard');
    assert.equal(dash.data.launched, false);
    assert.equal(dash.data.rewardsWalletSet, false);
    assert.equal(dash.data.balanceSol, null);
    assert.equal(dash.data.mint, null);
    assert.deepEqual(dash.data.spent, { count: 0, sol: 0, usd: 0 });
    assert.equal(dash.data.solUsd, 100);

    const mascot = await fetch(app.base + '/mascot.webp');
    assert.equal(mascot.status, 200);
    assert.match(mascot.headers.get('content-type'), /image/);
  } finally {
    await app.stop();
  }
});

test('admin can launch later and clearing the mint returns to coming soon', async () => {
  const mint = wallet().publicKey;
  const rewards = wallet().publicKey;
  const app = await start({ env: { ADMIN_TOKEN: 'test-admin', COIN_NAME: 'FromEnv' } });
  try {
    const locked = await json(app.base + '/api/admin/settings');
    assert.equal(locked.res.status, 401);

    const before = await json(app.base + '/api/config');
    assert.equal(before.data.coinName, 'FromEnv');
    assert.equal(before.data.launched, false);

    const saved = await json(app.base + '/api/admin/settings', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ coin_name: 'Ansemmas', token_mint: mint, rewards_wallet: rewards, dexscreener_url: 'https://dexscreener.com/solana/newpair' }),
    });
    assert.equal(saved.res.status, 200, JSON.stringify(saved.data));
    assert.equal(saved.data.values.launched, true);
    assert.ok(saved.data.saved.includes('token_mint'));
    assert.ok(saved.data.saved.includes('coin_name'));

    const live = await json(app.base + '/api/config');
    assert.equal(live.data.launched, true);
    assert.equal(live.data.tokenMint, mint);
    assert.equal(live.data.coinName, 'Ansemmas');
    assert.equal(live.data.rewardsWallet, rewards);

    const dash = await json(app.base + '/api/dashboard');
    assert.equal(dash.data.rewardsWalletSet, true);
    assert.equal(dash.data.balanceSol, 3.25);
    assert.equal(dash.data.availableSol, 3.2);
    assert.equal(dash.data.mint.supply, 1_000_000_000);
    assert.equal(dash.data.market.priceUsd, 0.002);

    const cleared = await json(app.base + '/api/admin/settings', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ token_mint: '', rewards_wallet: '' }),
    });
    assert.equal(cleared.res.status, 200, JSON.stringify(cleared.data));
    assert.equal(cleared.data.values.launched, false);
    assert.equal(cleared.data.saved.includes('token_mint'), false);
    const again = await json(app.base + '/api/config');
    assert.equal(again.data.launched, false);
    assert.equal(again.data.tokenMint, null);
    assert.equal(again.data.rewardsWallet, null);
    assert.equal(again.data.coinName, 'Ansemmas');
  } finally {
    await app.stop();
  }
});

test('bad mint, missing mint, and mint changes after votes', async () => {
  const mint = wallet().publicKey;
  const other = wallet().publicKey;
  const holder = wallet();
  const balances = { [holder.publicKey]: 150000 };
  const app = await start({
    env: { ADMIN_TOKEN: 'test-admin' },
    solana: fakeSolana({ balances, missing: [other] }),
  });
  try {
    const bad = await json(app.base + '/api/admin/settings', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ token_mint: 'not-an-address' }),
    });
    assert.equal(bad.res.status, 400);
    assert.match(bad.data.errors.token_mint, /Solana/);

    const missing = await json(app.base + '/api/admin/settings', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ token_mint: other }),
    });
    assert.equal(missing.res.status, 409);
    assert.match(missing.data.error, /force=1/);

    const forced = await json(app.base + '/api/admin/settings?force=1', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ token_mint: mint }),
    });
    assert.equal(forced.res.status, 200, JSON.stringify(forced.data));

    const round = await openRound(app, 'Where next?');
    await cast(app, round.round.id, round.candidates[0].id, holder);
    const swap = await json(app.base + '/api/admin/settings', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ token_mint: wallet().publicKey }),
    });
    assert.equal(swap.res.status, 409);
    assert.match(swap.data.error, /force=1/);
    const ok = await json(app.base + '/api/admin/settings?force=1', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ token_mint: wallet().publicKey }),
    });
    assert.equal(ok.res.status, 200);
  } finally {
    await app.stop();
  }
});

async function openRound(app, title = 'Where does it go?', extra = {}) {
  const ends = new Date(Date.now() + 3 * 86400000).toISOString();
  const { res, data } = await json(app.base + '/api/admin/rounds', {
    method: 'POST',
    headers: adminHeaders(),
    body: JSON.stringify({
      title,
      kind: 'location',
      ends_at: ends,
      allow_proposals: true,
      candidates: [{ name: 'Miami, FL' }, { name: 'Austin, TX' }],
      ...extra,
    }),
  });
  assert.equal(res.status, 201, JSON.stringify(data));
  return data;
}

async function cast(app, roundId, candidateId, holder) {
  const cfg = (await json(app.base + '/api/config')).data;
  const message = build(cfg, {
    Action: 'vote',
    Mint: cfg.tokenMint,
    Round: roundId,
    Candidate: candidateId,
    Wallet: holder.publicKey,
    Timestamp: new Date().toISOString(),
  });
  return json(app.base + `/api/rounds/${roundId}/vote`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ wallet: holder.publicKey, candidateId, message, signature: sign(holder, message) }),
  });
}

test('voting is closed until launch, then weights and re-weighs', async () => {
  const holder = wallet();
  const other = wallet();
  const balances = { [holder.publicKey]: 180000, [other.publicKey]: 50000 };
  const app = await start({ env: { ADMIN_TOKEN: 'test-admin' }, solana: fakeSolana({ balances }) });
  try {
    const early = await cast(app, 1, 1, holder);
    assert.equal(early.res.status, 400);
    assert.match(early.data.error, /launch/i);

    const mint = wallet().publicKey;
    await json(app.base + '/api/admin/settings', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ token_mint: mint }),
    });
    const round = await openRound(app);
    const blocked = await json(app.base + '/api/holder/' + holder.publicKey);
    assert.equal(blocked.data.eligible, true);
    const small = await json(app.base + '/api/holder/' + other.publicKey);
    assert.equal(small.data.balance, 50000);
    assert.equal(small.data.eligible, false);

    const tooSmall = await cast(app, round.round.id, round.candidates[0].id, other);
    assert.equal(tooSmall.res.status, 400);
    assert.match(tooSmall.data.error, /minimum/i);

    const voted = await cast(app, round.round.id, round.candidates[0].id, holder);
    assert.equal(voted.res.status, 200, JSON.stringify(voted.data));
    assert.equal(voted.data.changed, false);
    assert.equal(voted.data.weight, 180000);
    assert.equal(voted.data.results.totals.weight, 180000);
    assert.equal(voted.data.results.totals.votes, 1);

    const badSig = await json(app.base + `/api/rounds/${round.round.id}/vote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: holder.publicKey, candidateId: round.candidates[1].id, message: 'nope', signature: 'aa' }),
    });
    assert.equal(badSig.res.status, 400);

    const moved = await cast(app, round.round.id, round.candidates[1].id, holder);
    assert.equal(moved.data.changed, true);
    assert.equal(moved.data.results.candidates.find((c) => c.id === round.candidates[1].id).weight, 180000);

    balances[holder.publicKey] = 120000;
    const closed = await json(app.base + `/api/admin/rounds/${round.round.id}/close`, { method: 'POST', headers: adminHeaders() });
    assert.equal(closed.res.status, 200, JSON.stringify(closed.data));
    assert.equal(closed.data.round.open, false);
    const winner = closed.data.candidates.find((c) => c.id === round.candidates[1].id);
    assert.equal(winner.weight, 120000);
    assert.equal(winner.valid_votes, 1);

    balances[holder.publicKey] = 180000;
    const again = await json(app.base + `/api/admin/rounds/${round.round.id}/close`, { method: 'POST', headers: adminHeaders() });
    assert.equal(again.res.status, 400);

    const audit = await json(app.base + `/api/rounds/${round.round.id}/audit`);
    assert.equal(audit.data.length, 1);
    assert.equal(audit.data[0].wallet, holder.publicKey);
    assert.equal(verifySignature(audit.data[0].message, audit.data[0].signature, holder.publicKey), true);

    const csv = await fetch(app.base + `/api/admin/rounds/${round.round.id}/votes.csv`, { headers: { 'x-admin-token': 'test-admin' } });
    const text = await csv.text();
    assert.match(text, new RegExp(holder.publicKey));
    assert.match(text, /wallet,candidate_id/);
  } finally {
    await app.stop();
  }
});

test('a holder can propose a location and an admin can approve it', async () => {
  const holder = wallet();
  const app = await start({ env: { ADMIN_TOKEN: 'test-admin' }, solana: fakeSolana({ balances: { [holder.publicKey]: 200000 } }) });
  try {
    await json(app.base + '/api/admin/settings', {
      method: 'PUT',
      headers: adminHeaders(),
      body: JSON.stringify({ token_mint: wallet().publicKey }),
    });
    const round = await openRound(app);
    const cfg = (await json(app.base + '/api/config')).data;
    const name = 'Chicago, IL · Lake Shore';
    const message = build(cfg, {
      Action: 'propose',
      Mint: cfg.tokenMint,
      Round: round.round.id,
      Location: name,
      Wallet: holder.publicKey,
      Timestamp: new Date().toISOString(),
    });
    const proposed = await json(app.base + `/api/rounds/${round.round.id}/propose`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: holder.publicKey, name, message, signature: sign(holder, message) }),
    });
    assert.equal(proposed.res.status, 201, JSON.stringify(proposed.data));
    const pending = await json(app.base + '/api/rounds/' + round.round.id);
    assert.equal(pending.data.pending[0].name, name);
    const approved = await json(app.base + `/api/admin/candidates/${proposed.data.id}/approve`, { method: 'POST', headers: adminHeaders() });
    assert.equal(approved.res.status, 200);
    assert.ok(approved.data.candidates.some((c) => c.name === name));
  } finally {
    await app.stop();
  }
});

test('designs can be submitted before launch and shared to RiseofMemes', async () => {
  const app = await start({ env: { ADMIN_TOKEN: 'test-admin' } });
  try {
    const cfg = (await json(app.base + '/api/config')).data;
    assert.equal(cfg.reviewXHandle, 'RiseofMemes');
    const form = new FormData();
    form.set('title', 'Snowy Times Square');
    form.set('x_handle', '@designer');
    form.set('image', new Blob([PNG], { type: 'image/png' }), 'dot.png');
    const posted = await json(app.base + '/api/designs', { method: 'POST', body: form });
    assert.equal(posted.res.status, 201, JSON.stringify(posted.data));
    const hidden = await json(app.base + '/api/designs');
    assert.equal(hidden.data.length, 0);
    const one = await json(app.base + '/api/designs/' + posted.data.id);
    assert.equal(one.data.status, 'pending');
    assert.equal(one.data.x_handle, 'designer');
    assert.equal(one.data.width, 1);

    const approved = await json(app.base + `/api/admin/designs/${posted.data.id}/approve`, { method: 'POST', headers: adminHeaders() });
    assert.equal(approved.res.status, 200);
    const gallery = await json(app.base + '/api/designs');
    assert.equal(gallery.data[0].title, 'Snowy Times Square');
    assert.equal(gallery.data[0].official, false);

    const marked = await json(app.base + `/api/admin/designs/${posted.data.id}/official`, { method: 'POST', headers: adminHeaders() });
    assert.equal(marked.res.status, 200);
    const official = await json(app.base + '/api/designs');
    assert.equal(official.data[0].official, true);

    const file = await fetch(app.base + official.data[0].image_url);
    assert.equal(file.status, 200);
  } finally {
    await app.stop();
  }
});

test('billboards record cost and can be removed', async () => {
  const app = await start({ env: { ADMIN_TOKEN: 'test-admin' } });
  try {
    const created = await json(app.base + '/api/admin/billboards', {
      method: 'POST',
      headers: adminHeaders(),
      body: JSON.stringify({
        location: 'I-95, Miami',
        city: 'Miami',
        run_date: '2026-12-20',
        run_days: 7,
        cost_usd: 1500,
        cost_sol: 8.5,
        vendor: 'Blip',
        tx_sig: 'demo-tx',
      }),
    });
    assert.equal(created.res.status, 201, JSON.stringify(created.data));
    const list = await json(app.base + '/api/billboards');
    assert.equal(list.data.length, 1);
    assert.equal(list.data[0].cost_usd, 1500);
    const dash = await json(app.base + '/api/dashboard');
    assert.equal(dash.data.spent.count, 1);
    assert.equal(dash.data.spent.usd, 1500);
    assert.equal(dash.data.launched, false);
    const removed = await fetch(app.base + '/api/admin/billboards/' + created.data.id, { method: 'DELETE', headers: { 'x-admin-token': 'test-admin' } });
    assert.equal(removed.status, 200);
    const empty = await json(app.base + '/api/billboards');
    assert.equal(empty.data.length, 0);
  } finally {
    await app.stop();
  }
});

test('unknown api routes return json', async () => {
  const app = await start();
  try {
    const { res, data } = await json(app.base + '/api/health');
    assert.equal(res.status, 404);
    assert.equal(data.error, 'Not found');
  } finally {
    await app.stop();
  }
});
