import {
  createWatermarkEngine,
  removeRepeatedWatermarkLayers,
  type ImageDataRemovalResult,
  type WatermarkEngine,
  type WatermarkMeta,
} from '@pilio/gemini-watermark-remover';
import type { PixelImageData } from './image-panorama-fallback';

/**
 * Fallback for marks the engine's size catalog does not predict, e.g. a Gemini
 * image that another tool resized or re-cropped so the sparkle sits at an
 * unusual offset. Searches the bottom-right corner for the calibrated sparkle
 * shape at any position and a range of sizes, then removes it with the
 * library's reverse-alpha routine using the best-fitting opacity.
 */

/** Normalized correlation a match must reach before anything is changed. */
export const MIN_MATCH_SCORE = 0.6;
/** The sparkle outline must line up too. JPEG-softened real marks score ~0.3; smooth textures stay under ~0.16. */
export const MIN_EDGE_SCORE = 0.25;
/** After removal, the sparkle shape must be mostly gone. */
const MAX_RESIDUAL_SCORE = 0.3;
const MIN_SIZE = 32;
const MAX_SIZE = 112;

interface Position { x: number; y: number; width: number; height: number }

export interface TemplateMatch {
  position: Position;
  score: number;
  edgeScore: number;
}

let enginePromise: Promise<WatermarkEngine> | undefined;
const getEngine = () => (enginePromise ??= createWatermarkEngine());

function luminancePlane(image: PixelImageData, left: number, top: number, width: number, height: number): Float32Array {
  const plane = new Float32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = ((top + y) * image.width + left + x) * 4;
      plane[y * width + x] = image.data[index] * 0.2126 + image.data[index + 1] * 0.7152 + image.data[index + 2] * 0.0722;
    }
  }
  return plane;
}

function downsample2(plane: Float32Array, width: number, height: number): { plane: Float32Array; width: number; height: number } {
  const w = Math.floor(width / 2);
  const h = Math.floor(height / 2);
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = 2 * y * width + 2 * x;
      out[y * w + x] = (plane[i] + plane[i + 1] + plane[i + width] + plane[i + width + 1]) / 4;
    }
  }
  return { plane: out, width: w, height: h };
}

/** Integral images of values and squared values for O(1) patch mean/variance. */
function integrals(plane: Float32Array, width: number, height: number) {
  const sum = new Float64Array((width + 1) * (height + 1));
  const sq = new Float64Array((width + 1) * (height + 1));
  for (let y = 0; y < height; y += 1) {
    let rowSum = 0;
    let rowSq = 0;
    for (let x = 0; x < width; x += 1) {
      const value = plane[y * width + x];
      rowSum += value;
      rowSq += value * value;
      const index = (y + 1) * (width + 1) + x + 1;
      sum[index] = sum[index - (width + 1)] + rowSum;
      sq[index] = sq[index - (width + 1)] + rowSq;
    }
  }
  const box = (table: Float64Array, x: number, y: number, size: number) => {
    const stride = width + 1;
    return table[(y + size) * stride + x + size] - table[y * stride + x + size] - table[(y + size) * stride + x] + table[y * stride + x];
  };
  return { sum: (x: number, y: number, size: number) => box(sum, x, y, size), sq: (x: number, y: number, size: number) => box(sq, x, y, size) };
}

/** Zero-mean template and its norm, so correlation needs one dot product per position. */
function centered(template: Float32Array): { values: Float32Array; norm: number } {
  let mean = 0;
  for (const value of template) mean += value;
  mean /= template.length;
  const values = new Float32Array(template.length);
  let norm = 0;
  for (let i = 0; i < template.length; i += 1) {
    values[i] = template[i] - mean;
    norm += values[i] * values[i];
  }
  return { values, norm: Math.sqrt(norm) };
}

function bestPosition(
  plane: Float32Array,
  width: number,
  height: number,
  template: Float32Array,
  size: number,
  xs: [number, number],
  ys: [number, number],
  table = integrals(plane, width, height),
): { x: number; y: number; score: number } {
  const { values, norm } = centered(template);
  const n = size * size;
  let best = { x: 0, y: 0, score: -1 };
  if (norm === 0) return best;
  for (let y = Math.max(0, ys[0]); y <= Math.min(height - size, ys[1]); y += 1) {
    for (let x = Math.max(0, xs[0]); x <= Math.min(width - size, xs[1]); x += 1) {
      const sum = table.sum(x, y, size);
      const variance = table.sq(x, y, size) - (sum * sum) / n;
      if (variance <= 1e-6) continue;
      let dot = 0;
      for (let ty = 0; ty < size; ty += 1) {
        const row = (y + ty) * width + x;
        const trow = ty * size;
        for (let tx = 0; tx < size; tx += 1) dot += plane[row + tx] * values[trow + tx];
      }
      const score = dot / (norm * Math.sqrt(variance));
      if (score > best.score) best = { x, y, score };
    }
  }
  return best;
}

function downsampleTemplate(alpha: Float32Array, size: number): Float32Array {
  return downsample2(alpha, size, size).plane;
}

