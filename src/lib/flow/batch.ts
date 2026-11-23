import { isAbortError } from '@/lib/media';
import { METADATA_LABELS, type MetadataKind, type MetadataReport } from '@/lib/metadata/scan';
import type { FlowAsset, FlowBatchState } from '@/types/flow';
import type { ProcessorOptions, ProcessorResult } from '@/types/media';

export interface BatchCallbacks {
  onStart: (asset: FlowAsset, index: number, total: number) => void;
  onProgress: (asset: FlowAsset, progress: number, message: string, index: number, total: number) => void;
  onComplete: (asset: FlowAsset, result: ProcessorResult, index: number, total: number) => void;
  onError: (asset: FlowAsset, error: unknown, index: number, total: number) => void;
  onCancelled: (asset: FlowAsset, index: number, total: number) => void;
}

export async function runSequentialImageBatch(
  assets: FlowAsset[],
  signal: AbortSignal,
  processor: (file: File, options: ProcessorOptions, asset: FlowAsset) => Promise<ProcessorResult>,
  callbacks: BatchCallbacks,
): Promise<void> {
  for (let index = 0; index < assets.length; index += 1) {
    const asset = assets[index];
    if (signal.aborted) {
      assets.slice(index).forEach((pending, offset) => callbacks.onCancelled(pending, index + offset, assets.length));
      return;
    }
    callbacks.onStart(asset, index, assets.length);
    try {
      const file = await asset.loadFile();
      const result = await processor(file, {
        signal,
        onProgress: (progress) => callbacks.onProgress(asset, progress.progress, progress.message, index, assets.length),
      }, asset);
      // A metadata-only result never "applies" a watermark repair, but its stripped file is the result.
      const keep = result.detection.applied || result.operation === 'metadata';
      callbacks.onComplete(
        asset,
        keep ? result : { ...result, blob: file, mimeType: file.type, fileName: file.name },
        index,
        assets.length,
      );
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        callbacks.onCancelled(asset, index, assets.length);
        assets.slice(index + 1).forEach((pending, offset) => callbacks.onCancelled(pending, index + 1 + offset, assets.length));
        return;
      }
      callbacks.onError(asset, error, index, assets.length);
    }
  }
}

const shortLabels = (kinds: MetadataKind[]) => kinds.map((kind) => METADATA_LABELS[kind]).join(', ');

/** Card state and wording for a finished batch item. `before` is the scan of the file as imported. */
export function describeBatchResult(
  result: ProcessorResult,
  before: MetadataReport | null | undefined,
): { state: Extract<FlowBatchState, 'complete' | 'clean'>; message: string } {
  if (result.operation === 'metadata' && result.detection.decisionTier !== 'metadata-only') {
    // One-button clean on an image without a removable mark: the picture is kept, its metadata is not.
    const kept = result.detection.repairMode === 'unchanged-unsafe'
      ? result.detection.qualityWarning ?? 'Unsafe removal avoided; picture kept'
      : 'No supported mark found; picture kept';
    const leftover = result.metadata?.after.found ?? [];
    return { state: 'clean', message: leftover.length ? `${kept}, still has ${shortLabels(leftover)}` : `${kept}, metadata removed` };
  }
  if (result.operation === 'metadata') {
    const source = result.metadata?.before ?? before;
    if (source && source.container !== 'unknown' && source.found.length === 0) {
      return { state: 'clean', message: 'No hidden metadata; original kept' };
    }
    const leftover = result.metadata?.after.found ?? [];
    if (leftover.length) return { state: 'complete', message: `Metadata partly removed; still has ${shortLabels(leftover)}` };
    return {
      state: 'complete',
      message: source?.container === 'unknown' ? 'Converted to PNG, metadata removed' : 'Metadata removed, pixels unchanged',
    };
  }
  if (result.detection.applied) {
    const mode = result.detection.repairMode;
    const repair = mode === 'content-aware-lama'
      ? 'Visible mark repaired with best-quality AI fill'
      : mode === 'bounded-texture' || mode?.startsWith('content-aware') ? 'Visible mark repaired with content-aware fill' : 'Visible mark repaired';
    const leftover = result.metadata?.after.found ?? [];
    const metaNote = leftover.length ? `; still has ${shortLabels(leftover)}` : before?.found.length ? ' and metadata removed' : '';
    const fallback = result.notice ? ' (best-quality model unavailable, standard fill used)' : '';
    return { state: 'complete', message: `${repair}${metaNote}${fallback}` };
  }
  const kept = result.detection.repairMode === 'unchanged-unsafe'
    ? result.detection.qualityWarning ?? 'Unsafe removal avoided; original kept'
    : 'No supported mark found; original kept';
  return { state: 'clean', message: before?.found.length ? `${kept} (it still has hidden metadata)` : kept };
}
