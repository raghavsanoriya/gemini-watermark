/*
 * MI-GAN browser fallback adapted from maxgfr/unmark (MIT).
 * Model: Picsart AI Research MI-GAN (MIT). See THIRD_PARTY_NOTICES.md.
 */

import type { ImageDataRemovalResult, WatermarkMeta } from '@pilio/gemini-watermark-remover';
import type { ImageRepairMode } from '@/types/media';
import type { ExtendedMeta, PixelImageData } from './image-panorama-fallback';
import { isBoundedTextureRepairSafe } from './image-panorama-fallback';

const ALIGNMENT = 8;
const MIN_WINDOW = 256;
const MAX_WINDOW = 512;
const MODEL_PATH = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/vendor/models/migan-pipeline-v2.onnx`;

type Session = {
  run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: Uint8Array }>>;
};

let sessionPromise: Promise<Session> | undefined;

const clonePixels = (image: PixelImageData): PixelImageData => ({
  width: image.width,
  height: image.height,
  data: new Uint8ClampedArray(image.data),
});

async function loadSession(): Promise<Session> {
  if (!sessionPromise) {
    sessionPromise = (async () => {
      const ort = await import('onnxruntime-web/wasm');
      ort.env.wasm.numThreads = 1;
      return await ort.InferenceSession.create(MODEL_PATH, {
        executionProviders: ['wasm'],
        graphOptimizationLevel: 'all',
      }) as unknown as Session;
    })();
  }
  try {
    return await sessionPromise;
  } catch (error) {
    sessionPromise = undefined;
    throw error;
  }
}

function dilate(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  let current = mask;
  for (let pass = 0; pass < radius; pass += 1) {
    const next = new Uint8Array(current);
    for (let y = 1; y < height - 1; y += 1) {
      for (let x = 1; x < width - 1; x += 1) {
        const index = y * width + x;
        if (current[index] === 0) continue;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) next[index + dy * width + dx] = 1;
        }
      }
    }
    current = next;
  }
  return current;
}

export function createMiganMask(
  source: PixelImageData,
  reverseAlpha: PixelImageData,
  position: NonNullable<WatermarkMeta['position']>,
): Uint8Array {
  const mask = new Uint8Array(source.width * source.height);
  let changed = 0;
  const left = Math.max(0, position.x);
  const top = Math.max(0, position.y);
  const right = Math.min(source.width, position.x + position.width);
  const bottom = Math.min(source.height, position.y + position.height);

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const rgba = (y * source.width + x) * 4;
      const difference = Math.max(
        Math.abs(source.data[rgba] - reverseAlpha.data[rgba]),
        Math.abs(source.data[rgba + 1] - reverseAlpha.data[rgba + 1]),
        Math.abs(source.data[rgba + 2] - reverseAlpha.data[rgba + 2]),
      );
      if (difference >= 1) {
        mask[y * source.width + x] = 1;
        changed += 1;
      }
    }
  }

  if (changed < Math.max(16, Math.floor(position.width * position.height * 0.02))) {
    for (let y = top; y < bottom; y += 1) mask.fill(1, y * source.width + left, y * source.width + right);
  }
  return dilate(mask, source.width, source.height, Math.max(4, Math.min(7, Math.ceil(position.width * 0.11))));
}

export interface MiganWindow {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function windowForMask(image: PixelImageData, mask: Uint8Array): MiganWindow | null {
  let minX = image.width;
  let minY = image.height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < image.height; y += 1) {
    for (let x = 0; x < image.width; x += 1) {
      if (mask[y * image.width + x] === 0) continue;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  if (maxX < 0) return null;
  const holeSize = Math.max(maxX - minX + 1, maxY - minY + 1);
  const available = Math.floor(Math.min(image.width, image.height) / ALIGNMENT) * ALIGNMENT;
  const side = Math.min(MAX_WINDOW, available, Math.max(MIN_WINDOW, Math.ceil(holeSize * 3 / ALIGNMENT) * ALIGNMENT));
  if (side < ALIGNMENT) return null;
  const centerX = Math.round((minX + maxX) / 2);
  const centerY = Math.round((minY + maxY) / 2);
  return {
    x: Math.max(0, Math.min(image.width - side, centerX - Math.round(side / 2))),
    y: Math.max(0, Math.min(image.height - side, centerY - Math.round(side / 2))),
    width: side,
    height: side,
  };
}

export function packMiganWindow(
  image: PixelImageData,
  mask: Uint8Array,
  window: MiganWindow,
): { image: Uint8Array; mask: Uint8Array } {
  const plane = window.width * window.height;
  const packedImage = new Uint8Array(plane * 3);
  const packedMask = new Uint8Array(plane).fill(255);
  for (let y = 0; y < window.height; y += 1) {
    for (let x = 0; x < window.width; x += 1) {
      const sourcePixel = (window.y + y) * image.width + window.x + x;
      const sourceRgba = sourcePixel * 4;
      const target = y * window.width + x;
      packedImage[target] = image.data[sourceRgba];
      packedImage[plane + target] = image.data[sourceRgba + 1];
      packedImage[plane * 2 + target] = image.data[sourceRgba + 2];
      if (mask[sourcePixel] !== 0) packedMask[target] = 0;
    }
  }
  return { image: packedImage, mask: packedMask };
}

export function compositeMiganWindow(
  image: PixelImageData,
  mask: Uint8Array,
  window: MiganWindow,
  modelOutput: Uint8Array,
): PixelImageData {
  const output = clonePixels(image);
  const plane = window.width * window.height;
  for (let y = 0; y < window.height; y += 1) {
    for (let x = 0; x < window.width; x += 1) {
      const outputPixel = (window.y + y) * image.width + window.x + x;
      if (mask[outputPixel] === 0) continue;
      const outputRgba = outputPixel * 4;
      const modelPixel = y * window.width + x;
      output.data[outputRgba] = modelOutput[modelPixel];
      output.data[outputRgba + 1] = modelOutput[plane + modelPixel];
      output.data[outputRgba + 2] = modelOutput[plane * 2 + modelPixel];
    }
  }
  return output;
}

export function boundaryDiscontinuity(image: PixelImageData, mask: Uint8Array): number {
  let difference = 0;
  let comparisons = 0;
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
  for (let y = 1; y < image.height - 1; y += 1) {
    for (let x = 1; x < image.width - 1; x += 1) {
      const pixel = y * image.width + x;
      if (mask[pixel] === 0) continue;
      for (const [dx, dy] of directions) {
        const neighbor = (y + dy) * image.width + x + dx;
        if (mask[neighbor] !== 0) continue;
        const first = pixel * 4;
        const second = neighbor * 4;
        difference += (
          Math.abs(image.data[first] - image.data[second]) +
          Math.abs(image.data[first + 1] - image.data[second + 1]) +
          Math.abs(image.data[first + 2] - image.data[second + 2])
        ) / 3;
        comparisons += 1;
      }
    }
  }
  return comparisons > 0 ? difference / comparisons : Number.POSITIVE_INFINITY;
}

export async function improveWithMigan(
  source: PixelImageData,
  reverseAlpha: PixelImageData,
  teleaResult: ImageDataRemovalResult,
): Promise<ImageDataRemovalResult> {
  const meta = teleaResult.meta as ExtendedMeta;
  if (meta.repairMode !== 'content-aware-telea' || !meta.position) return teleaResult;
  const mask = createMiganMask(source, reverseAlpha, meta.position);
  const window = windowForMask(source, mask);
  if (!window) return teleaResult;

  const packed = packMiganWindow(source, mask, window);
  const ort = await import('onnxruntime-web/wasm');
  const session = await loadSession();
  const tensors = await session.run({
    image: new ort.Tensor('uint8', packed.image, [1, 3, window.height, window.width]),
    mask: new ort.Tensor('uint8', packed.mask, [1, 1, window.height, window.width]),
  });
  const modelOutput = tensors.result?.data;
  if (!(modelOutput instanceof Uint8Array)) return teleaResult;
  const candidate = compositeMiganWindow(source, mask, window, modelOutput);
  if (!isBoundedTextureRepairSafe(source, reverseAlpha, candidate, meta.position)) return teleaResult;

  const teleaBoundary = boundaryDiscontinuity(teleaResult.imageData, mask);
  const miganBoundary = boundaryDiscontinuity(candidate, mask);
  if (miganBoundary > teleaBoundary * 1.05) return teleaResult;

  return {
    imageData: candidate,
    meta: {
      ...meta,
      source: `${meta.source}+migan-content-aware`,
      repairMode: 'content-aware-migan' as ImageRepairMode,
      repairSafety: 'passed',
    } as WatermarkMeta,
  };
}
