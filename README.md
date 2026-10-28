# Ansemmas

Community site for **Ansemmas** (`$ANSEMMAS` on Solana). Creator rewards buy real billboards. Holders vote on where they go and which design runs, weighted by token balance. Design submissions are shared to [@RiseofMemes](https://x.com/RiseofMemes) for review.

The site ships in **coming soon** mode. The coin name, ticker, Christmas theme, mascot, and social links are filled in. The token mint and rewards wallet stay empty until you set them on the admin page, so rewards tracking and holder voting stay closed.

## Run

```bash
npm install
npm start
```

Open http://localhost:3000. Tests:

```bash
npm test
```

Requires Node 22 or newer.

## Launch the new coin

Set these on `/#/admin` (header `x-admin-token`, or the `ADMIN_TOKEN` env var) when the contract and rewards wallet are ready:

- Token mint / contract address
- Rewards wallet (public address only)

Leave them blank and the homepage stays on the coming-soon state. Clearing a saved field falls back to the environment variable, then the built-in default. Changing the mint after votes exist asks you to confirm with `force=1`.

Copy `.env.example` if you want to override defaults. `.env.ansemmas.example` lists the Ansemmas branding. Do not put an old contract or DexScreener pair into `TOKEN_MINT` or `REWARDS_WALLET`.

| Variable | Purpose |
| --- | --- |
| `ADMIN_TOKEN` | Unlocks `/#/admin` |
| `TOKEN_MINT` | Solana mint. Empty means coming soon |
| `REWARDS_WALLET` | Public wallet that receives creator rewards |
| `SOLANA_RPC_URL` | RPC used for balances and mint info |
| `DATABASE_PATH` | SQLite file (default `data/site.db`) |
| `UPLOAD_DIR` | Design and photo uploads |
| `PUBLIC_URL` | Canonical origin for share links and social cards |
| `DEMO` | `1` shows sample balances and accepts admin token `demo-admin` |

Voting asks for a free wallet signature. The server checks it and reads the holder's balance. It never asks for a seed phrase or a transaction.

## Deploy

`render.yaml` is a starting point for Render. Put the SQLite file and uploads on a persistent disk (`DATABASE_PATH` and `UPLOAD_DIR`). Set `ADMIN_TOKEN` in the host's secret store, not in git.
