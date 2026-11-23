/**
 * Finds hidden file metadata in JPEG, PNG and WebP images without decoding pixels.
 * Pure byte parsing, so it runs in the browser, a worker, or Node.
 */

export type ImageContainer = 'jpeg' | 'png' | 'webp' | 'unknown';

export type MetadataKind =
  | 'exif'
  | 'gps'
  | 'xmp'
  | 'iptc'
  | 'c2pa'
  | 'ai-parameters'
  | 'text'
  | 'comment'
  | 'thumbnail'
  | 'vendor'
  | 'trailing-data';

export interface MetadataReport {
  container: ImageContainer;
  /** Kinds found, in a stable display order. */
  found: MetadataKind[];
  details: {
    software?: string;
    camera?: string;
    creatorTool?: string;
    /** IPTC/XMP digital source type, e.g. trainedAlgorithmicMedia. */
    digitalSourceType?: string;
    /** An AI tool named inside the metadata. */
    generator?: string;
    /** An EXIF block that holds nothing but the orientation tag. */
    orientationOnly?: boolean;
    orientation?: number;
    trailingBytes?: number;
  };
}

export const METADATA_LABELS: Record<MetadataKind, string> = {
  exif: 'EXIF camera data',
  gps: 'GPS location',
  xmp: 'XMP',
  iptc: 'IPTC',
  c2pa: 'Content Credentials (C2PA)',
  'ai-parameters': 'AI prompt and settings',
  text: 'Text chunks',
  comment: 'Comment',
  thumbnail: 'Embedded thumbnail',
  vendor: 'Other app data',
  'trailing-data': 'Data after the image',
};

const ORDER: MetadataKind[] = ['gps', 'exif', 'c2pa', 'ai-parameters', 'xmp', 'iptc', 'text', 'comment', 'thumbnail', 'vendor', 'trailing-data'];

const GENERATORS: Array<[RegExp, string]> = [
  [/\bdall[\s·-]?e\b/i, 'DALL-E'],
  [/\b(chatgpt|openai)\b/i, 'OpenAI'],
  [/\bmidjourney\b/i, 'Midjourney'],
  [/\bfirefly\b/i, 'Adobe Firefly'],
  [/\b(gemini|imagen|synthid|google (llc|ai|deepmind))\b/i, 'Google'],
  [/\bcomfyui\b/i, 'ComfyUI'],
  [/\b(automatic1111|stable[\s-]?diffusion|sd-?xl)\b/i, 'Stable Diffusion'],
  [/\bnovelai\b/i, 'NovelAI'],
  [/\bleonardo\.ai\b/i, 'Leonardo'],
  [/\bideogram\b/i, 'Ideogram'],
  [/\b(black forest labs|flux)\b/i, 'FLUX'],
  [/\b(bing image creator|microsoft designer)\b/i, 'Microsoft'],
  [/\b(meta ai|imagine with meta)\b/i, 'Meta AI'],
];

/** Decoding, colour and animation chunks: the PNG stripper keeps exactly these. */
export const PNG_IMAGE_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'iCCP', 'sBIT', 'bKGD', 'pHYs', 'hIST', 'cICP', 'mDCV', 'cLLI', 'acTL', 'fcTL', 'fdAT']);

export function latin1(bytes: Uint8Array, start = 0, end = bytes.length): string {
  let out = '';
  for (let i = start; i < end; i += 8192) out += String.fromCharCode(...bytes.subarray(i, Math.min(end, i + 8192)));
  return out;
}

function startsWith(bytes: Uint8Array, at: number, text: string): boolean {
  if (at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
}

export function detectContainer(bytes: Uint8Array): ImageContainer {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 8 && bytes[0] === 0x89 && startsWith(bytes, 1, 'PNG\r\n\x1a\n')) return 'png';
  if (bytes.length >= 12 && startsWith(bytes, 0, 'RIFF') && startsWith(bytes, 8, 'WEBP')) return 'webp';
  return 'unknown';
}

