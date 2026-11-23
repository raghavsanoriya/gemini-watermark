import { outputFileName, ProcessorError } from '@/lib/media';
import type { ProcessorResult } from '@/types/media';
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
