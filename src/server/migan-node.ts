import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { MiganSessionFactory, Session } from '@/lib/processors/migan-inpaint';

/**
 * Loads the same pinned MI-GAN model the browser uses, from `public/vendor/models`
 * (downloaded by `npm run assets`), and runs it with onnxruntime-web's WebAssembly
 * backend inside Node so the server and browser produce the same repairs.
 */
export const nodeMiganSessionFactory: MiganSessionFactory = async () => {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 1;
  // Serverless bundlers can relocate external packages, which makes ONNX
  // Runtime's module-relative WebAssembly lookup unreliable. Resolve the
  // external package from the deployed project and provide the binary
  // directly so inference does not depend on a runtime URL or filesystem
  // layout inferred from import.meta.url.
  const requireFromProject = createRequire(join(process.cwd(), 'package.json'));
  const ortDist = dirname(requireFromProject.resolve('onnxruntime-web/wasm'));
  const [wasm, model] = await Promise.all([
    readFile(join(ortDist, 'ort-wasm-simd-threaded.wasm')),
    readFile(join(process.cwd(), 'public', 'vendor', 'models', 'migan-pipeline-v2.onnx')),
  ]);
  ort.env.wasm.wasmBinary = new Uint8Array(wasm);
  return await ort.InferenceSession.create(new Uint8Array(model), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  }) as unknown as Session;
};
