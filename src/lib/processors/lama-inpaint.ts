/*
 * Optional "Best quality" repair with LaMa (big-lama), OpenCV Zoo ONNX export, Apache-2.0.
 * See THIRD_PARTY_NOTICES.md. It fills hair, fabric edges and texture boundaries more faithfully
 * than MI-GAN, but the model is 92 MB and one fill takes tens of seconds on a CPU, so it only
 * runs when the user asks for it and the pipeline falls back to MI-GAN if it cannot.
 */

import type { PixelImageData } from './image-panorama-fallback';
import type { InpaintModel, MiganWindow, Session } from './migan-inpaint';

/** The network's fixed input size. */
export const LAMA_SIZE = 512;
export const LAMA_MODEL_BYTES = 92_591_623;
const MODEL_PATH = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/vendor/models/lama-inpainting-2025jan.onnx`;

export type LamaSessionFactory = () => Promise<Session>;
export interface LamaDownloadProgress { loaded: number; total: number }

let sessionPromise: Promise<Session> | undefined;

async function loadSession(factory: LamaSessionFactory): Promise<Session> {
  if (!sessionPromise) sessionPromise = factory();
  try {
    return await sessionPromise;
  } catch (error) {
    sessionPromise = undefined;
    throw error;
  }
}

/** Downloads the self-hosted model with progress, then opens it with ONNX Runtime's WebAssembly backend. */
export function browserLamaSessionFactory(onDownload?: (progress: LamaDownloadProgress) => void): LamaSessionFactory {
  return async () => {
    const response = await fetch(MODEL_PATH);
    if (!response.ok || !response.body) throw new Error(`The best-quality model could not be downloaded (${response.status}).`);
    const total = Number(response.headers.get('content-length')) || LAMA_MODEL_BYTES;
    const bytes = new Uint8Array(total);
    const reader = response.body.getReader();
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (loaded + value.length > bytes.length) throw new Error('The best-quality model download was larger than expected.');
      bytes.set(value, loaded);
      loaded += value.length;
      onDownload?.({ loaded, total });
    }
    const ort = await import('onnxruntime-web/wasm');
    // Threads need cross-origin isolation, which this site does not enable.
    ort.env.wasm.numThreads = globalThis.crossOriginIsolated ? Math.min(4, globalThis.navigator?.hardwareConcurrency ?? 1) : 1;
    return await ort.InferenceSession.create(bytes.subarray(0, loaded), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    }) as unknown as Session;
  };
}

/** A square window centred on the hole: LaMa's full 512px when the image allows, else as large as fits. */
export function lamaWindow(image: PixelImageData, mask: Uint8Array): MiganWindow | null {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (mask[y * image.width + x] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const side = Math.min(LAMA_SIZE, image.width, image.height);
  // Too small to give the network useful context around the hole.
  if (side < Math.max(64, (Math.max(maxX - minX, maxY - minY) + 1) * 2)) return null;
  const centerX = Math.round((minX + maxX) / 2);
  const centerY = Math.round((minY + maxY) / 2);
  return {
    x: Math.max(0, Math.min(image.width - side, centerX - Math.round(side / 2))),
    y: Math.max(0, Math.min(image.height - side, centerY - Math.round(side / 2))),
    width: side,
    height: side,
  };
}

/** Bilinear resampling of a planar `channels` x side x side plane to `to` x `to`. */
export function resamplePlanar(input: ArrayLike<number>, from: number, to: number, channels: number): Float32Array {
  if (from === to) return Float32Array.from(input);
  const out = new Float32Array(channels * to * to);
  const scale = from / to;
  for (let c = 0; c < channels; c += 1) {
    const base = c * from * from;
    for (let y = 0; y < to; y += 1) {
      const sy = Math.min(from - 1, Math.max(0, (y + 0.5) * scale - 0.5));
      const y0 = Math.floor(sy);
      const y1 = Math.min(from - 1, y0 + 1);
      const fy = sy - y0;
      for (let x = 0; x < to; x += 1) {
        const sx = Math.min(from - 1, Math.max(0, (x + 0.5) * scale - 0.5));
        const x0 = Math.floor(sx);
        const x1 = Math.min(from - 1, x0 + 1);
        const fx = sx - x0;
        const top = input[base + y0 * from + x0] * (1 - fx) + input[base + y0 * from + x1] * fx;
        const bottom = input[base + y1 * from + x0] * (1 - fx) + input[base + y1 * from + x1] * fx;
        out[c * to * to + y * to + x] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return out;
}

export function lamaModel(sessionFactory: LamaSessionFactory = browserLamaSessionFactory()): InpaintModel {
  return {
    name: 'lama',
    window: lamaWindow,
    fill: async (packed, window) => {
      const side = window.width;
      const plane = LAMA_SIZE * LAMA_SIZE;
      // The export takes BGR in 0..1 and a 0/1 hole mask; the packed mask is 0 = hole.
      const rgb = resamplePlanar(packed.image, side, LAMA_SIZE, 3);
      const hole = resamplePlanar(Float32Array.from(packed.mask, (value) => (value === 0 ? 1 : 0)), side, LAMA_SIZE, 1);
      const image = new Float32Array(3 * plane);
      const mask = new Float32Array(plane);
      for (let i = 0; i < plane; i += 1) {
        const isHole = hole[i] > 0 ? 1 : 0;
        mask[i] = isHole;
        for (let c = 0; c < 3; c += 1) image[(2 - c) * plane + i] = isHole ? 0 : rgb[c * plane + i] / 255;
      }
      const ort = await import('onnxruntime-web/wasm');
      const session = await loadSession(sessionFactory);
      const outputs = await session.run({
        image: new ort.Tensor('float32', image, [1, 3, LAMA_SIZE, LAMA_SIZE]),
        mask: new ort.Tensor('float32', mask, [1, 1, LAMA_SIZE, LAMA_SIZE]),
      });
      const result = Object.values(outputs)[0]?.data as unknown;
      if (!(result instanceof Float32Array) || result.length !== 3 * plane) return null;
      const bgrToRgb = new Float32Array(3 * plane);
      for (let c = 0; c < 3; c += 1) bgrToRgb.set(result.subarray((2 - c) * plane, (3 - c) * plane), c * plane);
      const filled = resamplePlanar(bgrToRgb, LAMA_SIZE, side, 3);
      return Uint8Array.from(filled, (value) => Math.max(0, Math.min(255, Math.round(value))));
    },
  };
}
