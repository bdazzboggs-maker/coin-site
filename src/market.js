export function createMarket({ fetchImpl = fetch, ttlMs = 20000 } = {}) {
  const cache = new Map();
  async function cached(key, loader) {
    const hit = cache.get(key);
    if (hit && hit.until > Date.now()) return hit.value;
    const value = await loader();
    cache.set(key, { value, until: Date.now() + ttlMs });
    return value;
  }
  return {
    async getSolUsd() {
      return cached('sol', async () => {
        const res = await fetchImpl('https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd', {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`Price HTTP ${res.status}`);
        const json = await res.json();
        const usd = Number(json?.solana?.usd);
        if (!Number.isFinite(usd)) throw new Error('Price missing');
        return usd;
      });
    },
    async getMarket(mint) {
      if (!mint) return null;
      return cached('mint:' + mint, async () => {
        const res = await fetchImpl(`https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(mint)}`, {
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) throw new Error(`Market HTTP ${res.status}`);
        const json = await res.json();
        const pairs = (json.pairs || []).filter((p) => p.chainId === 'solana');
        if (!pairs.length) return null;
        pairs.sort((a, b) => Number(b.liquidity?.usd || 0) - Number(a.liquidity?.usd || 0));
        const pair = pairs[0];
        const change = pair.priceChange?.h24;
        return {
          priceUsd: Number(pair.priceUsd),
          marketCap: Number(pair.marketCap ?? pair.fdv ?? 0),
          liquidityUsd: Number(pair.liquidity?.usd || 0),
          change24h: change === undefined || change === null ? null : Number(change),
        };
      });
    },
  };
}
