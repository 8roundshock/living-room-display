import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { z } from 'zod';

export const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
export interface PhotoAsset { id: string; pngBase64: string; width: number; height: number; updatedAt: string }
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
/** Accept only bounded canvas-normalized PNG, with no metadata or external references. */
export function inspectPhoto(content: Buffer): { width: number; height: number } {
  if (content.length > MAX_PHOTO_BYTES || content.length < 57 || !content.subarray(0, 8).equals(signature)) throw new Error('Choose a PNG-normalized photo no larger than 2 MB');
  let offset = 8; let width = 0; let height = 0; let channels = 0; let ended = false; let idatEnded = false; const compressed: Buffer[] = [];
  while (offset < content.length) {
    if (offset + 12 > content.length) throw new Error('Invalid photo PNG');
    const length = content.readUInt32BE(offset); const end = offset + 12 + length;
    if (end > content.length) throw new Error('Invalid photo PNG');
    const type = content.toString('ascii', offset + 4, offset + 8); const data = content.subarray(offset + 8, offset + 8 + length);
    if (crc32(content.subarray(offset + 4, offset + 8 + length)) !== content.readUInt32BE(offset + 8 + length)) throw new Error('Invalid photo checksum');
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13) throw new Error('Invalid photo header');
      width = data.readUInt32BE(0); height = data.readUInt32BE(4); channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (!width || !height || width > 2048 || height > 2048 || width * height > 4_194_304 || data[8] !== 8 || !channels || data[10] || data[11] || data[12]) throw new Error('Use a normalized RGB photo up to 2048 pixels per side');
    } else if (type === 'IDAT') {
      if (idatEnded) throw new Error('Invalid photo data order');
      compressed.push(data);
    } else if (type === 'IEND') {
      if (length || !compressed.length || end !== content.length) throw new Error('Invalid photo ending');
      ended = true;
    } else {
      if (compressed.length) idatEnded = true;
      // Browser canvas may emit color-space hints. Strip all ancillary data at the source.
      if (!['sRGB', 'gAMA', 'cHRM', 'pHYs'].includes(type) || compressed.length) throw new Error('Use a canvas-normalized photo without metadata');
    }
    offset = end;
  }
  if (!ended) throw new Error('Incomplete photo PNG');
  const stride = width * channels + 1; const expected = stride * height;
  let pixels: Buffer;
  try { pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: expected + 1 }); } catch { throw new Error('Invalid photo pixels'); }
  if (pixels.length !== expected) throw new Error('Invalid photo pixel count');
  for (let row = 0; row < height; row++) if (pixels[row * stride]! > 4) throw new Error('Invalid photo pixel filter');
  return { width, height };
}
export function createPhotoAsset(pngBase64: string, timestamp: string): PhotoAsset {
  const content = Buffer.from(pngBase64, 'base64'); const dimensions = inspectPhoto(content);
  return { ...dimensions, pngBase64: content.toString('base64'), id: createHash('sha256').update(content).digest('hex'), updatedAt: timestamp };
}
export const photoAssetSchema = z.object({ id: z.string().regex(/^[a-f0-9]{64}$/), pngBase64: z.string().max(2_796_204), width: z.number().int().positive().max(2048), height: z.number().int().positive().max(2048), updatedAt: z.iso.datetime() }).strict().superRefine((asset, context) => {
  try {
    const actual = createPhotoAsset(asset.pngBase64, asset.updatedAt);
    if (actual.id !== asset.id || actual.width !== asset.width || actual.height !== asset.height || actual.pngBase64 !== asset.pngBase64) throw new Error('Photo metadata does not match');
  } catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid saved photo' }); }
});
