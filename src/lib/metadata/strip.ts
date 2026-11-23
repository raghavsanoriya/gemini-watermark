/**
 * Removes file metadata from JPEG, PNG and WebP without re-encoding, so the pixels stay identical.
 * Everything not needed to decode and colour the image is dropped by allowlist; the orientation
 * tag survives on its own so phone photos stay upright.
 */
import { detectContainer, forEachPngChunk, forEachRiffChunk, jpegEnd, PNG_IMAGE_CHUNKS, readExif, type ImageContainer } from './scan';

export class UnsupportedContainerError extends Error {}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

function startsWith(bytes: Uint8Array, at: number, text: string): boolean {
  if (at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

/** A big-endian TIFF block holding only the Orientation tag. */
export function orientationTiff(orientation: number): Uint8Array {
  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  tiff.set([0x4d, 0x4d, 0x00, 0x2a]);
  view.setUint32(4, 8);
  view.setUint16(8, 1);
  view.setUint16(10, 0x0112);
  view.setUint16(12, 3);
  view.setUint32(14, 1);
  view.setUint16(18, orientation);
  view.setUint32(22, 0);
  return tiff;
}

const keepOrientation = (value: number | undefined): value is number => !!value && value >= 2 && value <= 8;

// ---------- JPEG ----------

function stripJpeg(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let orientation: number | undefined;
  let afterApp0 = 1; // index in parts where a rebuilt APP1 belongs
  let i = 2;
  const end = jpegEnd(bytes);
  while (i + 4 <= end) {
    if (bytes[i] !== 0xff) throw new UnsupportedContainerError('This JPEG has an unexpected structure.');
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { parts.push(bytes.subarray(i, i + 2)); i += 2; continue; }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    const segmentEnd = i + 2 + length;
    if (length < 2 || segmentEnd > end) throw new UnsupportedContainerError('This JPEG is truncated.');
    const body = bytes.subarray(i + 4, segmentEnd);
    let keep = false;
    if (marker === 0xda) {
      // Scan header plus its entropy-coded data, up to the next real marker.
      let j = segmentEnd;
      while (j + 1 < end) {
        if (bytes[j] === 0xff && bytes[j + 1] !== 0x00 && !(bytes[j + 1] >= 0xd0 && bytes[j + 1] <= 0xd7)) break;
        j++;
      }
      parts.push(bytes.subarray(i, j));
      i = j;
      continue;
    }
    if (marker === 0xe1 && startsWith(body, 0, 'Exif\0')) {
      orientation = readExif(body.subarray(6))?.orientation;
    } else if (marker === 0xe0) {
      keep = startsWith(body, 0, 'JFIF\0');
      if (keep) afterApp0 = parts.length + 1;
    } else if (marker === 0xe2) {
      keep = startsWith(body, 0, 'ICC_PROFILE\0');
    } else if (marker === 0xee) {
      keep = startsWith(body, 0, 'Adobe');
    } else {
      // Frame, tables and restart interval: DQT, DHT, DAC, DRI, DNL, EXP, SOF0-15.
      keep = [0xdb, 0xc4, 0xcc, 0xdd, 0xdc, 0xdf].includes(marker) || (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc);
    }
    if (keep) parts.push(bytes.subarray(i, segmentEnd));
    i = segmentEnd;
  }
  parts.push(new Uint8Array([0xff, 0xd9]));
  if (keepOrientation(orientation)) {
    const payload = concat([new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0]), orientationTiff(orientation)]);
    const header = new Uint8Array([0xff, 0xe1, (payload.length + 2) >> 8, (payload.length + 2) & 0xff]);
    parts.splice(afterApp0, 0, header, payload);
  }
  return concat(parts);
}

// ---------- PNG ----------

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Text, EXIF, time, C2PA and vendor chunks are dropped; the scanner reports each of them. */
const PNG_KEEP = PNG_IMAGE_CHUNKS;

function stripPng(bytes: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [bytes.subarray(0, 8)];
  let orientation: number | undefined;
  forEachPngChunk(bytes, (type, _start, dataStart, dataEnd) => {
    if (type === 'eXIf') orientation = readExif(bytes.subarray(dataStart, dataEnd))?.orientation;
  });
  let sawEnd = false;
  let placedOrientation = !keepOrientation(orientation);
  forEachPngChunk(bytes, (type, start, _dataStart, _dataEnd, end) => {
    if (type === 'IEND') sawEnd = true;
    // Viewers honour eXIf only before the image data.
    if (!placedOrientation && (type === 'IDAT' || type === 'acTL') && keepOrientation(orientation)) {
      parts.push(pngChunk('eXIf', orientationTiff(orientation)));
      placedOrientation = true;
    }
    if (PNG_KEEP.has(type)) parts.push(bytes.subarray(start, end));
  });
  if (!sawEnd) throw new UnsupportedContainerError('This PNG is truncated.');
  return concat(parts);
}

// ---------- WebP ----------

function stripWebp(bytes: Uint8Array): Uint8Array {
  const chunks: Array<{ fourcc: string; data: Uint8Array }> = [];
  let orientation: number | undefined;
  forEachRiffChunk(bytes, (fourcc, _start, dataStart, dataEnd) => {
    const data = bytes.subarray(dataStart, dataEnd);
    if (fourcc === 'EXIF') orientation = readExif(startsWith(data, 0, 'Exif\0') ? data.subarray(6) : data)?.orientation;
    if (fourcc === 'EXIF' || fourcc === 'XMP ' || fourcc === 'C2PA') return;
    chunks.push({ fourcc, data });
  });
  const vp8x = chunks.find((chunk) => chunk.fourcc === 'VP8X');
  if (vp8x) {
    const flags = vp8x.data.slice();
    flags[0] &= ~(0x08 | 0x04); // clear EXIF and XMP
    if (keepOrientation(orientation)) {
      flags[0] |= 0x08;
      chunks.push({ fourcc: 'EXIF', data: orientationTiff(orientation) });
    }
    vp8x.data = flags;
  }
  const body: Uint8Array[] = [];
  for (const { fourcc, data } of chunks) {
    const header = new Uint8Array(8);
    for (let i = 0; i < 4; i++) header[i] = fourcc.charCodeAt(i);
    new DataView(header.buffer).setUint32(4, data.length, true);
    body.push(header, data);
    if (data.length & 1) body.push(new Uint8Array(1));
  }
  const payload = concat(body);
  const head = new Uint8Array(12);
  head.set([0x52, 0x49, 0x46, 0x46]);
  new DataView(head.buffer).setUint32(4, payload.length + 4, true);
  head.set([0x57, 0x45, 0x42, 0x50], 8);
  return concat([head, payload]);
}

// ---------- Entry ----------

export interface StripResult {
  bytes: Uint8Array;
  container: ImageContainer;
  mimeType: string;
}

const MIME: Record<Exclude<ImageContainer, 'unknown'>, string> = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export function stripMetadata(input: Uint8Array | ArrayBuffer): StripResult {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const container = detectContainer(bytes);
  if (container === 'unknown') throw new UnsupportedContainerError('Metadata removal supports JPG, PNG and WEBP images.');
  const stripped = container === 'jpeg' ? stripJpeg(bytes) : container === 'png' ? stripPng(bytes) : stripWebp(bytes);
  return { bytes: stripped, container, mimeType: MIME[container] };
}
