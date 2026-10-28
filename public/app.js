'use strict';
(() => {
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const app = $('#app');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 2) => (n === null || n === undefined || isNaN(n) ? '—' : Number(n).toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
  const usd = (n) => (n === null || n === undefined ? '—' : '$' + fmt(n, 2));
  const compact = (n) => (n === null || n === undefined ? '—' : '$' + Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 }).format(n));
  const price = (n) => (n === null || n === undefined ? '—' : '$' + (n < 0.01 ? Number(n).toPrecision(3) : fmt(n, 4)));
  const short = (a) => (a ? a.slice(0, 4) + '…' + a.slice(-4) : '');
  const safeHref = (u) => (/^(https?:\/\/|\/(uploads|examples)\/)/i.test(u || '') ? u : null);
  const solscan = (addr, kind = 'account') => `https://solscan.io/${kind}/${encodeURIComponent(addr)}`;
  let CFG = {};
  let timers = [];
  const clearTimers = () => { timers.forEach(clearInterval); timers = []; };
  const sym = () => (CFG.tokenSymbol ? '$' + CFG.tokenSymbol : 'tokens');

  function toast(msg, kind = 'ok') {
    const t = $('#toast'); t.textContent = msg; t.className = 'toast ' + kind; t.hidden = false;
    clearTimeout(toast._t); toast._t = setTimeout(() => (t.hidden = true), 5000);
  }
  async function api(path, opts = {}) {
    const headers = { ...(opts.body && !(opts.body instanceof FormData) ? { 'content-type': 'application/json' } : {}), ...(opts.headers || {}) };
    const res = await fetch(path, { ...opts, headers });
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : await res.text();
    if (!res.ok) { const e = new Error(data?.error || `HTTP ${res.status}`); e.data = data; throw e; }
    return data;
  }

  // ---------- icons ----------
  const ICON = {
    x: '<svg viewBox="0 0 24 24"><path d="M18.9 2H22l-7.3 8.3L23 22h-6.8l-5.3-7-6.1 7H1.7l7.8-8.9L1 2h7l4.8 6.4L18.9 2zm-1.2 18h1.9L7.4 3.9H5.4L17.7 20z"/></svg>',
    tiktok: '<svg viewBox="0 0 24 24"><path d="M16.6 2h-3.4v13.3a3 3 0 1 1-3-3c.3 0 .6 0 .9.1V8.9a6.4 6.4 0 1 0 5.5 6.4V8.6a8 8 0 0 0 4.6 1.5V6.7a4.7 4.7 0 0 1-4.6-4.7z"/></svg>',
    dex: '<svg viewBox="0 0 24 24"><path d="M3 20h18v2H3zM5 10h3v8H5zm5.5-6h3v14h-3zM16 13h3v5h-3z"/></svg>',
    web: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.2 1.5 2.5 1.9 4h-3.8c.4-1.5 1.1-2.8 1.9-4zM4.3 14a8 8 0 0 1 0-4h3.4a16 16 0 0 0 0 4H4.3zm.8 2h3a15.7 15.7 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.4-3.6C8.9 5.5 8.4 6.7 8.1 8zM12 20c-.8-1.2-1.5-2.5-1.9-4h3.8c-.4 1.5-1.1 2.8-1.9 4zm2.3-6H9.7a14 14 0 0 1 0-4h4.6a14 14 0 0 1 0 4zm.3 5.6c.6-1.1 1.1-2.3 1.4-3.6h3a8 8 0 0 1-4.4 3.6zM16.3 14a16 16 0 0 0 0-4h3.4a8 8 0 0 1 0 4h-3.4z"/></svg>',
    tg: '<svg viewBox="0 0 24 24"><path d="M21.9 4.3 18.7 19.4c-.2 1-.9 1.3-1.8.8l-4.9-3.6-2.4 2.3c-.3.3-.5.5-1 .5l.3-5 9.1-8.2c.4-.4-.1-.6-.6-.2L6.2 13 1.4 11.5c-1-.3-1-1 .2-1.5L20.6 2.8c.9-.3 1.6.2 1.3 1.5z"/></svg>',
    copy: '<svg viewBox="0 0 24 24"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1zm3 4H8a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2zm0 16H8V7h11v14z"/></svg>',
  };
  function socialLinks() {
    const L = CFG.links || {};
    return [['website', 'Website', ICON.web], ['x', 'X', ICON.x], ['tiktok', 'TikTok', ICON.tiktok], ['telegram', 'Telegram', ICON.tg], ['dexscreener', 'DexScreener', ICON.dex]]
      .filter(([k]) => safeHref(L[k])).map(([k, n, i]) => `<a class="social" href="${esc(L[k])}" target="_blank" rel="noopener">${i}${n}</a>`).join('');
  }
  function caBox() {
    if (!CFG.tokenMint) return '<span class="pill pending">Contract address posted at launch</span>';
    return `<span class="ca"><span class="label">CA</span><span class="mono">${esc(CFG.tokenMint)}</span><button class="btn small mint" data-copy="${esc(CFG.tokenMint)}">${ICON.copy}Copy</button></span>`;
  }
  document.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    try { await navigator.clipboard.writeText(b.dataset.copy); toast('Copied'); } catch { prompt('Copy:', b.dataset.copy); }
  });

  // ---------- base58 / signing ----------
  const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  function b58(bytes) {
    let zeros = 0; while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
    const d = [];
    for (let i = zeros; i < bytes.length; i++) { let c = bytes[i]; for (let j = 0; j < d.length; j++) { c += d[j] << 8; d[j] = c % 58; c = (c / 58) | 0; } while (c) { d.push(c % 58); c = (c / 58) | 0; } }
    return '1'.repeat(zeros) + d.reverse().map((x) => B58[x]).join('');
  }
  const toB64 = (u8) => btoa(String.fromCharCode(...u8));
  const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
  const buildMessage = (fields) => [CFG.message.header, ...Object.entries(fields).map(([k, v]) => `${k}: ${String(v).replace(/[\r\n]+/g, ' ')}`), CFG.message.footer].join('\n');

  // ---------- wallet ----------
  const wallet = { pubkey: null, kind: null, provider: null, balance: null, eligible: false };
  function providers() {
    const list = [];
    const ph = window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null);
    if (ph) list.push({ kind: 'Phantom', p: ph });
    if (window.solflare) list.push({ kind: 'Solflare', p: window.solflare });
    if (window.backpack?.solana) list.push({ kind: 'Backpack', p: window.backpack.solana });
    if (!list.length && window.solana) list.push({ kind: 'Wallet', p: window.solana });
    return list;
  }
  async function connect(kind) {
    if (kind === 'demo') {
      const sk = localStorage.getItem('demoWalletSk');
      const kp = sk ? nacl.sign.keyPair.fromSecretKey(fromB64(sk)) : nacl.sign.keyPair();
      if (!sk) localStorage.setItem('demoWalletSk', toB64(kp.secretKey));
      Object.assign(wallet, { pubkey: b58(kp.publicKey), kind: 'Demo wallet', provider: { demoKp: kp } });
    } else {
      const found = providers().find((x) => x.kind === kind) || providers()[0];
      if (!found) { window.open('https://phantom.app/', '_blank', 'noopener'); throw new Error('No Solana wallet found. Install Phantom or Solflare, or open this site in your wallet app\'s browser.'); }
      const r = await found.p.connect();
      Object.assign(wallet, { pubkey: (r?.publicKey || found.p.publicKey).toString(), kind: found.kind, provider: found.p });
    }
    const h = await api('/api/holder/' + wallet.pubkey);
    wallet.balance = h.balance; wallet.eligible = h.eligible;
  }
  async function signText(text) {
    const bytes = new TextEncoder().encode(text);
    if (wallet.provider?.demoKp) return toB64(nacl.sign.detached(bytes, wallet.provider.demoKp.secretKey));
    const r = await wallet.provider.signMessage(bytes, 'utf8');
    return toB64(new Uint8Array(r?.signature || r));
  }
  function disconnect() { try { wallet.provider?.disconnect?.(); } catch {} Object.assign(wallet, { pubkey: null, kind: null, provider: null, balance: null, eligible: false }); }
  function walletCard(onChange) {
    const el = document.createElement('div'); el.className = 'card';
    const draw = () => {
      if (!wallet.pubkey) {
        const ps = providers();
        el.innerHTML = `<div class="row between"><div><b>Connect a Solana wallet</b><div class="meta">Phantom, Solflare or Backpack. You only sign a free message.</div></div>
          <div class="row">${ps.map((p) => `<button class="btn primary" data-connect="${esc(p.kind)}">Connect ${esc(p.kind)}</button>`).join('') || '<button class="btn primary" data-connect="none">Connect wallet</button>'}
          ${CFG.demo ? '<button class="btn" data-connect="demo">Use demo wallet</button>' : ''}</div></div>`;
        $$('[data-connect]', el).forEach((b) => b.onclick = async () => {
          b.disabled = true;
          try { await connect(b.dataset.connect); toast('Wallet connected'); draw(); onChange?.(); } catch (e) { toast(e.message, 'err'); b.disabled = false; }
        });
      } else {
        el.innerHTML = `<div class="row between"><div><div class="row"><span class="pill live">${esc(wallet.kind)}</span><span class="mono">${esc(short(wallet.pubkey))}</span></div>
          <div style="margin-top:6px">Holding <b>${fmt(wallet.balance, 0)} ${esc(sym())}</b> ${wallet.eligible ? '<span class="pill live">Eligible</span>' : `<span class="pill pending">Below ${fmt(CFG.minHolding, 0)} minimum</span>`}</div></div>
          <button class="btn small" data-disc>Disconnect</button></div>`;
        $('[data-disc]', el).onclick = () => { disconnect(); draw(); onChange?.(); };
      }
    };
    draw();
    return el;
  }

  // ---------- shared pieces ----------
  function shareUrl(d) {
    const base = CFG.publicUrl || location.origin;
    const link = `${base}/design/${encodeURIComponent(d.id)}`;
    const text = `New billboard design for @${CFG.reviewXHandle} to review: "${d.title}"${d.x_handle ? ` by @${d.x_handle}` : ''}${CFG.tokenSymbol ? ` $${CFG.tokenSymbol}` : ''}\n${link}`;
    return 'https://x.com/intent/post?text=' + encodeURIComponent(text);
  }
  const shareBtn = (d, cls = 'small') => `<a class="btn x ${cls}" href="${esc(shareUrl(d))}" target="_blank" rel="noopener">${ICON.x}Share to @${esc(CFG.reviewXHandle)}</a>`;

  function designTile(d, { share = true } = {}) {
    return `<div class="card tile"><a href="/design/${esc(d.id)}"><img src="${esc(d.thumb_url)}" alt="${esc(d.title)}" loading="lazy"></a>
      <div class="body"><div class="row between"><div class="title">${esc(d.title)}</div>${d.official ? '<span class="pill official">Official</span>' : ''}</div>
      <div class="meta">${d.x_handle ? `by <a href="https://x.com/${esc(d.x_handle)}" target="_blank" rel="noopener">@${esc(d.x_handle)}</a>` : d.official ? 'Current ad design' : 'Community design'}
        ${d.wallet ? ` · <span class="pill holder">Holder ${esc(short(d.wallet))}</span>` : ''}</div>
      <div class="links"><a href="${esc(d.image_url)}" target="_blank" rel="noopener">Full size ↗</a>${share && !d.official ? shareBtn(d) : ''}</div></div></div>`;
  }
  function boardTile(b) {
    const img = safeHref(b.photo_url), proof = safeHref(b.proof_url);
    return `<div class="card tile">${img ? `<img src="${esc(img)}" alt="Billboard at ${esc(b.location)}" loading="lazy">` : ''}
      <div class="body"><div class="title">${esc(b.location)}</div>
      <div class="meta">${esc(b.city || '')}${b.city ? ' · ' : ''}${esc(b.run_date)}${b.run_days ? ` · ${b.run_days} day${b.run_days > 1 ? 's' : ''}` : ''}${b.vendor ? ' · ' + esc(b.vendor) : ''}</div>
      <div class="cost">${usd(b.cost_usd)} <span class="meta">(${fmt(b.cost_sol, 4)} SOL)</span></div>
      ${b.notes ? `<div class="meta">${esc(b.notes)}</div>` : ''}
      <div class="links">${proof ? `<a href="${esc(proof)}" target="_blank" rel="noopener">Receipt / proof ↗</a>` : ''}
      ${b.tx_sig && !b.tx_sig.startsWith('DEMO') ? `<a href="${solscan(b.tx_sig, 'tx')}" target="_blank" rel="noopener">Payment tx ↗</a>` : b.tx_sig ? '<span class="meta">tx: demo</span>' : ''}</div></div></div>`;
  }
  const prelaunchCard = (what) => `<div class="card prelaunch"><div class="label">Coming soon</div><div class="big" style="margin:6px 0">${esc(what)}</div>
    <div class="meta" style="font-size:15px">${esc(CFG.launchNote)}</div><div class="row" style="margin-top:14px"><a class="btn primary" href="/#/designs">Submit a billboard design</a></div></div>`;

  // ---------- home ----------
  async function viewHome() {
    const name = CFG.coinName || CFG.siteTitle;
    const soon = !CFG.launched;
    app.innerHTML = `<section class="hero${soon ? ' hero-soon' : ''}">
        ${CFG.mascotUrl ? `<img class="mascot" src="${esc(CFG.mascotUrl)}" alt="${esc(name)} mascot">` : '<div class="mascot placeholder">★</div>'}
        <div><div class="row">${CFG.tokenSymbol ? `<span class="pill official">$${esc(CFG.tokenSymbol)}</span>` : ''}<span class="pill">Solana</span>${CFG.launched ? '<span class="pill live">Live</span>' : '<span class="pill pending">Coming soon</span>'}</div>
        ${soon ? '<p class="soon-kicker">Coming soon</p>' : ''}
        <h1>${esc(CFG.siteTitle)}</h1><p class="tagline">${esc(CFG.tagline)}</p>
        ${caBox()}<div class="socials">${socialLinks()}</div></div></section>
      <div id="dash" class="grid stats"><div class="card">Loading…</div></div>
      <div class="section" id="home-votes"></div>
      <div class="section"><div class="row between"><h2>Current ad designs</h2><a href="/#/designs">All designs →</a></div><div id="ads" class="grid gallery"></div></div>
      <div class="section"><div class="row between"><h2>Billboards bought</h2><a href="/#/billboards">See all →</a></div><div id="latest" class="grid gallery"></div></div>`;
    const load = async () => {
      try { $('#dash').innerHTML = dashCards(await api('/api/dashboard')); } catch (e) { $('#dash').innerHTML = `<div class="card">Could not load: ${esc(e.message)}</div>`; }
    };
    await load(); timers.push(setInterval(load, 30000));
    const [designs, boards, rounds] = await Promise.all([api('/api/designs'), api('/api/billboards'), api('/api/rounds')]);
    const official = designs.filter((d) => d.official);
    $('#ads').innerHTML = official.map((d) => designTile(d)).join('') || '<div class="card empty">Ad designs will be posted here. Want to make one? <a href="/#/designs">Submit a design</a>.</div>';
    $('#latest').innerHTML = boards.slice(0, 3).map(boardTile).join('') || '<div class="card empty">No billboards yet. The first one gets funded from creator rewards after launch.</div>';
    const open = rounds.filter((r) => r.round.open);
    if (CFG.launched && open.length) $('#home-votes').innerHTML = open.map((o) => `<div class="card row between" style="margin-bottom:10px"><div><span class="pill live">Vote open</span>
        <h2 style="margin:8px 0 4px">${esc(o.round.title)}</h2><div class="meta">Leading: <b>${esc(o.candidates[0]?.name || '—')}</b> · ${o.totals.votes} wallets · ends ${new Date(o.round.ends_at).toLocaleString()}</div></div>
        <a class="btn primary" href="/#/vote">Vote now</a></div>`).join('');
  }
  function dashCards(d) {
    if (!d.launched) return `<div style="grid-column:1/-1">${prelaunchCard('Rewards tracking starts at launch')}</div>` + spentCard(d);
    let html = '';
    const m = d.market;
    html += `<div class="card stat"><div class="label">${esc(sym())} price</div><div class="value">${price(m?.priceUsd)}</div>
      <div class="hint">${m ? `MC ${compact(m.marketCap)} · Liq ${compact(m.liquidityUsd)}${m.change24h !== null ? ` · 24h ${m.change24h > 0 ? '+' : ''}${fmt(m.change24h, 1)}%` : ''}` : 'Market data unavailable'}</div>
      ${d.mint ? `<div class="hint">Supply ${Intl.NumberFormat(undefined, { notation: 'compact' }).format(d.mint.supply)} · ${d.mint.program === 'spl-token-2022' ? 'Token-2022' : 'SPL'} · mint authority ${d.mint.mintAuthority ? 'set' : 'revoked'}</div>` : d.mintError ? `<div class="hint" style="color:var(--bad)">${esc(d.mintError)}</div>` : ''}</div>`;
    if (!d.rewardsWalletSet) {
      html += `<div class="card stat hero-stat" style="grid-column:span 2"><div class="label">Creator rewards</div><div class="value" style="font-size:24px">Rewards wallet not set yet</div>
        <div class="hint">Balances show here once the creator publishes the rewards wallet. No numbers until then.</div></div>`;
    } else {
      const pct = d.availableUsd && d.nextTargetUsd ? Math.min(100, (d.availableUsd / d.nextTargetUsd) * 100) : 0;
      html += `<div class="card stat hero-stat"><div class="label">Available for next billboard</div><div class="value">${fmt(d.availableSol, 4)} <small>SOL</small></div>
          <div class="hint">≈ ${usd(d.availableUsd)} · ${fmt(pct, 0)}% of a ${usd(d.nextTargetUsd)} slot</div><div class="progress"><div style="width:${pct}%"></div></div></div>
        <div class="card stat"><div class="label">Rewards wallet</div><div class="value">${fmt(d.balanceSol, 4)} <small>SOL</small></div>
          <div class="hint">≈ ${usd(d.balanceUsd)} · keeps ${fmt(d.reserveSol, 2)} SOL for fees</div>
          <div class="hint"><a class="mono" href="${solscan(d.rewardsWallet)}" target="_blank" rel="noopener">${esc(short(d.rewardsWallet))}</a>${d.balanceError ? ` · <span style="color:var(--bad)">RPC error</span>` : ''}</div></div>`;
    }
    return html + spentCard(d);
  }
  const spentCard = (d) => `<div class="card stat"><div class="label">Spent on billboards</div><div class="value">${usd(d.spent.usd)}</div>
    <div class="hint">${fmt(d.spent.sol, 4)} SOL across ${d.spent.count} billboard${d.spent.count === 1 ? '' : 's'}${d.solUsd ? ` · SOL ${usd(d.solUsd)}` : ''}</div></div>`;

  // ---------- billboards ----------
  async function viewBillboards() {
    app.innerHTML = `<h1>Billboards bought</h1><p class="sub">Every billboard paid for with creator rewards, with cost and proof.</p><div id="list" class="grid gallery"></div>`;
    const boards = await api('/api/billboards');
    const tot = boards.reduce((t, b) => ({ usd: t.usd + b.cost_usd, sol: t.sol + b.cost_sol }), { usd: 0, sol: 0 });
    $('#list').innerHTML = boards.map(boardTile).join('') || '<div class="card empty">No billboards yet.</div>';
    if (boards.length) $('#list').insertAdjacentHTML('beforebegin', `<div class="row" style="margin-bottom:14px"><span class="pill">${boards.length} billboards</span><span class="pill">${usd(tot.usd)} total</span><span class="pill">${fmt(tot.sol, 4)} SOL</span></div>`);
  }

  // ---------- vote ----------
  function countdown(endsAt) {
    const ms = Date.parse(endsAt) - Date.now();
    if (ms <= 0) return 'Closing…';
    const d = Math.floor(ms / 86400000), h = Math.floor(ms / 3600000) % 24, m = Math.floor(ms / 60000) % 60, s = Math.floor(ms / 1000) % 60;
    return `${d ? d + 'd ' : ''}${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
  }
  const KIND = { location: 'Location vote', design: 'Design vote', pair: 'Location + design vote' };
  async function viewVote() {
    app.innerHTML = `<h1>Vote on the next billboard</h1>
      <p class="sub">Where it goes and what goes on it. Votes are weighted by ${esc(sym())} held (minimum ${fmt(CFG.minHolding, 0)}). Connect your wallet and sign a free message to prove you hold.</p>
      <div id="wallet-slot"></div><div id="rounds"></div><div class="section" id="past"></div>
      <div class="section note"><b>How the vote stays fair.</b> Your wallet signs a plain message (no transaction, no fee). The server checks the signature and reads your balance on-chain. One vote per wallet per round, changeable until close. When a round closes every vote is re-weighed: the lower of your balance at vote time and at close counts, and wallets under the minimum drop to zero. That blunts buy-vote-sell tricks but can't fully stop someone splitting tokens across wallets, so the one-wallet-one-vote count is shown too. Every signed vote is public in each round's audit feed.</div>`;
    if (!CFG.launched) { $('#rounds').innerHTML = prelaunchCard('Holder voting opens at launch'); return; }
    const rounds = await api('/api/rounds');
    const open = rounds.filter((r) => r.round.open), past = rounds.filter((r) => !r.round.open);
    const redraw = async () => { for (const o of open) renderRound(await api('/api/rounds/' + o.round.id)); };
    $('#wallet-slot').append(walletCard(redraw));
    $('#rounds').innerHTML = open.length ? open.map((o) => `<div class="section" id="round-${o.round.id}"></div>`).join('') : '<div class="section card empty">No vote is open right now. Check back soon.</div>';
    for (const o of open) renderRound(o);
    $('#past').innerHTML = past.length ? '<h2>Past rounds</h2>' + past.map((r) => {
      const w = r.candidates[0];
      return `<div class="card" style="margin-bottom:10px"><div class="row between"><div class="row"><span class="pill">Closed</span><b>${esc(r.round.title)}</b></div><div class="meta">${new Date(r.round.ends_at).toLocaleDateString()}</div></div>
        <div style="margin-top:8px">Winner: <b>${esc(w?.name || '—')}</b> · ${fmt(w?.weight, 0)} tokens · ${w?.valid_votes ?? 0} wallets · <a href="/api/rounds/${r.round.id}/audit" target="_blank">audit</a></div></div>`;
    }).join('') : '';
    timers.push(setInterval(() => open.forEach((o) => { const el = $(`#cd-${o.round.id}`); if (el) el.textContent = countdown(o.round.ends_at); }), 1000));
    timers.push(setInterval(() => redraw().catch(() => {}), 20000));
  }
  async function renderRound(data) {
    const { round, candidates, totals, pending } = data;
    const host = $(`#round-${round.id}`); if (!host) return;
    let mine = null;
    if (wallet.pubkey) { try { mine = await api(`/api/rounds/${round.id}/vote/${wallet.pubkey}`); } catch {} }
    const canVote = wallet.pubkey && wallet.eligible && round.open;
    host.innerHTML = `<div class="card">
      <div class="row between"><div><div class="row"><span class="pill live">Live</span><span class="pill">${KIND[round.kind] || 'Vote'}</span></div><h2 style="margin:8px 0 2px">${esc(round.title)}</h2>${round.description ? `<div class="meta">${esc(round.description)}</div>` : ''}</div>
        <div style="text-align:right"><div class="meta">Ends ${new Date(round.ends_at).toLocaleString()}</div><div class="countdown" id="cd-${round.id}">${countdown(round.ends_at)}</div></div></div>
      <div class="row" style="margin:14px 0"><span class="pill">${fmt(totals.weight, 0)} tokens voting</span><span class="pill">${totals.votes} wallets (1 wallet = 1 vote)</span><a class="pill" href="/api/rounds/${round.id}/audit" target="_blank">Audit feed</a></div>
      <div class="cands">${candidates.map((c) => {
        const pw = totals.weight ? (c.weight / totals.weight) * 100 : 0, pv = totals.votes ? (c.votes / totals.votes) * 100 : 0;
        const isMine = mine?.candidate_id === c.id;
        return `<div class="cand ${isMine ? 'mine' : ''} ${canVote ? '' : 'disabled'}" data-cid="${c.id}" data-name="${esc(c.name)}" role="button" tabindex="0">
          <div class="bar" style="width:${pw}%"></div>
          <div class="row between"><div class="left">${c.design_thumb ? `<img class="thumb" src="${esc(c.design_thumb)}" alt="">` : ''}
            <div><div class="name">${esc(c.name)} ${isMine ? '<span class="pill live">Your vote</span>' : ''}</div>
            <div class="meta">${c.design_id && round.kind === 'pair' ? `Design: ${esc(c.design_title)} · ` : ''}${c.design_by ? `by @${esc(c.design_by)} · ` : ''}${esc(c.description || '')}${c.design_id ? ` <a href="/design/${esc(c.design_id)}">view</a>` : ''}</div></div></div>
          <div class="nums"><div class="pct">${fmt(pw, 1)}%</div>${fmt(c.weight, 0)} tokens · ${c.votes} wallet${c.votes === 1 ? '' : 's'} (${fmt(pv, 0)}%)</div></div></div>`;
      }).join('')}</div>
      <div class="meta" style="margin-top:10px">${!wallet.pubkey ? 'Connect a wallet to vote.' : !wallet.eligible ? 'Your wallet holds less than the minimum.' : mine ? 'Tap another option to change your vote.' : 'Tap an option to vote. Your wallet will ask you to sign a message.'}</div>
      ${round.allow_proposals ? `<div style="margin-top:18px"><h2>Suggest a location</h2>
        ${pending.length ? `<div class="row" style="margin-bottom:10px">${pending.map((p) => `<span class="pill pending">${esc(p.name)} · awaiting approval</span>`).join('')}</div>` : ''}
        <div class="row"><input data-prop maxlength="80" placeholder="City and spot, e.g. Austin, TX · I-35" style="flex:1;min-width:200px"><button class="btn" data-prop-btn ${canVote ? '' : 'disabled'}>Propose</button></div></div>` : ''}
    </div>`;
    if (canVote) {
      $$('.cand', host).forEach((el) => el.onclick = () => castVote(round.id, Number(el.dataset.cid), el.dataset.name));
      const pb = $('[data-prop-btn]', host); if (pb) pb.onclick = () => propose(round.id, $('[data-prop]', host).value.trim());
    }
  }
  async function castVote(roundId, candidateId, name) {
    try {
      const message = buildMessage({ Action: 'vote', Mint: CFG.tokenMint, Round: roundId, Candidate: candidateId, Wallet: wallet.pubkey, Timestamp: new Date().toISOString() });
      const signature = await signText(message);
      const r = await api(`/api/rounds/${roundId}/vote`, { method: 'POST', body: JSON.stringify({ wallet: wallet.pubkey, candidateId, message, signature }) });
      toast(`${r.changed ? 'Vote changed' : 'Vote counted'}: ${name} (${fmt(r.weight, 0)} tokens)`);
      renderRound(r.results);
    } catch (e) { toast(e.message, 'err'); }
  }
  async function propose(roundId, name) {
    if (!name) return toast('Type a location first', 'err');
    try {
      const message = buildMessage({ Action: 'propose', Mint: CFG.tokenMint, Round: roundId, Location: name, Wallet: wallet.pubkey, Timestamp: new Date().toISOString() });
      const signature = await signText(message);
      await api(`/api/rounds/${roundId}/propose`, { method: 'POST', body: JSON.stringify({ wallet: wallet.pubkey, name, message, signature }) });
      toast('Proposal sent. An admin will review it.');
      renderRound(await api('/api/rounds/' + roundId));
    } catch (e) { toast(e.message, 'err'); }
  }

  // ---------- designs ----------
  async function viewDesigns() {
    app.innerHTML = `<h1>Billboard designs</h1>
      <p class="sub">Make the next billboard. Submit a design, share it to <a href="https://x.com/${esc(CFG.reviewXHandle)}" target="_blank" rel="noopener">@${esc(CFG.reviewXHandle)}</a> on X for review, and approved designs can go up for a holder vote.</p>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(320px,1fr));align-items:start">
        <div class="card" id="submit-card"></div>
        <div class="card"><h2>How it works</h2><ol class="meta" style="font-size:14px;padding-left:18px;margin:0">
          <li>Upload a PNG, JPG or WEBP (max ${CFG.maxUploadMb} MB). Landscape 16:9 works best for digital billboards.</li>
          <li>Tap <b>Share to @${esc(CFG.reviewXHandle)}</b> to post it on X so the creator can review it.</li>
          <li>Approved designs show in the gallery below and can be added to a design vote.</li>
          <li>${CFG.launched ? 'Optional: connect your wallet and sign to get a holder badge on your design.' : 'After launch, holders can also sign with their wallet to get a holder badge.'}</li></ol>
          <p class="note" style="margin-top:12px">Keep it legal and on-brand: no copyrighted logos or other people's photos without permission, nothing offensive, and no promises of profit.</p></div>
      </div>
      <div class="section"><h2>Gallery</h2><div id="gallery" class="grid gallery"></div></div>`;
    drawSubmit();
    const designs = await api('/api/designs');
    $('#gallery').innerHTML = designs.map((d) => designTile(d)).join('') || '<div class="card empty">No approved designs yet. Be the first.</div>';
  }
  function drawSubmit(done) {
    const el = $('#submit-card');
    if (done) {
      el.innerHTML = `<h2>Submitted for review</h2><img src="${esc(done.thumb_url)}" alt="" style="width:100%;border-radius:12px;border:1px solid var(--line)">
        <p>Now send it to <b>@${esc(CFG.reviewXHandle)}</b> so it gets reviewed:</p><div class="row">${shareBtn(done, '')}<a class="btn" href="/design/${esc(done.id)}">Open design page</a></div>
        <p class="meta">Your design page: <span class="mono">${esc((CFG.publicUrl || location.origin) + '/design/' + done.id)}</span></p>
        <button class="btn small" id="again">Submit another</button>`;
      $('#again').onclick = () => drawSubmit();
      return;
    }
    el.innerHTML = `<h2>Submit a design</h2><form id="df">
      <label class="drop" id="drop"><input type="file" name="image" accept="image/png,image/jpeg,image/webp" hidden required><span id="drop-txt">Tap to choose an image<br><small>PNG, JPG or WEBP · max ${CFG.maxUploadMb} MB</small></span></label>
      <label>Title *</label><input name="title" maxlength="80" required placeholder="e.g. Snowy Times Square">
      <label>Your X handle (optional)</label><input name="x_handle" maxlength="16" placeholder="@yourhandle">
      ${CFG.launched ? `<label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" name="sign"> Sign with my wallet to tag it as a holder design</label>` : ''}
      <div style="margin-top:14px"><button class="btn primary" id="dsub">Submit design</button></div></form>`;
    const fi = $('input[type=file]', el);
    fi.onchange = () => {
      const f = fi.files[0]; if (!f) return;
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { toast('Only PNG, JPG or WEBP', 'err'); fi.value = ''; return; }
      if (f.size > CFG.maxUploadMb * 1048576) { toast(`Max ${CFG.maxUploadMb} MB`, 'err'); fi.value = ''; return; }
      $('#drop-txt').innerHTML = `<img src="${URL.createObjectURL(f)}" alt=""><small>${esc(f.name)} · ${fmt(f.size / 1048576, 1)} MB · tap to change</small>`;
    };
    $('#df').onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target; const btn = $('#dsub'); btn.disabled = true; btn.textContent = 'Uploading…';
      try {
        const fd = new FormData();
        fd.append('title', f.title.value.trim()); fd.append('x_handle', f.x_handle.value.trim().replace(/^@/, ''));
        if (f.sign?.checked) {
          if (!wallet.pubkey) await connect(providers()[0]?.kind || (CFG.demo ? 'demo' : 'none'));
          const message = buildMessage({ Action: 'submit-design', Mint: CFG.tokenMint, Title: f.title.value.trim(), Wallet: wallet.pubkey, Timestamp: new Date().toISOString() });
          fd.append('wallet', wallet.pubkey); fd.append('message', message); fd.append('signature', await signText(message));
        }
        fd.append('image', f.image.files[0]);
        const r = await api('/api/designs', { method: 'POST', body: fd });
        const d = await api('/api/designs/' + r.id);
        toast('Design submitted');
        drawSubmit(d);
      } catch (x) { toast(x.message, 'err'); btn.disabled = false; btn.textContent = 'Submit design'; }
    };
  }
  async function viewDesign(id) {
    let d;
    try { d = await api('/api/designs/' + encodeURIComponent(id)); } catch { app.innerHTML = '<div class="card empty">Design not found or removed.</div>'; return; }
    app.innerHTML = `<a href="/#/designs">← All designs</a>
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(300px,1fr));align-items:start;margin-top:12px">
        <div class="design-hero" style="grid-column:span 2"><a href="${esc(d.image_url)}" target="_blank" rel="noopener"><img src="${esc(d.image_url)}" alt="${esc(d.title)}"></a></div>
        <div class="card"><div class="row">${d.status === 'pending' ? '<span class="pill pending">Pending review</span>' : '<span class="pill live">Approved</span>'}${d.official ? '<span class="pill official">Official</span>' : ''}${d.wallet ? `<span class="pill holder">Holder ${esc(short(d.wallet))}</span>` : ''}</div>
          <h1 style="font-size:28px;margin-top:10px">${esc(d.title)}</h1>
          <div class="meta">${d.x_handle ? `by <a href="https://x.com/${esc(d.x_handle)}" target="_blank" rel="noopener">@${esc(d.x_handle)}</a> · ` : ''}${d.width}×${d.height}px · submitted ${new Date(d.created_at + 'Z').toLocaleDateString()}</div>
          ${d.status === 'pending' ? `<p class="note" style="margin-top:12px">Community submission waiting for review. Not endorsed until approved.</p>` : ''}
          ${!d.official ? `<div class="row" style="margin-top:14px">${shareBtn(d, '')}</div>` : ''}</div></div>`;
  }

  // ---------- admin ----------
  const A = (path, opts = {}) => api('/api/admin' + path, { ...opts, headers: { 'x-admin-token': sessionStorage.getItem('adminToken') || '', ...(opts.headers || {}) } });
  async function uploadMedia(file) { const fd = new FormData(); fd.append('image', file); return A('/media', { method: 'POST', body: fd }); }
  async function viewAdmin() {
    if (!sessionStorage.getItem('adminToken')) {
      app.innerHTML = `<h1>Admin</h1><div class="card" style="max-width:460px"><label>Admin token</label><input id="tok" type="password" autocomplete="off"><div style="margin-top:12px"><button class="btn primary" id="login">Unlock</button></div>
        ${CFG.demo ? '<p class="note" style="margin-top:12px">Demo mode token: <span class="mono">demo-admin</span></p>' : ''}</div>`;
      $('#login').onclick = async () => { sessionStorage.setItem('adminToken', $('#tok').value); try { await A('/check'); viewAdmin(); } catch (e) { sessionStorage.removeItem('adminToken'); toast(e.message, 'err'); } };
      return;
    }
    const [st, designs, rounds, boards] = await Promise.all([A('/settings'), A('/designs'), api('/api/rounds'), api('/api/billboards')]);
    const v = st.values;
    const approved = designs.filter((d) => d.status === 'approved'), pending = designs.filter((d) => d.status === 'pending');
    const soon = new Date(Date.now() + 3 * 86400000); soon.setMinutes(0, 0, 0);
    const local = new Date(soon.getTime() - soon.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    const field = (k, label, type = 'text', ph = '') => `<div><label>${label}${st.saved.includes(k) ? ' <span class="pill" title="Saved in admin (overrides env)">saved</span>' : ''}</label><input name="${k}" type="${type}" value="${esc(v[k] ?? '')}" placeholder="${esc(ph)}"></div>`;
    const designOpts = '<option value="">— no design —</option>' + approved.map((d) => `<option value="${esc(d.id)}">${esc(d.title)}${d.official ? ' (official)' : ''}</option>`).join('');
    app.innerHTML = `<div class="row between"><h1>Admin</h1><button class="btn small" id="logout">Lock</button></div>
      <div class="card"><div class="row between"><h2>Coin & site settings</h2><span class="pill ${v.launched ? 'live' : 'pending'}">${v.launched ? 'Launched' : 'Pre-launch (no mint set)'}</span></div>
        <p class="meta">Fill these in after launch. Changes apply instantly, no redeploy needed. Clearing a field falls back to the env var or the default.</p>
        <form id="sf"><div class="form-grid">
          ${field('coin_name', 'Coin name', 'text', 'e.g. Ansemmas')}${field('token_symbol', 'Ticker (no $)', 'text', 'e.g. ANSEMMAS')}
          ${field('token_mint', 'Token mint / CA', 'text', 'empty = launching soon')}${field('rewards_wallet', 'Rewards wallet (public address)', 'text', 'empty = "not set yet"')}
          ${field('site_title', 'Headline / theme text', 'text', 'e.g. Merry Ansemmas')}${field('review_x_handle', 'X account that reviews designs')}
        </div>${field('tagline', 'Tagline')}${field('launch_note', 'Pre-launch message')}
        <div class="form-grid">${field('website_url', 'Website', 'url')}${field('x_url', 'X', 'url')}${field('tiktok_url', 'TikTok', 'url')}${field('telegram_url', 'Telegram', 'url')}${field('dexscreener_url', 'DexScreener', 'url')}</div>
        <div class="form-grid"><div><label>Mascot / logo image</label><div class="row"><input name="mascot_url" value="${esc(v.mascot_url || '')}" placeholder="URL or upload" style="flex:1"><label class="btn small" style="margin:0">Upload<input type="file" id="mascot-file" accept="image/png,image/jpeg,image/webp" hidden></label></div></div>
          ${field('theme_primary', 'Primary color', 'color')}${field('theme_secondary', 'Secondary color', 'color')}${field('theme_accent', 'Accent color', 'color')}
          <div><label>Snow effect</label><select name="snow"><option value="false">Off</option><option value="true" ${v.snow ? 'selected' : ''}>On</option></select></div></div>
        <div class="form-grid">${field('min_holding', 'Min holding to vote', 'number')}${field('reserve_sol', 'Reserve SOL (fees)', 'number')}${field('next_billboard_target_usd', 'Next billboard target USD', 'number')}</div>
        <div style="margin-top:14px"><button class="btn primary">Save settings</button></div></form></div>

      <div class="section card"><h2>Design submissions <span class="pill pending">${pending.length} pending</span></h2>
        ${pending.length ? `<table>${pending.map((d) => `<tr><td style="width:150px"><a href="/design/${esc(d.id)}" target="_blank"><img src="${esc(d.thumb_url)}" style="width:140px;border-radius:8px"></a></td>
          <td><b>${esc(d.title)}</b><div class="meta">${d.x_handle ? '@' + esc(d.x_handle) + ' · ' : ''}${d.wallet ? 'holder ' + esc(short(d.wallet)) + ' (' + fmt(d.holder_balance, 0) + ') · ' : ''}${d.width}×${d.height}</div></td>
          <td style="text-align:right"><button class="btn small mint" data-dact="approve" data-id="${esc(d.id)}">Approve</button> <button class="btn small" data-dact="reject" data-id="${esc(d.id)}">Reject & delete</button></td></tr>`).join('')}</table>` : '<div class="meta">Nothing waiting.</div>'}
        <h2 style="margin-top:20px">Approved (${approved.length})</h2>
        <div class="row">${approved.map((d) => `<span class="pill">${esc(d.title)} ${d.official ? '★' : ''} <a href="#" data-dact="${d.official ? 'unofficial' : 'official'}" data-id="${esc(d.id)}">${d.official ? 'unmark official' : 'mark official'}</a></span>`).join('') || '<span class="meta">None</span>'}</div>
        <form id="of" class="row" style="margin-top:14px"><input name="title" placeholder="Official design title" style="flex:1;min-width:180px"><input type="file" name="image" accept="image/png,image/jpeg,image/webp" required style="flex:1;min-width:180px"><button class="btn">Upload official design</button></form></div>

      <div class="section grid" style="grid-template-columns:repeat(auto-fit,minmax(340px,1fr))">
      <div class="card"><h2>New vote round</h2><form id="rf"><label>Title *</label><input name="title" required placeholder="Where does billboard #1 go?">
        <label>Type</label><select name="kind"><option value="location">Location (where)</option><option value="design">Design (what goes on it)</option><option value="pair">Location + design pairs</option></select>
        <label>Description</label><input name="description"><label>Ends at *</label><input name="ends_at" type="datetime-local" value="${local}" required>
        <label>Candidates <span class="meta">(location name and/or an approved design)</span></label><div id="crows"></div>
        <button type="button" class="btn small" id="addrow">+ Add option</button>
        <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="allow_proposals" checked> Let holders propose locations (location rounds)</label>
        <div style="margin-top:12px"><button class="btn primary">Create round</button></div></form></div>
      <div class="card"><h2>Add billboard</h2><form id="bf"><div class="form-grid">
        <div><label>Location *</label><input name="location" required></div><div><label>City</label><input name="city"></div>
        <div><label>Run date *</label><input name="run_date" type="date" required></div><div><label>Run days</label><input name="run_days" type="number" min="1"></div>
        <div><label>Cost USD</label><input name="cost_usd" type="number" step="0.01"></div><div><label>Cost SOL</label><input name="cost_sol" type="number" step="0.0001"></div>
        <div><label>Vendor / network</label><input name="vendor" placeholder="Blip, AdQuick…"></div><div><label>Payment tx signature</label><input name="tx_sig"></div></div>
        <label>Photo</label><div class="row"><input name="photo_url" placeholder="URL or upload" style="flex:1"><label class="btn small" style="margin:0">Upload<input type="file" id="photo-file" accept="image/png,image/jpeg,image/webp" hidden></label></div>
        <label>Receipt / proof URL</label><input name="proof_url" type="url"><label>Notes</label><input name="notes">
        <div style="margin-top:12px"><button class="btn primary">Add billboard</button></div></form></div></div>

      <div class="section card"><h2>Rounds</h2>${rounds.map((r) => `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div class="row between"><b>#${r.round.id} ${esc(r.round.title)} <span class="pill">${esc(r.round.kind)}</span></b>
        <div class="row">${r.round.status === 'open' ? `<button class="btn small" data-close="${r.round.id}">Close & re-weigh</button>` : '<span class="pill">Closed</span>'}<a class="btn small" href="#" data-csv="${r.round.id}">Votes CSV</a></div></div>
        ${r.round.status === 'open' ? `<div class="row" style="margin-top:8px"><select data-add-design="${r.round.id}" style="max-width:260px">${designOpts}</select><input data-add-name="${r.round.id}" placeholder="Location (optional for design)" style="max-width:240px"><button class="btn small" data-add="${r.round.id}">Add option</button></div>` : ''}
        ${r.pending.map((p) => `<div class="row between" style="margin-top:8px"><span>Proposal: <b>${esc(p.name)}</b> <span class="mono">${esc(short(p.proposed_by))}</span></span><span class="row"><button class="btn small" data-capprove="${p.id}">Approve</button><button class="btn small" data-creject="${p.id}">Reject</button></span></div>`).join('')}</div>`).join('') || '<div class="meta">No rounds yet.</div>'}</div>
      <div class="section card"><h2>Billboards</h2><table>${boards.map((b) => `<tr><td>${esc(b.run_date)}</td><td>${esc(b.location)}</td><td>${usd(b.cost_usd)}</td><td style="text-align:right"><button class="btn small" data-del="${b.id}">Delete</button></td></tr>`).join('') || '<tr><td class="meta">None yet</td></tr>'}</table></div>`;

    const formObj = (f) => Object.fromEntries(new FormData(f).entries());
    const guard = (fn) => async (e) => { e?.preventDefault?.(); try { await fn(e); } catch (x) { toast(x.data?.errors ? Object.entries(x.data.errors).map(([k, m]) => `${k}: ${m}`).join('; ') : x.message, 'err'); } };
    $('#logout').onclick = () => { sessionStorage.removeItem('adminToken'); viewAdmin(); };
    $('#sf').onsubmit = guard(async (e) => {
      // only send fields that changed, so untouched fields keep following env vars
      const changed = Object.fromEntries(Object.entries(formObj(e.target)).filter(([k, val]) => String(v[k] ?? '') !== String(val)));
      if (!Object.keys(changed).length) return toast('Nothing changed');
      const body = JSON.stringify(changed);
      try { await A('/settings', { method: 'PUT', body }); }
      catch (x) { if (x.message.includes('force=1') && confirm(x.message + '\n\nSave anyway?')) await A('/settings?force=1', { method: 'PUT', body }); else throw x; }
      toast('Settings saved'); setTimeout(() => location.reload(), 600);
    });
    $('#mascot-file').onchange = guard(async (e) => { const r = await uploadMedia(e.target.files[0]); $('#sf').mascot_url.value = r.url; toast('Uploaded. Click Save settings.'); });
    $('#photo-file').onchange = guard(async (e) => { const r = await uploadMedia(e.target.files[0]); $('#bf').photo_url.value = r.url; toast('Photo uploaded'); });
    $('#of').onsubmit = guard(async (e) => { const fd = new FormData(e.target); await A('/designs', { method: 'POST', body: fd }); toast('Official design added'); viewAdmin(); });
    $$('[data-dact]').forEach((b) => b.onclick = guard(async () => {
      if (b.dataset.dact === 'reject' && !confirm('Reject and delete this design?')) return;
      await A(`/designs/${encodeURIComponent(b.dataset.id)}/${b.dataset.dact}`, { method: 'POST' }); toast('Done'); viewAdmin();
    }));
    const addRow = () => { const d = document.createElement('div'); d.className = 'cand-row'; d.innerHTML = `<input data-cname placeholder="Location, e.g. Miami, FL"><select data-cdesign>${designOpts}</select><button type="button" class="btn small" data-rm>✕</button>`; $('[data-rm]', d).onclick = () => d.remove(); $('#crows').append(d); };
    addRow(); addRow(); $('#addrow').onclick = addRow;
    $('#rf').onsubmit = guard(async (e) => {
      const o = formObj(e.target);
      const candidates = $$('.cand-row', e.target).map((r) => ({ name: $('[data-cname]', r).value.trim(), design_id: $('[data-cdesign]', r).value || null })).filter((c) => c.name || c.design_id);
      if (o.kind !== 'location' && candidates.some((c) => !c.design_id)) throw new Error('Design and pair rounds need a design on every option');
      if (o.kind === 'pair' && candidates.some((c) => !c.name)) throw new Error('Pair rounds need a location on every option');
      await A('/rounds', { method: 'POST', body: JSON.stringify({ title: o.title, description: o.description, kind: o.kind, ends_at: new Date(o.ends_at).toISOString(), allow_proposals: !!o.allow_proposals, candidates }) });
      toast('Round created'); viewAdmin();
    });
    $('#bf').onsubmit = guard(async (e) => { await A('/billboards', { method: 'POST', body: JSON.stringify(formObj(e.target)) }); toast('Billboard added'); viewAdmin(); });
    const on = (attr, fn) => $$(`[data-${attr}]`).forEach((b) => b.onclick = guard(async () => { b.disabled = true; try { if ((await fn(b.dataset[attr.replace(/-([a-z])/g, (m, c) => c.toUpperCase())])) !== false) viewAdmin(); } finally { b.disabled = false; } }));
    on('close', async (id) => { if (!confirm('Close this round and re-weigh all votes now?')) return false; await A(`/rounds/${id}/close`, { method: 'POST' }); toast('Round closed'); });
    on('capprove', (id) => A(`/candidates/${id}/approve`, { method: 'POST' }));
    on('creject', (id) => A(`/candidates/${id}/reject`, { method: 'POST' }));
    on('del', async (id) => { if (!confirm('Delete this billboard entry?')) return false; await A(`/billboards/${id}`, { method: 'DELETE' }); });
    on('add', (id) => A(`/rounds/${id}/candidates`, { method: 'POST', body: JSON.stringify({ name: $(`[data-add-name="${id}"]`).value.trim(), design_id: $(`[data-add-design="${id}"]`).value || null }) }));
    $$('[data-csv]').forEach((b) => b.onclick = async (e) => {
      e.preventDefault();
      const res = await fetch(`/api/admin/rounds/${b.dataset.csv}/votes.csv`, { headers: { 'x-admin-token': sessionStorage.getItem('adminToken') } });
      const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = `round-${b.dataset.csv}-votes.csv`; a.click();
    });
  }

  // ---------- router ----------
  const routes = { '': ['home', viewHome], vote: ['vote', viewVote], designs: ['designs', viewDesigns], billboards: ['billboards', viewBillboards], admin: ['admin', viewAdmin] };
  async function route() {
    clearTimers();
    const dm = location.pathname.match(/^\/design\/([\w-]+)$/);
    if (dm && !location.hash) { $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === 'designs')); return viewDesign(dm[1]); }
    if (location.pathname !== '/') { history.replaceState(null, '', '/' + location.hash); }
    const key = location.hash.replace(/^#\/?/, '').split('/')[0];
    const [tab, fn] = routes[key] || routes[''];
    $$('#tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === tab));
    try { await fn(); } catch (e) { app.innerHTML = `<div class="card">Error: ${esc(e.message)}</div>`; }
    window.scrollTo(0, 0);
  }
  (async () => {
    CFG = await api('/api/config');
    $('#demo-banner').hidden = !CFG.demo;
    $('#site-title').textContent = CFG.coinName ? (CFG.tokenSymbol ? '$' + CFG.tokenSymbol : CFG.coinName) : CFG.siteTitle;
    if (CFG.mascotUrl) { const i = $('#brand-img'); i.src = CFG.mascotUrl; i.hidden = false; $('#brand-logo').hidden = true; }
    $('#foot-links').innerHTML = socialLinks();
    $('#foot-ca').innerHTML = caBox();
    window.addEventListener('hashchange', route);
    route();
  })();
})();
