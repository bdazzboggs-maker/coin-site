// Minimal base58 (Bitcoin alphabet), used for Solana public keys and signatures.
const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAP = new Map([...ALPHABET].map((c, i) => [c, i]));

export function encode(bytes) {
  bytes = Uint8Array.from(bytes);
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry) { digits.push(carry % 58); carry = (carry / 58) | 0; }
  }
  return '1'.repeat(zeros) + digits.reverse().map((d) => ALPHABET[d]).join('');
}

export function decode(str) {
  if (typeof str !== 'string') throw new Error('base58: not a string');
  let zeros = 0;
  while (zeros < str.length && str[zeros] === '1') zeros++;
  const bytes = [];
  for (let i = zeros; i < str.length; i++) {
    const v = MAP.get(str[i]);
    if (v === undefined) throw new Error('base58: invalid character');
    let carry = v;
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) { bytes.push(carry & 0xff); carry >>= 8; }
  }
  return Uint8Array.from([...new Array(zeros).fill(0), ...bytes.reverse()]);
}
