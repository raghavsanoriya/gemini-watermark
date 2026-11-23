import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { nodeMiganSessionFactory } from '@/server/migan-node';
import { lamaWindow, resamplePlanar, type LamaSessionFactory } from './lama-inpaint';
import type { Session } from './migan-inpaint';
import { cleanImageData } from './pipeline';
import { outlineResidual, OUTLINE_RESIDUAL_SCORE } from './template-search';

const models = join(process.cwd(), 'public', 'vendor', 'models');
const lamaPath = join(models, 'lama-inpainting-2025jan.onnx');
const bothModels = existsSync(lamaPath) && existsSync(join(models, 'migan-pipeline-v2.onnx'));

const nodeLamaSessionFactory: LamaSessionFactory = async () => {
  const ort = await import('onnxruntime-web/wasm');
  ort.env.wasm.numThreads = 4;
  ort.env.wasm.wasmBinary = new Uint8Array(await readFile(join(process.cwd(), 'node_modules', 'onnxruntime-web', 'dist', 'ort-wasm-simd-threaded.wasm')));
  return await ort.InferenceSession.create(new Uint8Array(await readFile(lamaPath)), {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  }) as unknown as Session;
};

async function resizedDemo(width: number) {
  const bytes = await sharp(join(process.cwd(), 'public', 'demo', 'timber-before.jpg')).resize(width).jpeg({ quality: 88 }).toBuffer();
  const { data, info } = await sharp(bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}

describe('LaMa window and resampling', () => {
  it('uses the full 512px window when the image allows and fits smaller images', () => {
    const mask = (width: number, height: number, x: number, y: number) => {
      const out = new Uint8Array(width * height);
      for (let dy = 0; dy < 30; dy += 1) out.fill(1, (y + dy) * width + x, (y + dy) * width + x + 30);
      return out;
    };
    const big = { width: 1200, height: 900, data: new Uint8ClampedArray(1200 * 900 * 4) };
    expect(lamaWindow(big, mask(1200, 900, 1100, 820))).toEqual({ x: 688, y: 388, width: 512, height: 512 });
    const small = { width: 400, height: 300, data: new Uint8ClampedArray(400 * 300 * 4) };
    expect(lamaWindow(small, mask(400, 300, 350, 250))).toMatchObject({ width: 300, height: 300, x: 100, y: 0 });
    const tiny = { width: 50, height: 50, data: new Uint8ClampedArray(50 * 50 * 4) };
    expect(lamaWindow(tiny, mask(50, 50, 10, 10))).toBeNull();
  });

  it('resamples planes up and back down without drifting', () => {
    const plane = Float32Array.from({ length: 2 * 4 * 4 }, (_, i) => (i < 16 ? 100 : 200));
    expect(Array.from(resamplePlanar(plane, 4, 4, 2))).toEqual(Array.from(plane));
    const round = resamplePlanar(resamplePlanar(plane, 4, 8, 2), 8, 4, 2);
    round.forEach((value, i) => expect(Math.abs(value - plane[i])).toBeLessThan(1e-3));
  });
});

describe('best-quality repair', () => {
  it.skipIf(!bothModels)('falls back to MI-GAN when the best-quality model cannot load', async () => {
    const onLamaError = vi.fn();
    const result = await cleanImageData(await resizedDemo(688), {
      quality: 'best',
      lamaSessionFactory: async () => { throw new Error('offline'); },
      onLamaError,
      miganSessionFactory: nodeMiganSessionFactory,
    });
    expect(onLamaError).toHaveBeenCalledOnce();
    expect((result.meta as { repairMode?: string }).repairMode).toBe('content-aware-migan');
  }, 120_000);

  it.skipIf(!bothModels)('repaints the leftover outline with LaMa when asked', async () => {
    const result = await cleanImageData(await resizedDemo(688), {
      quality: 'best',
      lamaSessionFactory: nodeLamaSessionFactory,
      miganSessionFactory: nodeMiganSessionFactory,
    });
    expect((result.meta as { repairMode?: string }).repairMode).toBe('content-aware-lama');
    expect(await outlineResidual(result.imageData, result.meta.position!)).toBeLessThan(OUTLINE_RESIDUAL_SCORE);
  }, 240_000);
});
