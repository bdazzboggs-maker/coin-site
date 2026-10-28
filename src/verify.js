// Wallet-ownership proof: holder signs a plain-text message (no transaction, no fee).
import nacl from 'tweetnacl';
import * as bs58 from './base58.js';

export const MESSAGE_HEADER = 'Billboard Fund - holder signature';
export const MESSAGE_FOOTER = 'Signing this message is free. It does not send a transaction or give access to your funds.';

/** Build the canonical message a wallet signs. Field order is fixed. */
export function buildMessage(fields) {
  const lines = [MESSAGE_HEADER];
  for (const [k, v] of Object.entries(fields)) {
    if (String(v).includes('\n')) throw new Error(`field ${k} contains newline`);
    lines.push(`${k}: ${v}`);
  }
  lines.push(MESSAGE_FOOTER);
  return lines.join('\n');
}

/** Parse "Key: value" lines from a signed message. */
export function parseMessage(message) {
  const lines = String(message).split('\n');
  if (lines[0] !== MESSAGE_HEADER || lines[lines.length - 1] !== MESSAGE_FOOTER) return null;
  const out = {};
  for (const line of lines.slice(1, -1)) {
    const i = line.indexOf(': ');
    if (i < 1) return null;
    out[line.slice(0, i)] = line.slice(i + 2);
  }
  return out;
}

export function isValidPublicKey(pk) {
  try { return bs58.decode(pk).length === 32; } catch { return false; }
}

function decodeSignature(sig) {
  if (sig instanceof Uint8Array) return sig;
  if (typeof sig !== 'string') throw new Error('signature must be a string');
  // accept base64 (what the frontend sends) or base58
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(sig) && sig.length % 4 === 0) {
    const b = Buffer.from(sig, 'base64');
    if (b.length === 64) return new Uint8Array(b);
  }
  return bs58.decode(sig);
}

/** Verify an ed25519 signature of `message` (utf8) by base58 `publicKey`. Never throws. */
export function verifySignature(message, signature, publicKey) {
  try {
    const pk = bs58.decode(publicKey);
    const sig = decodeSignature(signature);
    if (pk.length !== 32 || sig.length !== 64) return false;
    return nacl.sign.detached.verify(new TextEncoder().encode(message), sig, pk);
  } catch {
    return false;
  }
}

/**
 * Full check of a signed holder action.
 * expected: fields that must match exactly (Action, Round, Wallet, ...).
 * Returns { ok, error, fields, timestamp }.
 */
export function verifySignedAction({ message, signature, wallet, expected = {}, maxAgeMs = 10 * 60 * 1000, now = Date.now() }) {
  if (!isValidPublicKey(wallet)) return { ok: false, error: 'Invalid wallet address' };
  const fields = parseMessage(message);
  if (!fields) return { ok: false, error: 'Malformed message' };
  if (fields.Wallet !== wallet) return { ok: false, error: 'Message wallet mismatch' };
  for (const [k, v] of Object.entries(expected)) {
    if (fields[k] !== String(v)) return { ok: false, error: `Message field "${k}" mismatch` };
  }
  const ts = Date.parse(fields.Timestamp);
  if (!Number.isFinite(ts)) return { ok: false, error: 'Missing timestamp' };
  if (Math.abs(now - ts) > maxAgeMs) return { ok: false, error: 'Signature expired, please sign again' };
  if (!verifySignature(message, signature, wallet)) return { ok: false, error: 'Signature verification failed' };
  return { ok: true, fields, timestamp: ts };
}
