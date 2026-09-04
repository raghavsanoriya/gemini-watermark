import type { ImageDataRemovalResult, WatermarkMeta } from '@pilio/gemini-watermark-remover';

export interface PixelImageData {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

type RemovalOptions = {
  adaptiveMode: 'always';
  aggressiveLocatedFallback: true;
  locatedAggressiveRemoval: true;
};

type RemovePixels = (imageData: PixelImageData, options: RemovalOptions) => ImageDataRemovalResult;

export type ExtendedMeta = WatermarkMeta & {
  qualityStatus?: string | null;
  selectionConfidence?: number | null;
  qualitySignals?: {
    imperfections?: {
      detected?: boolean;
      severity?: string;
      score?: number;
    } | null;
  } | null;
};

const NORMALIZED_MIN_DIMENSION = 1025;
const MIN_ADAPTIVE_CONFIDENCE = 0.42;
const MIN_SPATIAL_SCORE = 0.55;
const MIN_GRADIENT_SCORE = 0.25;

function clonePixels(imageData: PixelImageData): PixelImageData {
  return {
    width: imageData.width,
    height: imageData.height,
    data: new Uint8ClampedArray(imageData.data),
  };
}

export function needsPanoramaFallback(imageData: PixelImageData): boolean {
  return imageData.width > 1024 && imageData.height <= 1024 && imageData.width / imageData.height >= 2;
}

export function padPanoramaForDetection(imageData: PixelImageData): {
  imageData: PixelImageData;
  paddingTop: number;
} {
  const paddingTop = Math.max(0, NORMALIZED_MIN_DIMENSION - imageData.height);
  const padded = new Uint8ClampedArray(imageData.width * (imageData.height + paddingTop) * 4);

  for (let index = 3; index < paddingTop * imageData.width * 4; index += 4) {
    padded[index] = 255;
  }
  padded.set(imageData.data, paddingTop * imageData.width * 4);

  return {
    imageData: {
      width: imageData.width,
      height: imageData.height + paddingTop,
      data: padded,
    },
    paddingTop,
  };
}

function isStrongFallbackMatch(meta: ExtendedMeta, paddingTop: number, source: PixelImageData): boolean {
  const position = meta.position;
  const adaptiveConfidence = meta.detection?.adaptiveConfidence ?? 0;
  const spatialScore = meta.detection?.originalSpatialScore ?? 0;
  const gradientScore = meta.detection?.originalGradientScore ?? 0;

  return meta.applied === true &&
    meta.decisionTier === 'validated-match' &&
    position !== null &&
    position.x >= 0 &&
    position.y >= paddingTop &&
    position.x + position.width <= source.width &&
    position.y - paddingTop + position.height <= source.height &&
    adaptiveConfidence >= MIN_ADAPTIVE_CONFIDENCE &&
    spatialScore >= MIN_SPATIAL_SCORE &&
    gradientScore >= MIN_GRADIENT_SCORE;
}

function cropNormalizedResult(imageData: PixelImageData, paddingTop: number, height: number): PixelImageData {
  const start = paddingTop * imageData.width * 4;
  const length = imageData.width * height * 4;
  return {
    width: imageData.width,
    height,
    data: new Uint8ClampedArray(imageData.data.slice(start, start + length)),
  };
}

function dilateMask(mask: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  let current = mask;
  for (let pass = 0; pass < radius; pass += 1) {
    const next = new Uint8Array(current);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (current[y * width + x] === 0) continue;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            const targetX = x + dx;
            const targetY = y + dy;
            if (targetX >= 0 && targetY >= 0 && targetX < width && targetY < height) {
              next[targetY * width + targetX] = 1;
            }
          }
        }
      }
    }
    current = next;
  }
  return current;
}

