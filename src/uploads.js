// Image upload safety: magic-byte type check, decode + re-encode with sharp (strips EXIF/metadata
// and anything appended to the file), pixel/dimension limits, thumbnail generation.
import sharp from 'sharp';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const ALLOWED = { png: 'image/png', jpeg: 'image/jpeg', webp: 'image/webp' };

/** Detect image type from magic bytes. Never trust the filename or client mime. */
export function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 && buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) return 'png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

export const newId = () => randomBytes(9).toString('base64url'); // 12 chars, unguessable

/**
 * Validate + sanitize an uploaded image and write it (plus a thumbnail) to dir.
 * Returns { id, file, thumb, mime, bytes, width, height }. Throws Error with a user-safe message.
 */
export async function processImage(buf, { dir, maxBytes = 5 * 1024 * 1024, maxDim = 4096, minDim = 200, prefix = '' }) {
  if (!buf?.length) throw new Error('No file uploaded');
  if (buf.length > maxBytes) throw new Error(`File too large (max ${Math.round(maxBytes / 1048576)} MB)`);
  const type = detectImageType(buf);
  if (!type) throw new Error('Only PNG, JPG or WEBP images are allowed');
  let img, meta;
  try {
    img = sharp(buf, { limitInputPixels: 50_000_000, failOn: 'error', animated: false });
    meta = await img.metadata();
  } catch { throw new Error('Image could not be read (corrupt or unsupported)'); }
  if (meta.format !== type) throw new Error('File contents do not match its image type');
  if (!meta.width || !meta.height || meta.width < minDim || meta.height < minDim) throw new Error(`Image too small (min ${minDim}px per side)`);

  const pipeline = sharp(buf, { limitInputPixels: 50_000_000, animated: false }).rotate()
    .resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true });
  // Re-encode in the same format. sharp drops EXIF/ICC/XMP metadata by default.
  const out = type === 'png' ? await pipeline.png({ compressionLevel: 8 }).toBuffer({ resolveWithObject: true })
    : type === 'jpeg' ? await pipeline.jpeg({ quality: 90, mozjpeg: true }).toBuffer({ resolveWithObject: true })
    : await pipeline.webp({ quality: 90 }).toBuffer({ resolveWithObject: true });
  const thumb = await sharp(out.data).resize({ width: 960, height: 960, fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();

  const id = newId();
  mkdirSync(dir, { recursive: true });
  const ext = type === 'jpeg' ? 'jpg' : type;
  const file = `${prefix}${id}.${ext}`, thumbFile = `${prefix}${id}.thumb.webp`;
  writeFileSync(join(dir, file), out.data);
  writeFileSync(join(dir, thumbFile), thumb);
  return { id, file, thumb: thumbFile, mime: ALLOWED[type], bytes: out.data.length, width: out.info.width, height: out.info.height };
}

export function removeFiles(dir, ...files) {
  for (const f of files) if (f && !f.includes('/') && !f.includes('..')) rmSync(join(dir, f), { force: true });
}
