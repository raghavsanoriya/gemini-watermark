import { isAbortError } from '@/lib/media';
import type { FlowAsset } from '@/types/flow';
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
  processor: (file: File, options: ProcessorOptions) => Promise<ProcessorResult>,
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
      });
      callbacks.onComplete(
        asset,
        result.detection.applied ? result : { ...result, blob: file, mimeType: file.type, fileName: file.name },
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
