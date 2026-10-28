import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';

const TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

export function newId() {
  return randomBytes(9).toString('base64url');
}

function sniff(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  return null;
}

export async function saveImage(buffer, uploadDir, claimedType) {
  const sniffed = sniff(buffer);
  if (!sniffed || (claimedType && TYPES[claimedType] && claimedType !== sniffed)) {
    const err = new Error('Only PNG, JPG or WEBP');
    err.status = 415;
    throw err;
  }
  const meta = await sharp(buffer, { failOn: 'error' }).metadata();
  if (!meta.width || !meta.height) {
    const err = new Error('Could not read that image');
    err.status = 400;
    throw err;
  }
  fs.mkdirSync(uploadDir, { recursive: true });
  const id = newId();
  const ext = TYPES[sniffed];
  const imageName = `${id}.${ext}`;
  const thumbName = `${id}-thumb.webp`;
  await sharp(buffer).toFile(path.join(uploadDir, imageName));
  await sharp(buffer)
    .resize({ width: 960, withoutEnlargement: true })
    .webp({ quality: 80 })
    .toFile(path.join(uploadDir, thumbName));
  return {
    id,
    image_url: `/uploads/${imageName}`,
    thumb_url: `/uploads/${thumbName}`,
    width: meta.width,
    height: meta.height,
    files: [imageName, thumbName],
  };
}

export function removeUpload(uploadDir, url) {
  if (!url || !url.startsWith('/uploads/')) return;
  const name = path.basename(url);
  if (!/^[\w.-]+$/.test(name)) return;
  fs.rmSync(path.join(uploadDir, name), { force: true });
}