export function repairVisibleResidual(
  source: PixelImageData,
  normalizedSource: PixelImageData,
  normalizedResult: PixelImageData,
  normalizedPosition: NonNullable<WatermarkMeta['position']>,
  paddingTop: number
): PixelImageData {
  const mappedY = normalizedPosition.y - paddingTop;
  const border = Math.max(6, Math.ceil(normalizedPosition.width * 0.12));
  const left = Math.max(0, normalizedPosition.x - border);
  const top = Math.max(0, mappedY - border);
  const right = Math.min(source.width, normalizedPosition.x + normalizedPosition.width + border);
  const bottom = Math.min(source.height, mappedY + normalizedPosition.height + border);
  const patchWidth = right - left;
  const patchHeight = bottom - top;
  const mask = new Uint8Array(patchWidth * patchHeight);

  let changedPixels = 0;
  for (let y = 0; y < normalizedPosition.height; y += 1) {
    for (let x = 0; x < normalizedPosition.width; x += 1) {
      const normalizedIndex = (
        (normalizedPosition.y + y) * normalizedSource.width + normalizedPosition.x + x
      ) * 4;
      let maximumDifference = 0;
      for (let channel = 0; channel < 3; channel += 1) {
        maximumDifference = Math.max(
          maximumDifference,
          Math.abs(normalizedSource.data[normalizedIndex + channel] - normalizedResult.data[normalizedIndex + channel])
        );
      }
      if (maximumDifference >= 2) {
        const patchX = normalizedPosition.x + x - left;
        const patchY = mappedY + y - top;
        mask[patchY * patchWidth + patchX] = 1;
        changedPixels += 1;
      }
    }
  }

  const minimumChangedPixels = Math.max(24, Math.floor(normalizedPosition.width * normalizedPosition.height * 0.03));
  if (changedPixels < minimumChangedPixels) return cropNormalizedResult(normalizedResult, paddingTop, source.height);

  const dilationRadius = Math.max(3, Math.min(7, Math.ceil(normalizedPosition.width * 0.08)));
  const repairMask = dilateMask(mask, patchWidth, patchHeight, dilationRadius);
  const patch = new Float32Array(patchWidth * patchHeight * 3);

  for (let y = 0; y < patchHeight; y += 1) {
    for (let x = 0; x < patchWidth; x += 1) {
      const sourceIndex = ((top + y) * source.width + left + x) * 4;
      const patchIndex = (y * patchWidth + x) * 3;
      patch[patchIndex] = source.data[sourceIndex];
      patch[patchIndex + 1] = source.data[sourceIndex + 1];
      patch[patchIndex + 2] = source.data[sourceIndex + 2];
    }
  }

  const iterations = Math.max(240, normalizedPosition.width * 8);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = new Float32Array(patch);
    for (let y = 1; y < patchHeight - 1; y += 1) {
      for (let x = 1; x < patchWidth - 1; x += 1) {
        if (repairMask[y * patchWidth + x] === 0) continue;
        const pixel = (y * patchWidth + x) * 3;
        for (let channel = 0; channel < 3; channel += 1) {
          next[pixel + channel] = (
            patch[((y - 1) * patchWidth + x) * 3 + channel] +
            patch[((y + 1) * patchWidth + x) * 3 + channel] +
            patch[(y * patchWidth + x - 1) * 3 + channel] +
            patch[(y * patchWidth + x + 1) * 3 + channel]
          ) * 0.25;
        }
      }
    }
    patch.set(next);
  }

  const repaired = clonePixels(source);
  for (let y = 0; y < patchHeight; y += 1) {
    for (let x = 0; x < patchWidth; x += 1) {
      if (repairMask[y * patchWidth + x] === 0) continue;
      const targetIndex = ((top + y) * source.width + left + x) * 4;
      const patchIndex = (y * patchWidth + x) * 3;
      repaired.data[targetIndex] = Math.round(patch[patchIndex]);
      repaired.data[targetIndex + 1] = Math.round(patch[patchIndex + 1]);
      repaired.data[targetIndex + 2] = Math.round(patch[patchIndex + 2]);
    }
  }

  return repaired;
}

export function shouldRepairDetectedResidual(meta: ExtendedMeta): boolean {
  const position = meta.position;
  const imperfections = meta.qualitySignals?.imperfections;
  const confidence = meta.selectionConfidence;
  if (!meta.applied || !position || !meta.source.includes('adaptive')) return false;
  if (position.width < 36 || position.width > 72 || position.height < 36 || position.height > 72) return false;
  return imperfections?.detected === true &&
    (imperfections.score ?? 0) >= 0.8 &&
    typeof confidence === 'number' &&
    confidence < 0.2;
}

export function repairDetectedResidual(
  source: PixelImageData,
  result: ImageDataRemovalResult,
): ImageDataRemovalResult {
  const meta = result.meta as ExtendedMeta;
  if (!shouldRepairDetectedResidual(meta) || !meta.position) return result;
  return {
    imageData: repairVisibleResidual(source, source, result.imageData, meta.position, 0),
    meta: {
      ...meta,
      source: `${meta.source}+bounded-residual-inpaint`,
    },
  };
}

export function tryPanoramaImageFallback(
  source: PixelImageData,
  removePixels: RemovePixels
): ImageDataRemovalResult | null {
  if (!needsPanoramaFallback(source)) return null;

  const normalized = padPanoramaForDetection(source);
  const result = removePixels(clonePixels(normalized.imageData), {
    adaptiveMode: 'always',
    aggressiveLocatedFallback: true,
    locatedAggressiveRemoval: true,
  });
  const meta = result.meta as ExtendedMeta;
  if (!isStrongFallbackMatch(meta, normalized.paddingTop, source) || !meta.position) return null;

  const mappedPosition = {
    ...meta.position,
    y: meta.position.y - normalized.paddingTop,
  };
  const repaired = meta.qualityStatus === 'visible-residual'
    ? repairVisibleResidual(
        source,
        normalized.imageData,
        result.imageData,
        meta.position,
        normalized.paddingTop
      )
    : cropNormalizedResult(result.imageData, normalized.paddingTop, source.height);

  return {
    imageData: repaired,
    meta: {
      ...meta,
      position: mappedPosition,
      config: meta.config ? {
        ...meta.config,
        marginBottom: source.height - mappedPosition.y - mappedPosition.height,
      } : null,
      source: `${meta.source}+panorama-normalized${meta.qualityStatus === 'visible-residual' ? '+bounded-inpaint' : ''}`,
    },
  };
}