// ---------- TIFF / EXIF ----------

export interface ExifSummary {
  /** Number of IFD0 entries other than Orientation, plus any sub-IFDs or IFD1. */
  meaningfulEntries: number;
  orientation?: number;
  gps: boolean;
  thumbnail: boolean;
  software?: string;
  camera?: string;
  aiParameters: boolean;
}

/** Reads the parts of a TIFF structure we report on; tolerant of truncation. */
export function readExif(tiff: Uint8Array): ExifSummary | null {
  if (tiff.length < 8) return null;
  const little = tiff[0] === 0x49 && tiff[1] === 0x49;
  if (!little && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) return null;
  const view = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const u16 = (o: number) => (o + 2 <= tiff.length ? view.getUint16(o, little) : 0);
  const u32 = (o: number) => (o + 4 <= tiff.length ? view.getUint32(o, little) : 0);
  if (u16(2) !== 42) return null;
  const ifd0 = u32(4);
  const summary: ExifSummary = { meaningfulEntries: 0, gps: false, thumbnail: false, aiParameters: false };
  const ascii = (entry: number) => {
    const count = u32(entry + 4);
    const at = count <= 4 ? entry + 8 : u32(entry + 8);
    if (at <= 0 || at + count > tiff.length) return undefined;
    const text = latin1(tiff, at, at + count).replace(/\0+$/, '').trim();
    return text || undefined;
  };
  const entries = u16(ifd0);
  if (ifd0 + 2 + entries * 12 > tiff.length) return summary;
  let make: string | undefined;
  let model: string | undefined;
  for (let i = 0; i < entries; i++) {
    const entry = ifd0 + 2 + i * 12;
    const tag = u16(entry);
    if (tag === 0x0112) { summary.orientation = u16(entry + 8); continue; }
    summary.meaningfulEntries++;
    if (tag === 0x0131) summary.software = ascii(entry);
    else if (tag === 0x010f) make = ascii(entry);
    else if (tag === 0x0110) model = ascii(entry);
    else if (tag === 0x8825) {
      const gpsIfd = u32(entry + 8);
      summary.gps = gpsIfd > 0 && u16(gpsIfd) > 0;
    }
  }
  if (make || model) summary.camera = [make, model].filter(Boolean).join(' ');
  const ifd1 = u32(ifd0 + 2 + entries * 12);
  if (ifd1 > 0 && ifd1 < tiff.length) { summary.thumbnail = true; summary.meaningfulEntries++; }
  // Automatic1111 and Forge write the prompt into UserComment, often as UTF-16.
  const text = latin1(tiff).replace(/\0/g, '');
  summary.aiParameters = /Steps:\s*\d+/.test(text) && /(Sampler|CFG scale|Seed):/.test(text);
  return summary;
}

// ---------- Report builder ----------

class Collector {
  found = new Set<MetadataKind>();
  details: MetadataReport['details'] = {};
  /** Tool fields, C2PA manifests and AI parameter chunks only, never free text, so a name in a caption does not count. */
  aiText = '';

  add(kind: MetadataKind) { this.found.add(kind); }

  exif(tiff: Uint8Array) {
    const exif = readExif(tiff);
    if (!exif) { this.add('exif'); return; }
    if (exif.orientation) this.details.orientation = exif.orientation;
    if (exif.meaningfulEntries === 0) {
      this.details.orientationOnly = true;
      return;
    }
    this.add('exif');
    if (exif.gps) this.add('gps');
    if (exif.thumbnail) this.add('thumbnail');
    if (exif.aiParameters) this.add('ai-parameters');
    if (exif.software) this.details.software = exif.software;
    if (exif.camera) this.details.camera = exif.camera;
    if (exif.software) this.aiText += ` ${exif.software}`;
  }

