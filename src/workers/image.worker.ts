/// <reference lib="webworker" />

import { cleanImageData } from '../lib/processors/pipeline';

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
    const result = await cleanImageData({ width, height, data: new Uint8ClampedArray(buffer) });
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
