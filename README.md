# Billboard Fund: coin site

A small self-hosted site for a Solana memecoin whose **creator rewards pay for billboards**. It can go live **before launch** so the URL can go in the launch bio, and every coin detail gets filled in from the Admin page after launch. No redeploy needed.

- **Home:** mascot, headline, ticker, contract address with a copy button, links (website, X, TikTok, Telegram, DexScreener), live price and market cap (DexScreener), mint info read from chain, creator rewards balance, current ad designs, and billboards bought.
- **Vote:** holder-weighted voting on **where** the next billboard goes, **which design** goes on it, or **location + design pairs**. Holders connect Phantom/Solflare/Backpack and sign a free message. There's no transaction and no fee.
- **Designs:** anyone can upload a billboard design (PNG/JPG/WEBP, max 5 MB). Each submission gets a **Share to @RiseofMemes** button that opens an X post mentioning the review account, the ticker, and a link to the design's own page, which shows a link preview. The admin approves designs into the public gallery and can add them to a design vote.
- **Billboards:** the public record of every billboard bought, with cost, vendor, photo, receipt and payment tx.
- **Admin** (`/#/admin`): coin settings, mascot upload, design moderation, official designs, vote rounds, billboard entries.

The app **never holds a private key and never sends a transaction**. It only reads chain data.

## States

| State | When | What visitors see |
|---|---|---|
| **Pre-launch** | `TOKEN_MINT` empty | "Launching soon" + your pre-launch message. No CA (shows "posted at launch"). Voting disabled. **Design submissions work.** |
| **Live, rewards wallet not set** | mint set, `REWARDS_WALLET` empty | Price/market data + "Rewards wallet not set yet". No fake numbers. Voting works. |
| **Live** | both set | Everything, including rewards balance and the "available for next billboard" bar. |
| **Demo** | `DEMO=true` | Sample data with a yellow "Demo data" banner, a throwaway demo wallet, and admin token `demo-admin`. It uses its own DB file. |

## Run locally

```bash
npm install
cp .env.example .env        # set ADMIN_TOKEN
npm start                   # http://localhost:3000  (pre-launch until a mint is set)
npm test                    # signature, token-balance, upload-safety, settings tests
```

Preview a launched coin with the example config (Ansemmas):

```bash
DOTENV_CONFIG_PATH=.env.ansemmas.example PORT=3001 npm start
```

Requires **Node 22.13+** (uses built-in `node:sqlite`).

## After launch: fill in the coin (no redeploy)

Open `https://your-site/#/admin`, enter `ADMIN_TOKEN`, and set these under **Coin & site settings**:
coin name, ticker, **token mint (CA)**, **rewards wallet** (public address), headline (e.g. "Merry Ansemmas"), tagline, mascot (upload), website/X/TikTok/Telegram/DexScreener links, and colors + snow effect. Hit **Save**. The site updates instantly.

Every setting can also come from an env var (see `.env.example`). Values saved in Admin override env. Clear a field to fall back to env/default.

Then:
1. **Designs:** upload your official ad designs (Admin → *Upload official design*). They show as "Current ad designs" on Home.
2. **Votes:** Admin → *New vote round*. Pick a type (Location / Design / Location + design), add options (a location name and/or an approved design), and set an end time.
3. **Billboards:** after buying one, Admin → *Add billboard* (cost, vendor, photo upload, receipt link, payment tx).

**About rewards:** creator fees build up in a creator vault and have to be **claimed** into your wallet. The dashboard reads the SOL balance of `REWARDS_WALLET`, so use a dedicated wallet that only holds rewards.

## Deploy on Render (not done for you)

`render.yaml` is a Render Blueprint: one Node web service plus a **1 GB persistent disk** at `/var/data` for the SQLite DB and uploaded designs.

What **you** need to do:
1. Put this folder in a GitHub repo (private is fine).
2. Create a Render account at render.com and choose **New → Blueprint**, then pick the repo. It reads `render.yaml`.
3. The **Starter** plan (~$7/mo) is required because free instances can't have disks and would lose votes and uploads.
4. Environment variables in Render (Dashboard → service → Environment):
   - `ADMIN_TOKEN`: Render auto-generates it (`generateValue`). **Copy it** from the Environment tab; it's your admin password.
   - `PUBLIC_URL`: your Render URL (e.g. `https://billboard-fund.onrender.com`) or a custom domain. It's used in share-to-X links.
   - `TOKEN_MINT` / `REWARDS_WALLET`: leave empty before launch, or set them later in Admin.
   - Optional: `RPC_URL` with a free Helius/QuickNode key (the public RPC is rate limited).
