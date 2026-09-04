import { outputFileName, ProcessorError } from '@/lib/media';
import type { ProcessorOptions, ProcessorResult, WatermarkDetection } from '@/types/media';

interface WorkerSuccess {
  id: string;
  ok: true;
  width: number;
  height: number;
  buffer: ArrayBuffer;
  meta: {
    applied: boolean;
    decisionTier: string | null;
    skipReason: string | null;
    size: number | null;
    position: WatermarkDetection['position'];
    repairMode?: WatermarkDetection['repairMode'];
    repairSafety?: WatermarkDetection['repairSafety'];
    qualityStatus?: string | null;
    qualityWarning?: string | null;
  };
}

interface WorkerFailure {
  id: string;
  ok: false;
  message: string;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new ProcessorError('encode-failed', 'The cleaned image could not be encoded.')),
      type,
      quality
    );
  });
}

function runImageWorker(imageData: ImageData, signal: AbortSignal): Promise<WorkerSuccess> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../../workers/image.worker.ts', import.meta.url), { type: 'module' });
    const id = crypto.randomUUID();

    const stop = () => {
      worker.terminate();
      reject(new DOMException('Image processing cancelled.', 'AbortError'));
    };

    signal.addEventListener('abort', stop, { once: true });
    worker.onerror = (event) => {
      signal.removeEventListener('abort', stop);
      worker.terminate();
      reject(new ProcessorError('processing-failed', event.message || 'The image worker failed.'));
    };
    worker.onmessage = (event: MessageEvent<WorkerSuccess | WorkerFailure>) => {
      if (event.data.id !== id) return;
      signal.removeEventListener('abort', stop);
      worker.terminate();
      if (event.data.ok) resolve(event.data);
      else reject(new ProcessorError('processing-failed', event.data.message));
    };

    const buffer = imageData.data.buffer as ArrayBuffer;
    worker.postMessage({ id, width: imageData.width, height: imageData.height, buffer }, [buffer]);
  });
}

export async function processImage(file: File, options: ProcessorOptions): Promise<ProcessorResult> {
  const { signal, onProgress } = options;
  onProgress({ phase: 'detecting', progress: 0.04, message: 'Reading image pixels…' });

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    throw new ProcessorError('decode-failed', 'This browser could not decode the selected image.', { cause: error });
  }
  if (signal.aborted) {
    bitmap.close();
    throw new DOMException('Image processing cancelled.', 'AbortError');
  }

  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) {
    bitmap.close();
    throw new ProcessorError('processing-failed', 'Canvas processing is unavailable in this browser.');
  }
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  onProgress({ phase: 'processing', progress: 0.18, message: 'Locating the calibrated Gemini mark…' });
  const output = await runImageWorker(context.getImageData(0, 0, canvas.width, canvas.height), signal);
  const pixels = new ImageData(new Uint8ClampedArray(output.buffer), output.width, output.height);
  context.putImageData(pixels, 0, 0);

  onProgress({ phase: 'encoding', progress: 0.9, message: 'Preparing the cleaned image…' });
  const mimeType = file.type === 'image/png' || file.type === 'image/webp' ? file.type : 'image/jpeg';
  const blob = await canvasToBlob(canvas, mimeType, mimeType === 'image/png' ? undefined : 0.96);
  onProgress({ phase: 'encoding', progress: 1, message: 'Image ready.' });

  return {
    blob,
    mimeType,
    fileName: outputFileName(file.name, 'image', mimeType),
    detection: {
      applied: output.meta.applied,
      decisionTier: output.meta.decisionTier,
      skipReason: output.meta.skipReason,
      size: output.meta.size,
      position: output.meta.position,
      repairMode: output.meta.repairMode,
      repairSafety: output.meta.repairSafety,
      qualityStatus: output.meta.qualityStatus,
      qualityWarning: output.meta.qualityWarning,
    },
  };
}