  xmp(text: string) {
    this.add('xmp');
    const tool = /CreatorTool(?:="|>)([^"<]+)/.exec(text)?.[1];
    if (tool) this.details.creatorTool = tool.trim();
    const source = /DigitalSourceType(?:="|>)([^"<]+)/i.exec(text)?.[1];
    if (source) this.details.digitalSourceType = source.trim().split('/').pop();
    if (/<exif:GPS|exif:GPSLatitude/.test(text)) this.add('gps');
    if (tool) this.aiText += ` ${tool}`;
  }

  c2pa(raw: string) {
    this.add('c2pa');
    this.aiText += ` ${raw}`;
  }

  report(container: ImageContainer): MetadataReport {
    for (const [pattern, name] of GENERATORS) {
      if (pattern.test(this.aiText)) { this.details.generator = name; break; }
    }
    return { container, found: ORDER.filter((kind) => this.found.has(kind)), details: this.details };
  }
}

// ---------- JPEG ----------

/** Offset just past the EOI marker, walking every scan; returns the file length if EOI is missing. */
export function jpegEnd(bytes: Uint8Array): number {
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return bytes.length;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd9) return i + 2;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return bytes.length;
    i += 2 + length;
    if (marker === 0xda) {
      // Entropy-coded data runs until a marker that is not a stuffed byte or a restart.
      while (i + 1 < bytes.length) {
        if (bytes[i] === 0xff && bytes[i + 1] !== 0x00 && !(bytes[i + 1] >= 0xd0 && bytes[i + 1] <= 0xd7)) break;
        i++;
      }
    }
  }
  return bytes.length;
}

function scanJpeg(bytes: Uint8Array, c: Collector) {
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) break;
    const marker = bytes[i + 1];
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) break;
    const start = i + 4;
    const end = Math.min(bytes.length, i + 2 + length);
    if (marker === 0xda) {
      // Skip the scan's entropy-coded data; progressive files can carry segments between scans.
      i = end;
      while (i + 1 < bytes.length && !(bytes[i] === 0xff && bytes[i + 1] !== 0x00 && !(bytes[i + 1] >= 0xd0 && bytes[i + 1] <= 0xd7))) i++;
      continue;
    }
    const body = bytes.subarray(start, end);
    if (marker === 0xe1) {
      if (startsWith(body, 0, 'Exif\0')) c.exif(body.subarray(6));
      else if (startsWith(body, 0, 'http://ns.adobe.com/')) c.xmp(latin1(body));
      else c.add('vendor');
    } else if (marker === 0xed) {
      c.add('iptc');
      const text = latin1(body);
      if (/trainedAlgorithmicMedia|compositeSynthetic/i.test(text) && !c.details.digitalSourceType) {
        c.details.digitalSourceType = /trainedAlgorithmicMedia|compositeSynthetic\w*/i.exec(text)?.[0];
      }
    } else if (marker === 0xeb) {
      const raw = latin1(body);
      if (/jumb|c2pa|jumd/.test(raw)) c.c2pa(raw); else c.add('vendor');
    } else if (marker === 0xfe) {
      c.add('comment');
    } else if (marker === 0xe0) {
      if (startsWith(body, 0, 'JFXX')) c.add('thumbnail');
      else if (!startsWith(body, 0, 'JFIF')) c.add('vendor');
    } else if (marker === 0xe2) {
      if (startsWith(body, 0, 'MPF\0')) c.add('trailing-data');
      else if (!startsWith(body, 0, 'ICC_PROFILE\0')) c.add('vendor');
    } else if (marker >= 0xe3 && marker <= 0xef && marker !== 0xee) {
      c.add('vendor');
    }
    i = end;
  }
  const end = jpegEnd(bytes);
  const trailing = bytes.length - end;
  // A few zero bytes of padding are common and harmless.
  if (trailing > 0 && bytes.subarray(end).some((b) => b !== 0)) {
    c.add('trailing-data');
    c.details.trailingBytes = trailing;
  }
}