/** Finds the best sparkle match in the bottom-right corner, or null when none is convincing. */
export async function locateMarkByTemplate(image: PixelImageData): Promise<TemplateMatch | null> {
  const engine = await getEngine();
  const region = Math.min(320, Math.floor(Math.min(image.width, image.height) * 0.3));
  if (region < MIN_SIZE + 8) return null;
  const left = image.width - region;
  const top = image.height - region;
  const full = luminancePlane(image, left, top, region, region);

  // Coarse pass at half resolution over sizes 32-112.
  const half = downsample2(full, region, region);
  const halfTable = integrals(half.plane, half.width, half.height);
  let coarse = { size: 0, x: 0, y: 0, score: -1 };
  for (let size = MIN_SIZE; size <= MAX_SIZE; size += 4) {
    const halfSize = Math.floor(size / 2);
    const template = downsampleTemplate(await engine.getAlphaMap(size), size).subarray(0, halfSize * halfSize);
    const hit = bestPosition(half.plane, half.width, half.height, template, halfSize, [0, half.width], [0, half.height], halfTable);
    if (hit.score > coarse.score) coarse = { size, x: hit.x * 2, y: hit.y * 2, score: hit.score };
  }
  if (coarse.score < MIN_MATCH_SCORE - 0.1) return null;

  // Refine at full resolution around the coarse hit.
  const fullTable = integrals(full, region, region);
  let fine = { size: coarse.size, x: coarse.x, y: coarse.y, score: -1 };
  for (let size = coarse.size - 3; size <= coarse.size + 3; size += 1) {
    const hit = bestPosition(full, region, region, await engine.getAlphaMap(size), size,
      [coarse.x - 4, coarse.x + 4], [coarse.y - 4, coarse.y + 4], fullTable);
    if (hit.score > fine.score) fine = { size, x: hit.x, y: hit.y, score: hit.score };
  }
  if (fine.score < MIN_MATCH_SCORE) return null;
  const position = { x: left + fine.x, y: top + fine.y, width: fine.size, height: fine.size };
  const edges = edgeScore(image, await engine.getAlphaMap(fine.size), position);
  if (edges < MIN_EDGE_SCORE) return null;
  return { position, score: fine.score, edgeScore: edges };
}

function gradientMagnitude(plane: Float32Array, size: number): Float32Array {
  const out = new Float32Array(size * size);
  for (let y = 1; y < size - 1; y += 1) {
    for (let x = 1; x < size - 1; x += 1) {
      const i = y * size + x;
      out[i] = Math.hypot(plane[i + 1] - plane[i - 1], plane[i + size] - plane[i - size]);
    }
  }
  return out;
}

/** Correlation between the patch's edge strength and the template's edge strength. */
export function edgeScore(image: PixelImageData, alpha: Float32Array, position: Position): number {
  const size = position.width;
  const patch = gradientMagnitude(luminancePlane(image, position.x, position.y, size, size), size);
  const template = centered(gradientMagnitude(alpha, size));
  let mean = 0;
  for (const value of patch) mean += value;
  mean /= patch.length;
  let dot = 0;
  let variance = 0;
  for (let i = 0; i < patch.length; i += 1) {
    dot += (patch[i] - mean) * template.values[i];
    variance += (patch[i] - mean) ** 2;
  }
  return variance > 1e-6 && template.norm > 0 ? dot / (template.norm * Math.sqrt(variance)) : 0;
}

function shapeScore(image: PixelImageData, alpha: Float32Array, position: Position): number {
  const plane = luminancePlane(image, position.x, position.y, position.width, position.height);
  const { values, norm } = centered(alpha);
  let mean = 0;
  for (const value of plane) mean += value;
  mean /= plane.length;
  let dot = 0;
  let variance = 0;
  for (let i = 0; i < plane.length; i += 1) {
    dot += (plane[i] - mean) * values[i];
    variance += (plane[i] - mean) ** 2;
  }
  return variance > 1e-6 && norm > 0 ? dot / (norm * Math.sqrt(variance)) : 0;
}

/**
 * Removes a mark the catalog missed. Returns a result shaped like the engine's,
 * so the normal residual check and MI-GAN repair can follow, or null.
 */
export async function removeMarkByTemplateSearch(image: PixelImageData): Promise<ImageDataRemovalResult | null> {
  return removeMarkAt(image, await locateMarkByTemplate(image));
}

/** Reverse-alpha removal at a located match with the best-fitting opacity. */
export async function removeMarkAt(image: PixelImageData, match: TemplateMatch | null): Promise<ImageDataRemovalResult | null> {
  if (!match) return null;
  const engine = await getEngine();
  const alpha = await engine.getAlphaMap(match.position.width);

  let best: { gain: number; residual: number; imageData: PixelImageData } | null = null;
  for (let gain = 0.5; gain <= 1.5001; gain += 0.05) {
    const pass = removeRepeatedWatermarkLayers(image, alpha, match.position, { alphaGain: gain, maxPasses: 1 }) as { imageData: PixelImageData };
    const residual = Math.abs(shapeScore(pass.imageData, alpha, match.position));
    if (!best || residual < best.residual) best = { gain, residual, imageData: pass.imageData };
  }
  if (!best || best.residual > MAX_RESIDUAL_SCORE) return null;

  const meta = {
    applied: true,
    skipReason: null,
    size: match.position.width,
    position: match.position,
    config: null,
    detection: { adaptiveConfidence: match.score, originalSpatialScore: match.score, processedSpatialScore: best.residual },
    source: 'gemclean-template-search',
    decisionTier: 'template-search',
    alphaGain: Number(best.gain.toFixed(2)),
    passCount: 1,
    attemptedPassCount: 1,
    passStopReason: null,
    qualityStatus: 'clean',
    selectionConfidence: match.score,
  };
  return {
    imageData: { width: image.width, height: image.height, data: new Uint8ClampedArray(best.imageData.data) },
    meta: meta as unknown as WatermarkMeta,
  };
}
