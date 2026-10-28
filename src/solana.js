// Read-only chain + market data. No keys, no transactions.
import { config } from './config.js';
import { createHash } from 'node:crypto';

let rpcId = 0;
export async function rpc(method, params, { url = config.RPC_URL, timeoutMs = 10000 } = {}) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(`RPC ${json.error.code}: ${json.error.message}`);
  return json.result;
}

const cached = new Map();
async function memo(key, ttlMs, fn) {
  const c = cached.get(key);
  if (c && Date.now() - c.at < ttlMs) return c.value;
  const value = await fn();
  cached.set(key, { at: Date.now(), value });
  return value;
}

export async function getSolBalance(address) {
  const r = await rpc('getBalance', [address, { commitment: 'confirmed' }]);
  return r.value / 1e9;
}

/** Sum UI amounts across a wallet's token accounts for one mint (jsonParsed RPC result). */
export function sumParsedTokenAccounts(result) {
  let total = 0;
  for (const acc of result?.value || []) {
    const amt = acc?.account?.data?.parsed?.info?.tokenAmount;
    if (amt) total += Number(amt.uiAmountString ?? amt.uiAmount ?? 0);
  }
  return total;
}

/** Token balance via getTokenAccountsByOwner + mint filter. Works for SPL Token and Token-2022. */
export async function getTokenBalanceLive(owner, mint, rpcFn = rpc) {
  const result = await rpcFn('getTokenAccountsByOwner', [owner, { mint }, { commitment: 'confirmed', encoding: 'jsonParsed' }]);
  return sumParsedTokenAccounts(result);
}

/** Demo: deterministic fake balance per wallet (50k - 5M tokens). */
export function demoTokenBalance(owner) {
  const h = createHash('sha256').update(owner).digest();
  return 50000 + (h.readUInt32BE(0) % 4950000);
}

export async function getTokenBalance(owner, mint) {
  if (config.DEMO) return demoTokenBalance(owner);
  if (!mint) throw new Error('Token not launched yet');
  return getTokenBalanceLive(owner, mint);
}

// --- SOL price (CoinGecko), cached 60s, fails gracefully ---
let priceCache = { usd: null, at: 0, source: null };
export async function getSolUsd() {
  if (Date.now() - priceCache.at < 60_000 && priceCache.usd) return priceCache;
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', { signal: AbortSignal.timeout(6000) });
    const usd = Number((await res.json())?.solana?.usd);
    if (!usd) throw new Error('no price');
    priceCache = { usd, at: Date.now(), source: 'coingecko' };
  } catch {
    priceCache = { ...priceCache, at: Date.now() - 30_000 };
  }
  return priceCache;
}

/** Rewards wallet SOL balance, cached 30s. notSet when no wallet configured (no fake numbers). */
export async function getRewardsBalance(wallet) {
  if (config.DEMO) return { sol: 7.4213, error: null, demo: true };
  if (!wallet) return { sol: null, error: null, notSet: true };
  try { return { sol: await memo('bal:' + wallet, 30_000, () => getSolBalance(wallet)), error: null }; }
  catch (e) { return { sol: null, error: e.message }; }
}

/** Mint account read from chain: program, decimals, supply, authorities, on-chain metadata. Cached 10 min. */
export async function getMintInfo(mint) {
  return memo('mint:' + mint, 600_000, async () => {
    const r = await rpc('getAccountInfo', [mint, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    const v = r?.value;
    if (!v || v.data?.parsed?.type !== 'mint') throw new Error('Mint account not found on chain');
    const info = v.data.parsed.info;
    const meta = (info.extensions || []).find((e) => e.extension === 'tokenMetadata')?.state;
    return {
      program: v.data.program, decimals: info.decimals,
      supply: Number(info.supply) / 10 ** info.decimals,
      mintAuthority: info.mintAuthority, freezeAuthority: info.freezeAuthority,
      name: meta?.name || null, symbol: meta?.symbol || null,
    };
  });
}

/** Price / market cap / liquidity from DexScreener (deepest Solana pair). Cached 60s, null on failure. */
export async function getDexStats(mint) {
  try {
    return await memo('dex:' + mint, 60_000, async () => {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`, { signal: AbortSignal.timeout(6000) });
      const j = await res.json();
      const pairs = (j.pairs || []).filter((p) => p.chainId === 'solana' && p.priceUsd)
        .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
      const p = pairs[0];
      return p ? { priceUsd: Number(p.priceUsd), marketCap: p.marketCap ?? p.fdv ?? null, liquidityUsd: p.liquidity?.usd ?? null, change24h: p.priceChange?.h24 ?? null, volume24h: p.volume?.h24 ?? null, pairUrl: p.url } : null;
    });
  } catch { return null; }
}
