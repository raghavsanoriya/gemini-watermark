/// <reference lib="webworker" />

import { removeWatermarkFromImageDataSync } from '@pilio/gemini-watermark-remover/image-data';
import { repairDetectedResidual, tryPanoramaImageFallback } from '../lib/processors/image-panorama-fallback';
import { improveWithMigan } from '../lib/processors/migan-inpaint';

interface ImageWorkerRequest {
  id: string;
  width: number;
  height: number;
  buffer: ArrayBuffer;
}

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<ImageWorkerRequest>) => {
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
    let result = primary.meta.applied
      ? repairDetectedResidual(original, primary)
      : tryPanoramaImageFallback(source, removeWatermarkFromImageDataSync) ?? primary;
    try {
      result = await improveWithMigan(original, primary.imageData, result);
    } catch {
      // The optional model may be unavailable offline. Telea remains a fully
      // local, deterministic result and has already passed the safety gate.
    }
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