// ---------- PNG ----------

export function forEachPngChunk(bytes: Uint8Array, visit: (type: string, start: number, dataStart: number, dataEnd: number, end: number) => boolean | void): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let i = 8;
  while (i + 12 <= bytes.length) {
    const length = view.getUint32(i);
    const type = latin1(bytes, i + 4, i + 8);
    const end = i + 12 + length;
    if (end > bytes.length) return bytes.length;
    if (visit(type, i, i + 8, i + 8 + length, end) === false) return end;
    i = end;
    if (type === 'IEND') return end;
  }
  return Math.min(i, bytes.length);
}

function scanPng(bytes: Uint8Array, c: Collector) {
  const end = forEachPngChunk(bytes, (type, _start, dataStart, dataEnd) => {
    const data = bytes.subarray(dataStart, dataEnd);
    if (type === 'tEXt' || type === 'zTXt' || type === 'iTXt') {
      const nul = data.indexOf(0);
      const keyword = latin1(data, 0, nul < 0 ? data.length : nul);
      if (keyword === 'XML:com.adobe.xmp') c.xmp(latin1(data));
      else if (/^(parameters|prompt|workflow|sd-metadata|Dream|invokeai_metadata)$/i.test(keyword)) {
        c.add('ai-parameters');
        c.aiText += ` ${keyword} ${latin1(data, 0, Math.min(data.length, 4096))}`;
      } else {
        c.add('text');
      }
    } else if (type === 'eXIf') c.exif(data);
    else if (type === 'caBX') c.c2pa(latin1(data));
    else if (type === 'tIME') c.add('text');
    // Anything else the stripper drops is reported, so "no metadata" always means nothing to drop.
    else if (!PNG_IMAGE_CHUNKS.has(type)) c.add('vendor');
  });
  const trailing = bytes.length - end;
  if (trailing > 0 && bytes.subarray(end).some((b) => b !== 0)) {
    c.add('trailing-data');
    c.details.trailingBytes = trailing;
  }
}

// ---------- WebP ----------

export function forEachRiffChunk(bytes: Uint8Array, visit: (fourcc: string, start: number, dataStart: number, dataEnd: number, end: number) => void): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const riffEnd = Math.min(bytes.length, 8 + view.getUint32(4, true));
  let i = 12;
  while (i + 8 <= riffEnd) {
    const size = view.getUint32(i + 4, true);
    const dataEnd = i + 8 + size;
    if (dataEnd > riffEnd) return riffEnd;
    const end = dataEnd + (size & 1);
    visit(latin1(bytes, i, i + 4), i, i + 8, dataEnd, Math.min(end, riffEnd));
    i = end;
  }
  return riffEnd;
}

function scanWebp(bytes: Uint8Array, c: Collector) {
  const end = forEachRiffChunk(bytes, (fourcc, _start, dataStart, dataEnd) => {
    const data = bytes.subarray(dataStart, dataEnd);
    if (fourcc === 'EXIF') c.exif(startsWith(data, 0, 'Exif\0') ? data.subarray(6) : data);
    else if (fourcc === 'XMP ') c.xmp(latin1(data));
    else if (fourcc === 'C2PA') c.c2pa(latin1(data));
  });
  if (bytes.length > end && bytes.subarray(end).some((b) => b !== 0)) {
    c.add('trailing-data');
    c.details.trailingBytes = bytes.length - end;
  }
}

// ---------- Entry ----------

export function scanMetadata(input: Uint8Array | ArrayBuffer): MetadataReport {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const container = detectContainer(bytes);
  const c = new Collector();
  try {
    if (container === 'jpeg') scanJpeg(bytes, c);
    else if (container === 'png') scanPng(bytes, c);
    else if (container === 'webp') scanWebp(bytes, c);
  } catch {
    // A malformed tail still leaves what was read before it in the report.
  }
  return c.report(container);
}