5. Deploy, open `/#/admin`, and fill in the coin details.
6. Optional: add a custom domain in Render → Settings → Custom Domains.

Other hosts: anything with a persistent disk works (Railway volume, Fly.io volume plus the included `Dockerfile`, or a $5 VPS with Caddy). Set `DB_PATH` and `UPLOAD_DIR` to the disk.

## Voting: how it works

1. The browser builds a plain-text message (action, token mint, round, choice, wallet, timestamp) and the wallet signs it (`signMessage`).
2. The server (`src/verify.js`) checks:
   - the ed25519 signature (tweetnacl);
   - that every field matches the request, so a signature can't be reused for another choice, round or coin;
   - that the timestamp is less than 10 minutes old and newer than the wallet's last vote (replay guard).
3. The server reads the balance with `getTokenAccountsByOwner` (jsonParsed + mint filter, works for SPL **and Token-2022**) and requires `MIN_HOLDING`.
4. One vote per wallet per round. Voting again replaces the old vote until the round closes.
5. **At close** (automatic at the end time, or Admin → *Close & re-weigh*), each vote is re-weighed. Final weight = `min(balance at vote, balance at close)`, and 0 if the wallet is under the minimum at close.
6. Results show token-weighted % and a one-wallet-one-vote count. All signed votes are public at `/api/rounds/:id/audit`. Admins can export a CSV.

**Known weaknesses:**
- Re-weighing blunts buy-vote-sell, but someone could still move tokens between wallets right around the close. A real per-slot snapshot needs an indexer such as Helius, which isn't included.
- Splitting tokens across wallets inflates the wallet count, not the token weight.
- The admin picks the candidates and records spending. Receipts, tx links and the audit feed are what keep that honest.

## Security notes

- No private keys, seed phrases or transactions. Tell holders: **this site never asks you to approve a transaction**. Clones that do are scams.
- Admin endpoints need the `x-admin-token` header (constant-time compare). Use a long random token over HTTPS only.
- **Uploads:**
  - the type is detected by **magic bytes** (PNG/JPEG/WEBP only; SVG, GIF and HTML are rejected);
  - every file is decoded and **re-encoded with sharp**, which strips EXIF/GPS metadata and anything appended to the file;
  - size limit 5 MB, 50 MP pixel cap, 200 px minimum, resized to max 4096 px;
  - random 12-character IDs;
  - rate limits of 3 uploads per 10 minutes per IP and 5 pending per IP, plus a global pending cap;
  - served with `nosniff`, a sandbox CSP and `noindex`;
  - rejected designs are deleted from disk.
- Pending designs are viewable by direct link (so the share-to-X link works) but are labeled "Pending review, not endorsed". They stay out of the gallery until approved.
- A strict CSP allows no inline or third-party scripts, and all user text is HTML-escaped.
- Back up the disk (DB + uploads).

## Legal / honesty

Check ad-network and local rules for crypto billboard ads. Don't promise holders returns. Keep records of rewards and ad spend for taxes. Design submitters should only upload work they have rights to.

## Files

```
src/server.js      Express app: public API, signed vote/propose, design uploads, admin API, HTML shell with link-preview tags
src/settings.js    Coin/site settings (admin DB > env > default) + validation
src/uploads.js     Magic-byte check, sharp re-encode, thumbnails
src/verify.js      Signed-message format + ed25519 verification
src/solana.js      Read-only RPC (SOL balance, token balance, mint info) + CoinGecko + DexScreener
src/db.js          SQLite schema/migrations (node:sqlite), demo + example data
src/config.js      Infra env (port, DB, uploads, admin token, RPC)
public/            Single-page frontend; public/examples/ansemmas/ = example mascot + ad designs
test/              node --test unit tests
scripts/           screenshot.js, real-mint-vote-check.mjs
render.yaml        Render Blueprint (web service + disk)
.env.example       Generic config (pre-launch)
.env.ansemmas.example   Example config for a launched coin
```
