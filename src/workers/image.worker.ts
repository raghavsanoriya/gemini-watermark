/// <reference lib="webworker" />

import { removeWatermarkFromImageDataSync } from '@pilio/gemini-watermark-remover/image-data';
import { repairDetectedResidual, tryPanoramaImageFallback } from '../lib/processors/image-panorama-fallback';

interface ImageWorkerRequest {
  id: string;
  width: number;
  height: number;
  buffer: ArrayBuffer;
}

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = (event: MessageEvent<ImageWorkerRequest>) => {
  const { id, width, height, buffer } = event.data;
  try {
    const source = { width, height, data: new Uint8ClampedArray(buffer) };
    const original = { width, height, data: new Uint8ClampedArray(source.data) };
    const primary = removeWatermarkFromImageDataSync(
      source,
      {
        adaptiveMode: 'auto',
        aggressiveLocatedFallback: true,
        locatedAggressiveRemoval: true,
      }
    );
    const result = primary.meta.applied
      ? repairDetectedResidual(original, primary)
      : tryPanoramaImageFallback(source, removeWatermarkFromImageDataSync) ?? primary;
    const output = result.imageData.data.buffer as ArrayBuffer;
    workerScope.postMessage(
      { id, ok: true, width, height, buffer: output, meta: result.meta },
      [output]
    );
  } catch (error) {
    workerScope.postMessage({
      id,
      ok: false,
      message: error instanceof Error ? error.message : 'Image processing failed.',
    });
  }
};

export {};
