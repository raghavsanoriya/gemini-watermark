import type { MediaKind, ProcessorErrorCode } from '@/types/media';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const HEIC_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'] as const;
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/mpeg'] as const;
export const SOFT_VIDEO_BYTES = 500 * 1024 * 1024;
export const SOFT_VIDEO_SECONDS = 120;

export class ProcessorError extends Error {
  constructor(public readonly code: ProcessorErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProcessorError';
  }
}

/** HEIC/HEIF photos (iPhone default). Windows often reports an empty type, so the extension counts too. */
export function isHeic(file: { type: string; name?: string }): boolean {
  return (HEIC_TYPES as readonly string[]).includes(file.type) || /\.(heic|heif)$/i.test(file.name ?? '');
}

export function getMediaKind(file: { type: string; name?: string }): MediaKind | null {
  if ((IMAGE_TYPES as readonly string[]).includes(file.type) || isHeic(file)) return 'image';
  if ((VIDEO_TYPES as readonly string[]).includes(file.type)) return 'video';
  return null;
}

export function validateMediaFile(file: { type: string; size: number; name?: string }): MediaKind {
  const kind = getMediaKind(file);
  if (!kind) {
    throw new ProcessorError(
      'unsupported-format',
      'Use PNG, JPG, WEBP, HEIC, MP4, MOV, WEBM, MKV, MPG, or MPEG.'
    );
  }
  if (file.size <= 0) throw new ProcessorError('decode-failed', 'The selected file is empty.');
  return kind;
}

export function needsVideoOverride(size: number, duration: number | null): boolean {
  return size > SOFT_VIDEO_BYTES || (duration !== null && duration > SOFT_VIDEO_SECONDS);
}

export function outputFileName(name: string, kind: MediaKind, mimeType?: string): string {
  const base = name.replace(/\.[^.]+$/, '') || 'media';
  if (kind === 'video') return `gemclean-${base}.mp4`;
  const extension = mimeType === 'image/png' ? 'png' : mimeType === 'image/webp' ? 'webp' : 'jpg';
  return `gemclean-${base}.${extension}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

export function clampProgress(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Decodes a HEIC/HEIF photo to PNG in the browser. The decoder is loaded only
 * when needed. Browsers that decode HEIC natively (Safari) skip the library.
 */
export async function decodeHeicToPng(file: File): Promise<File> {
  const pngName = `${file.name.replace(/\.[^.]+$/, '') || 'photo'}.png`;
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
    bitmap.close();
    return new File([await canvas.convertToBlob({ type: 'image/png' })], pngName, { type: 'image/png' });
  } catch {
    // Not natively decodable here; fall through to the WebAssembly decoder.
  }
  try {
    const { default: heic2any } = await import('heic2any');
    const output = await heic2any({ blob: file, toType: 'image/png' });
    const blob = Array.isArray(output) ? output[0] : output;
    return new File([blob], pngName, { type: 'image/png' });
  } catch (error) {
    throw new ProcessorError('decode-failed', 'This HEIC photo could not be decoded in the browser.', { cause: error });
  }
}
