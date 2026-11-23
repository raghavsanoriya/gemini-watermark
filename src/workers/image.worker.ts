/// <reference lib="webworker" />

import { browserLamaSessionFactory } from '../lib/processors/lama-inpaint';
import { cleanImageData } from '../lib/processors/pipeline';
import type { RepairQuality } from '../types/media';

interface ImageWorkerRequest {
  id: string;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  quality?: RepairQuality;
}

const workerScope: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

workerScope.onmessage = async (event: MessageEvent<ImageWorkerRequest>) => {
  const { id, width, height, buffer, quality } = event.data;
  const status = (message: string, fraction?: number) => workerScope.postMessage({ id, kind: 'progress', message, fraction });
  try {
    let lamaError: string | null = null;
    const result = await cleanImageData({ width, height, data: new Uint8ClampedArray(buffer) }, {
      quality,
      // The best-quality model is only fetched if a repaint is actually needed.
      lamaSessionFactory: async () => {
        status('Downloading the best-quality AI model (92 MB, first time only)…', 0);
        let lastPercent = -1;
        const session = await browserLamaSessionFactory(({ loaded, total }) => {
          const percent = Math.floor((loaded / total) * 100);
          if (percent !== lastPercent) {
            lastPercent = percent;
            if (loaded >= total) status('Preparing the best-quality AI model…', 1);
            else status(`Downloading the best-quality AI model (92 MB, first time only)… ${percent}%`, loaded / total);
          }
        })();
        status('Repainting with the best-quality AI model. This can take a minute…');
        return session;
      },
      onLamaError: (error) => { lamaError = error instanceof Error ? error.message : String(error); },
    });
    const output = result.imageData.data.buffer as ArrayBuffer;
    workerScope.postMessage(
      { id, ok: true, width, height, buffer: output, meta: result.meta, lamaError },
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
