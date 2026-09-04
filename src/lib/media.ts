import type { MediaKind, ProcessorErrorCode } from '@/types/media';

export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const VIDEO_TYPES = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska', 'video/mpeg'] as const;
export const SOFT_VIDEO_BYTES = 500 * 1024 * 1024;
export const SOFT_VIDEO_SECONDS = 120;

export class ProcessorError extends Error {
  constructor(public readonly code: ProcessorErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProcessorError';
  }
}

export function getMediaKind(file: Pick<File, 'type'>): MediaKind | null {
  if ((IMAGE_TYPES as readonly string[]).includes(file.type)) return 'image';
  if ((VIDEO_TYPES as readonly string[]).includes(file.type)) return 'video';
  return null;
}

export function validateMediaFile(file: Pick<File, 'type' | 'size'>): MediaKind {
  const kind = getMediaKind(file);
  if (!kind) {
    throw new ProcessorError(
      'unsupported-format',
      'Use PNG, JPG, WEBP, MP4, MOV, WEBM, MKV, MPG, or MPEG.'
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
