import sharp, { type Metadata } from 'sharp';
import { cleanImageData } from '@/lib/processors/pipeline';
import { serverConfig } from './config';
import { HttpError } from './http';
import { nodeMiganSessionFactory } from './migan-node';

const ACCEPTED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
/** Formats sharp may decode here, checked from the bytes rather than the upload's label. */
const ACCEPTED_FORMATS = new Set(['png', 'jpeg', 'webp']);
/**
 * Largest image the server decodes. Gemini's biggest outputs are about 17 MP (4K); a flat
 * 40 MP PNG of ~130 KB used to take over 1 GB of memory, so the cap stays close to need.
 */
export const MAX_INPUT_PIXELS = 24_000_000;

export interface CleanOutcome {
  applied: boolean;
  repairMode: string | null;
  message: string | null;
  /** Cleaned PNG; null when no mark was removed. */
  png: Buffer | null;
  /** Why MI-GAN could not run, when it failed. */
  miganError: string | null;
}

/** Cleans one uploaded image entirely in memory. Nothing is written to disk. */
export async function cleanUploadedImage(file: File): Promise<CleanOutcome> {
  if (!ACCEPTED_TYPES.has(file.type)) throw new HttpError(415, 'Server processing accepts PNG, JPG, and WEBP images.');
  if (file.size <= 0) throw new HttpError(400, 'The uploaded file is empty.');
  if (file.size > serverConfig.maxUploadBytes) {
    const limit = Math.round(serverConfig.maxUploadBytes / 1024 / 1024);
    throw new HttpError(413, `Server processing accepts images up to ${limit} MB. Use "This device" for larger files.`);
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  let header: Metadata;
  try {
    // Reads the header only; the pixel count is checked below, before any decoding.
    header = await sharp(bytes, { limitInputPixels: false }).metadata();
  } catch {
    throw new HttpError(422, 'This image could not be decoded.');
  }
  if (!header.format || !ACCEPTED_FORMATS.has(header.format)) {
    throw new HttpError(415, 'Server processing accepts PNG, JPG, and WEBP images.');
  }
  if (!header.width || !header.height || header.width * header.height > MAX_INPUT_PIXELS) {
    throw new HttpError(413, 'This image has too many pixels for server processing. Use "This device" instead.');
  }

  let decoded: { data: Buffer; info: { width: number; height: number } };
  try {
    decoded = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS })
      .rotate()
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new HttpError(422, 'This image could not be decoded.');
  }
  const { data, info } = decoded;
  let miganError: string | null = null;
  const result = await cleanImageData(
    { width: info.width, height: info.height, data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength) },
    {
      miganSessionFactory: nodeMiganSessionFactory,
      onMiganError: (error) => {
        miganError = error instanceof Error ? error.message : String(error);
        console.error('[gemclean] MI-GAN repair failed', error);
      },
    },
  );
  const meta = result.meta as typeof result.meta & { repairMode?: string | null; qualityWarning?: string | null };
  if (!meta.applied) {
    return {
      applied: false,
      repairMode: meta.repairMode ?? null,
      message: meta.qualityWarning ?? 'No supported Gemini mark was detected. The original was left unchanged.',
      png: null,
      miganError,
    };
  }
  const pixels = result.imageData.data;
  const png = await sharp(Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength), {
    raw: { width: info.width, height: info.height, channels: 4 },
  }).png().toBuffer();
  return { applied: true, repairMode: meta.repairMode ?? 'reverse-alpha', message: null, png, miganError };
}
