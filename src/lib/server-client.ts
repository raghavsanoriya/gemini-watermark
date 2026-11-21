'use client';

import { isAbortError, ProcessorError } from '@/lib/media';
import type { ProcessorOptions, ProcessorResult, WatermarkDetection } from '@/types/media';

/** True in builds that include the GemClean server API (not the static GitHub Pages export). */
export const SERVER_MODE = process.env.NEXT_PUBLIC_SERVER_MODE === '1';

/** Must match the server default (`GEMCLEAN_MAX_UPLOAD_MB`, 4 MB to fit Vercel's request limit). */
export const SERVER_MAX_UPLOAD_BYTES = Number(process.env.NEXT_PUBLIC_SERVER_MAX_UPLOAD_MB ?? 4) * 1024 * 1024;

/** Uploads one image, which the server cleans in memory and returns as PNG. Nothing is stored. */
export async function processImageOnServer(file: File, options: ProcessorOptions): Promise<ProcessorResult> {
  const { signal, onProgress } = options;
  if (file.size > SERVER_MAX_UPLOAD_BYTES) {
    throw new ProcessorError(
      'processing-failed',
      `Server processing accepts images up to ${Math.round(SERVER_MAX_UPLOAD_BYTES / 1024 / 1024)} MB. Use "This device" for larger files.`,
    );
  }
  onProgress({ phase: 'processing', progress: 0.2, message: 'Cleaning on the GemClean server…' });
  const form = new FormData();
  form.append('file', file);
  let response: Response;
  try {
    response = await fetch('/api/clean/', { method: 'POST', body: form, signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new ProcessorError('processing-failed', 'The server could not be reached.');
  }

  const isJson = response.headers.get('content-type')?.includes('application/json');
  if (!response.ok || isJson) {
    const body = await response.json().catch(() => ({})) as { error?: string; applied?: boolean; repairMode?: string; message?: string };
    if (!response.ok) throw new ProcessorError('processing-failed', body.error || `Server processing failed (${response.status}).`);
    const detection: WatermarkDetection = {
      applied: false, decisionTier: 'server', skipReason: 'no-mark', size: null, position: null,
      repairMode: body.repairMode === 'unchanged-unsafe' ? 'unchanged-unsafe' : null,
      qualityWarning: body.message ?? null,
    };
    return { blob: file, mimeType: file.type, fileName: file.name, detection };
  }

  onProgress({ phase: 'encoding', progress: 0.9, message: 'Downloading the cleaned image…' });
  const blob = await response.blob();
  onProgress({ phase: 'encoding', progress: 1, message: 'Image ready.' });
  const baseName = file.name.replace(/\.[^.]+$/, '') || 'image';
  return {
    blob,
    mimeType: 'image/png',
    fileName: `gemclean-${baseName}.png`,
    detection: {
      applied: true, decisionTier: 'server', skipReason: null, size: null, position: null,
      repairMode: (response.headers.get('x-gemclean-repair-mode') as WatermarkDetection['repairMode']) ?? 'reverse-alpha',
    },
  };
}
