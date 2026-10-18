export interface PhotoDraft {
  pngBase64: string;
  id: string;
  width: number;
  height: number;
  url: string;
}
function rasterDimensions(bytes: Uint8Array): {
  width: number;
  height: number;
} {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (at: number, length: number) =>
    String.fromCharCode(...bytes.slice(at, at + length));
  if (
    bytes.length >= 24 &&
    bytes[0] === 137 &&
    text(1, 3) === 'PNG' &&
    text(12, 4) === 'IHDR'
  )
    return { width: view.getUint32(16), height: view.getUint32(20) };
  if (bytes[0] === 255 && bytes[1] === 216) {
    let at = 2;
    while (at + 3 < bytes.length) {
      if (bytes[at++] !== 255) break;
      while (bytes[at] === 255) at++;
      const marker = bytes[at++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (at + 2 > bytes.length) break;
      const length = view.getUint16(at);
      if (length < 2 || at + length > bytes.length) break;
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(marker) &&
        length >= 8
      )
        return {
          width: view.getUint16(at + 5),
          height: view.getUint16(at + 3),
        };
      at += length;
    }
  }
  if (text(0, 4) === 'RIFF' && text(8, 4) === 'WEBP') {
    const le24 = (at: number) =>
      bytes[at] + bytes[at + 1] * 256 + bytes[at + 2] * 65536;
    for (let at = 12; at + 8 <= bytes.length;) {
      const type = text(at, 4),
        length = view.getUint32(at + 4, true),
        data = at + 8;
      if (data + length > bytes.length) break;
      if (type === 'VP8X' && length >= 10)
        return { width: le24(data + 4) + 1, height: le24(data + 7) + 1 };
      if (type === 'VP8L' && length >= 5 && bytes[data] === 47) {
        const bits = view.getUint32(data + 1, true);
        return {
          width: (bits & 16383) + 1,
          height: ((bits >>> 14) & 16383) + 1,
        };
      }
      if (
        type === 'VP8 ' &&
        length >= 10 &&
        text(data + 3, 3) === '\u009d\u0001\u002a'
      )
        return {
          width: view.getUint16(data + 6, true) & 16383,
          height: view.getUint16(data + 8, true) & 16383,
        };
      at = data + length + (length % 2);
    }
  }
  throw new Error('Choose a valid JPEG, PNG or WebP image');
}
/** Decode a user-selected raster and re-encode pixels, excluding source metadata. */
export async function preparePhoto(file: File): Promise<PhotoDraft> {
  if (file.size > 10 * 1024 * 1024)
    throw new Error('Choose an image under 10 MB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const png =
    bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  const webp =
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  if (!png && !jpeg && !webp)
    throw new Error('Choose a JPEG, PNG or WebP image');
  // Bound declared raster dimensions before asking the browser to allocate a decoder.
  const dimensions = rasterDimensions(bytes);
  if (
    !dimensions.width ||
    !dimensions.height ||
    dimensions.width * dimensions.height > 40_000_000
  )
    throw new Error('Choose a smaller image');
  const bitmap = await createImageBitmap(file, {
    imageOrientation: 'from-image',
  });
  try {
    if (
      !bitmap.width ||
      !bitmap.height ||
      bitmap.width * bitmap.height > 40_000_000
    )
      throw new Error('Choose a smaller image');
    const ratio = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
    let blob: Blob | null = null;
    for (let attempt = 0; attempt < 8; attempt++) {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Image processing unavailable');
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, 'image/png'),
      );
      if (blob && blob.size <= 2 * 1024 * 1024) break;
      canvas.width = Math.max(1, Math.floor(canvas.width * 0.75));
      canvas.height = Math.max(1, Math.floor(canvas.height * 0.75));
    }
    if (!blob || blob.size > 2 * 1024 * 1024)
      throw new Error('Choose a smaller image');
    const buffer = await blob.arrayBuffer();
    const id = [
      ...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer)),
    ]
      .map((value) => value.toString(16).padStart(2, '0'))
      .join('');
    const pngBase64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(',')[1]);
      reader.onerror = () => reject(new Error('Image could not be read'));
      reader.readAsDataURL(blob!);
    });
    return {
      pngBase64,
      id,
      width: canvas.width,
      height: canvas.height,
      url: `data:image/png;base64,${pngBase64}`,
    };
  } finally {
    bitmap.close();
  }
}
