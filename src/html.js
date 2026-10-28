function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function renderHtml(cfg, { origin = '', path = '/' } = {}) {
  const title = cfg.siteTitle || 'Merry Ansemmas';
  const description = cfg.tagline || '';
  const mascot = cfg.mascotUrl || '';
  const socialImage = mascot && mascot !== '/mascot.webp'
    ? (mascot.startsWith('http') ? mascot : origin + mascot)
    : origin + '/og.jpg';
  const image = socialImage;
  const url = origin + (path || '/');
  const theme = cfg.theme || {};
  const snow = theme.snow ? 'snow' : '';
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <meta name="theme-color" content="${esc(theme.primary || '#d0122d')}" />
  <meta property="og:type" content="website" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${esc(url)}" />
  <meta property="og:image" content="${esc(image)}" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content="${esc(title)}" />
  <meta name="twitter:description" content="${esc(description)}" />
  <meta name="twitter:image" content="${esc(image)}" />
  <link rel="icon" href="/favicon.png" type="image/png" />
  <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
  <link rel="stylesheet" href="/styles.css" />
  <style>:root{--primary:${esc(theme.primary || '#d0122d')};--secondary:${esc(theme.secondary || '#146b3a')};--accent:${esc(theme.accent || '#f0c14a')}}</style>
</head>
<body class="${snow}">
  <div id="demo-banner" class="demo-banner" hidden>Demo data: sample numbers and votes, not real results.</div>
  <header class="top">
    <a class="brand" href="/#/"><img id="brand-img" alt="" hidden><span class="logo" id="brand-logo">★</span><span id="site-title"></span></a>
    <nav class="tabs" id="tabs">
      <a href="/#/" data-tab="home">Home</a>
      <a href="/#/vote" data-tab="vote">Vote</a>
      <a href="/#/designs" data-tab="designs">Designs</a>
      <a href="/#/billboards" data-tab="billboards">Billboards</a>
    </nav>
  </header>
  <main id="app"><div class="card">Loading…</div></main>
  <footer class="foot">
    <div id="foot-links" class="socials"></div>
    <div id="foot-ca"></div>
    <div>Read-only tracker. This site never asks you to approve a transaction or share a key. Voting only signs a free message. <a href="/#/admin" class="admin-link">Admin</a></div>
  </footer>
  <div id="toast" class="toast" hidden></div>
  <script src="/vendor/nacl.min.js"></script>
  <script src="/app.js"></script>
</body>
</html>`;
}
