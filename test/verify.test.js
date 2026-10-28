import { test } from 'node:test';
import assert from 'node:assert/strict';
import nacl from 'tweetnacl';
import * as bs58 from '../src/base58.js';
import { buildMessage, parseMessage, verifySignature, verifySignedAction, isValidPublicKey } from '../src/verify.js';
import { sumParsedTokenAccounts, getTokenBalanceLive } from '../src/solana.js';

const kp = nacl.sign.keyPair();
const wallet = bs58.encode(kp.publicKey);
const sign = (msg, sk = kp.secretKey) => Buffer.from(nacl.sign.detached(new TextEncoder().encode(msg), sk)).toString('base64');
const MINT = 'So11111111111111111111111111111111111111112';
const msgFor = (over = {}) => buildMessage({ Action: 'vote', Mint: MINT, Round: 2, Candidate: 7, Wallet: wallet, Timestamp: new Date().toISOString(), ...over });
const expected = { Action: 'vote', Mint: MINT, Round: 2, Candidate: 7 };

test('base58 round trip and known vector', () => {
  const bytes = new Uint8Array([0, 0, 1, 2, 3, 255]);
  assert.deepEqual(bs58.decode(bs58.encode(bytes)), bytes);
  assert.equal(bs58.encode(new Uint8Array(32)), '11111111111111111111111111111111');
  assert.equal(bs58.decode('So11111111111111111111111111111111111111112').length, 32);
  assert.throws(() => bs58.decode('0OIl'));
});

test('isValidPublicKey', () => {
  assert.ok(isValidPublicKey(wallet));
  assert.ok(!isValidPublicKey('abc'));
  assert.ok(!isValidPublicKey('not-base58-0OIl'));
});

test('valid signature verifies (base64 and base58 encodings)', () => {
  const m = msgFor();
  assert.ok(verifySignature(m, sign(m), wallet));
  const sig58 = bs58.encode(nacl.sign.detached(new TextEncoder().encode(m), kp.secretKey));
  assert.ok(verifySignature(m, sig58, wallet));
});

test('tampered message, wrong key, garbage signature all fail', () => {
  const m = msgFor();
  const sig = sign(m);
  assert.equal(verifySignature(m.replace('Candidate: 7', 'Candidate: 8'), sig, wallet), false);
  const other = bs58.encode(nacl.sign.keyPair().publicKey);
  assert.equal(verifySignature(m, sig, other), false);
  assert.equal(verifySignature(m, 'garbage', wallet), false);
  assert.equal(verifySignature(m, Buffer.alloc(64).toString('base64'), wallet), false);
  assert.equal(verifySignature(m, sig, 'bad'), false);
});

test('parseMessage rejects missing header/footer', () => {
  assert.equal(parseMessage('Action: vote'), null);
  assert.equal(parseMessage(msgFor()).Candidate, '7');
});

test('verifySignedAction: happy path', () => {
  const m = msgFor();
  const r = verifySignedAction({ message: m, signature: sign(m), wallet, expected });
  assert.ok(r.ok, r.error);
});

test('verifySignedAction: field mismatch (signed for another candidate/round/mint)', () => {
  const m = msgFor({ Candidate: 9 });
  assert.match(verifySignedAction({ message: m, signature: sign(m), wallet, expected }).error, /Candidate/);
  const m2 = msgFor({ Round: 1 });
  assert.match(verifySignedAction({ message: m2, signature: sign(m2), wallet, expected }).error, /Round/);
  const m3 = msgFor({ Mint: 'OtherMint' });
  assert.match(verifySignedAction({ message: m3, signature: sign(m3), wallet, expected }).error, /Mint/);
});

test('verifySignedAction: someone else signs claiming my wallet', () => {
  const attacker = nacl.sign.keyPair();
  const m = msgFor();
  const r = verifySignedAction({ message: m, signature: sign(m, attacker.secretKey), wallet, expected });
  assert.equal(r.ok, false);
  assert.match(r.error, /Signature/);
});

test('verifySignedAction: wallet in message must match claimed wallet', () => {
  const other = nacl.sign.keyPair();
  const m = msgFor({ Wallet: bs58.encode(other.publicKey) });
  const r = verifySignedAction({ message: m, signature: sign(m, other.secretKey), wallet, expected });
  assert.match(r.error, /wallet mismatch/);
});

test('verifySignedAction: expired and future timestamps rejected', () => {
  const old = msgFor({ Timestamp: new Date(Date.now() - 11 * 60_000).toISOString() });
  assert.match(verifySignedAction({ message: old, signature: sign(old), wallet, expected }).error, /expired/);
  const fut = msgFor({ Timestamp: new Date(Date.now() + 11 * 60_000).toISOString() });
  assert.match(verifySignedAction({ message: fut, signature: sign(fut), wallet, expected }).error, /expired/);
});

test('buildMessage rejects newline injection', () => {
  assert.throws(() => buildMessage({ Location: 'x\nCandidate: 1' }));
});

test('token balance: sums parsed token accounts (mocked RPC)', async () => {
  const fake = { value: [
    { account: { data: { parsed: { info: { tokenAmount: { uiAmountString: '1500.5', uiAmount: 1500.5 } } } } } },
    { account: { data: { parsed: { info: { tokenAmount: { uiAmountString: '0.5', uiAmount: 0.5 } } } } } },
  ] };
  assert.equal(sumParsedTokenAccounts(fake), 1501);
  assert.equal(sumParsedTokenAccounts({ value: [] }), 0);
  let called;
  const bal = await getTokenBalanceLive(wallet, MINT, async (method, params) => { called = { method, params }; return fake; });
  assert.equal(bal, 1501);
  assert.equal(called.method, 'getTokenAccountsByOwner');
  assert.equal(called.params[2].encoding, 'jsonParsed');
  assert.deepEqual(called.params[1], { mint: MINT });
});
