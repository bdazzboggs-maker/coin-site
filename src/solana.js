import nacl from 'tweetnacl';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const DEFAULT_RPC = 'https://api.mainnet-beta.solana.com';
const SPL = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';

export function b58decode(str) {
  if (typeof str !== 'string' || !str.length) return null;
  const bytes = [0];
  for (let i = 0; i < str.length; i++) {
    const val = B58.indexOf(str[i]);
    if (val < 0) return null;
    let carry = val;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (let k = 0; str[k] === '1' && k < str.length - 1; k++) bytes.push(0);
  return Uint8Array.from(bytes.reverse());
}

export function b58encode(bytes) {
  const src = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  if (!src.length) return '';
  const digits = [0];
  for (let i = 0; i < src.length; i++) {
    let carry = src[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = '';
  for (let k = 0; src[k] === 0 && k < src.length - 1; k++) out += '1';
  for (let q = digits.length - 1; q >= 0; q--) out += B58[digits[q]];
  return out;
}

export function isSolanaAddress(value) {
  const bytes = b58decode(String(value || '').trim());
  return Boolean(bytes && bytes.length === 32);
}

export function verifySignature(message, signatureB64, wallet) {
  const pub = b58decode(wallet);
  if (!pub || pub.length !== 32) return false;
  let sig;
  try {
    sig = Buffer.from(String(signatureB64 || ''), 'base64');
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  try {
    return nacl.sign.detached.verify(new TextEncoder().encode(String(message)), sig, pub);
  } catch {
    return false;
  }
}

export function parseSignedMessage(text, cfg) {
  const lines = String(text ?? '').split('\n');
  if (lines.length < 3) return null;
  if (lines[0] !== cfg.message.header) return null;
  if (lines[lines.length - 1] !== cfg.message.footer) return null;
  const fields = {};
  for (const line of lines.slice(1, -1)) {
    const i = line.indexOf(': ');
    if (i <= 0) return null;
    fields[line.slice(0, i)] = line.slice(i + 2);
  }
  return fields;
}

const SKEW_MS = 10 * 60 * 1000;

export function freshTimestamp(value, now = Date.now()) {
  const t = Date.parse(value || '');
  if (Number.isNaN(t)) return false;
  return Math.abs(now - t) <= SKEW_MS;
}

async function rpc(rpcUrl, method, params, fetchImpl) {
  const res = await fetchImpl(rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Solana RPC HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'Solana RPC error');
  return json.result;
}

export function createSolana({ rpcUrl = DEFAULT_RPC, demo = false, fetchImpl = fetch } = {}) {
  if (demo) {
    return {
      demo: true,
      async getSolBalance() {
        return 12.5;
      },
      async getTokenBalance(owner) {
        let n = 0;
        for (const ch of String(owner)) n = (n * 33 + ch.charCodeAt(0)) >>> 0;
        return 100000 + (n % 900000);
      },
      async getMintInfo() {
        return { supply: 1_000_000_000, decimals: 6, program: 'spl-token', mintAuthority: null };
      },
    };
  }
  return {
    demo: false,
    async getSolBalance(address) {
      const result = await rpc(rpcUrl, 'getBalance', [address], fetchImpl);
      return Number(result?.value || 0) / 1e9;
    },
    async getTokenBalance(owner, mint) {
      const result = await rpc(rpcUrl, 'getTokenAccountsByOwner', [owner, { mint }, { encoding: 'jsonParsed' }], fetchImpl);
      let total = 0;
      for (const acc of result?.value || []) {
        const amount = acc?.account?.data?.parsed?.info?.tokenAmount;
        const ui = amount?.uiAmountString ?? amount?.uiAmount;
        total += Number(ui || 0);
      }
      return total;
    },
    async getMintInfo(mint) {
      const result = await rpc(rpcUrl, 'getAccountInfo', [mint, { encoding: 'jsonParsed' }], fetchImpl);
      const value = result?.value;
      if (!value) return null;
      const parsed = value.data?.parsed;
      if (!parsed || parsed.type !== 'mint') return null;
      const info = parsed.info || {};
      const decimals = Number(info.decimals || 0);
      const raw = Number(info.supply || 0);
      const supply = decimals ? raw / 10 ** decimals : raw;
      const owner = value.owner;
      const program = owner === TOKEN_2022 || parsed.program === 'spl-token-2022'
        ? 'spl-token-2022'
        : (owner === SPL || parsed.program === 'spl-token' ? 'spl-token' : (parsed.program || 'spl-token'));
      return {
        supply,
        decimals,
        program,
        mintAuthority: info.mintAuthority || null,
      };
    },
  };
}
