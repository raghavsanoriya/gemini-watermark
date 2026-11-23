import { decodeHeicToPng, isHeic, outputFileName, ProcessorError } from '@/lib/media';
import type { ProcessorOptions, ProcessorResult } from '@/types/media';
import { scanMetadata, type MetadataReport } from './scan';
import { stripMetadata, UnsupportedContainerError } from './strip';

export async function scanFile(file: Blob): Promise<MetadataReport> {
  return scanMetadata(new Uint8Array(await file.arrayBuffer()));
}

async function decodedSize(blob: Blob): Promise<{ width: number; height: number }> {
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

/**
 * Removes file metadata without touching the pixels. The result is decoded and re-scanned
 * before it is offered, so a file that would not open, or still carries metadata, is caught here.
 */
export async function removeMetadataOnly(file: File, before: MetadataReport | null): Promise<ProcessorResult> {
  let stripped: ReturnType<typeof stripMetadata>;
  try {
    stripped = stripMetadata(new Uint8Array(await file.arrayBuffer()));
  } catch (error) {
    if (error instanceof UnsupportedContainerError) throw new ProcessorError('unsupported-format', error.message, { cause: error });
    throw error;
  }
  const blob = new Blob([stripped.bytes as Uint8Array<ArrayBuffer>], { type: stripped.mimeType });

  try {
    const [original, cleaned] = await Promise.all([decodedSize(file), decodedSize(blob)]);
    if (original.width !== cleaned.width || original.height !== cleaned.height) throw new Error('size changed');
  } catch (error) {
    throw new ProcessorError('encode-failed', 'The cleaned file did not decode the same way as the original, so it was not kept.', { cause: error });
  }

  return {
    blob,
    mimeType: stripped.mimeType,
    fileName: outputFileName(file.name, 'image', stripped.mimeType),
    detection: { applied: false, decisionTier: 'metadata-only', skipReason: null, size: null, position: null },
    operation: 'metadata',
    metadata: { before, after: scanMetadata(stripped.bytes), lossless: true },
  };
}

/**
 * Metadata-only cleaning for any accepted image. HEIC cannot be stripped in place, so it is
 * converted to PNG first (as the single-file view does), which already leaves its metadata behind.
 */
export async function removeMetadataFromImage(file: File, before: MetadataReport | null): Promise<ProcessorResult> {
  if (!isHeic(file)) return removeMetadataOnly(file, before);
  const result = await removeMetadataOnly(await decodeHeicToPng(file), before);
  return { ...result, metadata: result.metadata && { ...result.metadata, lossless: false } };
}

/** True when the scan shows nothing worth removing (a HEIC original always counts as something). */
export function hasNothingToRemove(report: MetadataReport | null): boolean {
  return !!report && report.container !== 'unknown' && report.found.length === 0;
}

/**
 * The one-button clean: removes the visible watermark and the file's metadata together.
 *
 * - Mark removed: the repaired image is re-encoded, which already drops metadata. The download
 *   is re-scanned to prove it, and stripped losslessly if anything survived.
 * - No mark (or removal judged unsafe): the picture stays exactly as it was, but its metadata is
 *   still removed, so the user gets a cleaned file instead of an error. The result keeps the
 *   watermark step's detection so callers can say why the picture was not changed.
 * - Neither a mark nor metadata: the watermark step's result is returned unchanged.
 */
export async function removeWatermarkAndMetadata(
  file: File,
  options: ProcessorOptions,
  removeMark: (file: File, options: ProcessorOptions) => Promise<ProcessorResult>,
  before: MetadataReport | null,
): Promise<ProcessorResult> {
  const processed = await removeMark(file, options);
  if (processed.detection.applied) {
    let blob = processed.blob;
    let after = await scanFile(blob);
    if (after.found.length) {
      const stripped = stripMetadata(new Uint8Array(await blob.arrayBuffer()));
      blob = new Blob([stripped.bytes as Uint8Array<ArrayBuffer>], { type: stripped.mimeType });
      after = scanMetadata(stripped.bytes);
    }
    return { ...processed, blob, operation: 'watermark', metadata: { before, after, lossless: false } };
  }
  if (hasNothingToRemove(before)) return processed;
  try {
    const stripped = await removeMetadataFromImage(file, before);
    return { ...stripped, detection: processed.detection };
  } catch {
    // An image the stripper cannot handle keeps the watermark step's answer.
    return processed;
  }
}

/** True for a result where the mark was not removed but the metadata was. */
export function isMetadataFallback(result: ProcessorResult): boolean {
  return result.operation === 'metadata' && result.detection.decisionTier !== 'metadata-only';
}
