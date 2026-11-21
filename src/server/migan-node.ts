import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { MiganSessionFactory, Session } from '@/lib/processors/migan-inpaint';

/**
 * Loads the same pinned MI-GAN model the browser uses, from `public/vendor/models`
 * (downloaded by `npm run assets`), and runs it with onnxruntime-web's WebAssembly
 * backend inside Node so the server and browser produce the same repairs.
 */
export const nodeMiganSessionFactory: MiganSessionFactory = async () => {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  const model = await readFile(join(process.cwd(), 'public', 'vendor', 'models', 'migan-pipeline-v2.onnx'));
  return await ort.InferenceSession.create(new Uint8Array(model), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  }) as unknown as Session;
};
