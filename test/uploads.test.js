import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectImageType, processImage } from '../src/uploads.js';
import { validateSettings } from '../src/settings.js';

const dir = mkdtempSync(join(tmpdir(), 'up-'));
const make = (fmt, w = 800, h = 450) => sharp({ create: { width: w, height: h, channels: 3, background: '#d62b35' } })[fmt]().toBuffer();

test('magic bytes: png / jpeg / webp detected, others rejected', async () => {
  assert.equal(detectImageType(await make('png')), 'png');
  assert.equal(detectImageType(await make('jpeg')), 'jpeg');
  assert.equal(detectImageType(await make('webp')), 'webp');
  assert.equal(detectImageType(Buffer.from('GIF89a........')), null);
  assert.equal(detectImageType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), null);
  assert.equal(detectImageType(Buffer.from('<html><script>alert(1)</script></html>')), null);
});

test('processImage accepts a valid png and writes file + thumbnail', async () => {
  const r = await processImage(await make('png', 1920, 1080), { dir });
  assert.equal(r.mime, 'image/png');
  assert.equal(r.width, 1920);
  assert.ok(existsSync(join(dir, r.file)) && existsSync(join(dir, r.thumb)));
  assert.match(r.id, /^[\w-]{12}$/);
});

test('processImage strips EXIF metadata', async () => {
  const withExif = await sharp(await make('jpeg')).withExif({ IFD0: { Copyright: 'secret-gps-here' } }).jpeg().toBuffer();
  assert.ok(withExif.includes(Buffer.from('secret-gps-here')));
  const r = await processImage(withExif, { dir });
  const out = readFileSync(join(dir, r.file));
  assert.ok(!out.includes(Buffer.from('secret-gps-here')));
  assert.equal((await sharp(out).metadata()).exif, undefined);
});

test('processImage rejects wrong type, oversize, tiny, corrupt and appended payloads are dropped', async () => {
  await assert.rejects(processImage(Buffer.from('GIF89a' + 'x'.repeat(100)), { dir }), /Only PNG, JPG or WEBP/);
  await assert.rejects(processImage(await make('png'), { dir, maxBytes: 100 }), /too large/);
  await assert.rejects(processImage(await make('png', 50, 50), { dir }), /too small/);
  const png = await make('png');
  await assert.rejects(processImage(png.subarray(0, 60), { dir }), /could not be read|corrupt/i);
  const polyglot = Buffer.concat([png, Buffer.from('<script>alert(1)</script>')]);
  const r = await processImage(polyglot, { dir });
  assert.ok(!readFileSync(join(dir, r.file)).includes(Buffer.from('<script>')));
});

test('settings validation', () => {
  const ok = validateSettings({ token_mint: 'HXxJdaQbrYRvwTAM8M8mUPyoRPvmyuUbPFBRkiAAMASS', token_symbol: '$ansemmas', theme_primary: '#d62b35', x_url: 'https://x.com/Ansemmas', review_x_handle: '@RiseofMemes', mascot_url: '/uploads/media/abc.webp', coin_name: '' });
  assert.deepEqual(ok.errors, {});
  assert.equal(ok.values.token_symbol, 'ANSEMMAS');
  assert.equal(ok.values.review_x_handle, 'RiseofMemes');
  assert.equal(ok.values.coin_name, null); // empty clears
  const bad = validateSettings({ token_mint: 'nope', x_url: 'javascript:alert(1)', theme_accent: 'red', mascot_url: '/uploads/../../etc/passwd', min_holding: '-5' });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['mascot_url', 'min_holding', 'theme_accent', 'token_mint', 'x_url']);
});
