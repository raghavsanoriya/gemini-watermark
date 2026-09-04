import type { ImageDataRemovalResult, WatermarkMeta } from '@pilio/gemini-watermark-remover';
import type { ImageRepairMode, RepairSafetyOutcome } from '@/types/media';

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
  repairMode?: ImageRepairMode | null;
  repairSafety?: RepairSafetyOutcome | null;
  qualityWarning?: string | null;
  qualitySignals?: {
    imperfections?: {
      detected?: boolean;
      severity?: string;
      score?: number;
    } | null;
    damageComponents?: {
      nearBlack?: number;
      nearWhite?: number;
      texture?: number;
      clipped?: number;
    } | null;
  } | null;
};

const NORMALIZED_MIN_DIMENSION = 1025;
const MIN_ADAPTIVE_CONFIDENCE = 0.42;
const MIN_SPATIAL_SCORE = 0.55;
const MIN_GRADIENT_SCORE = 0.25;
const DAMAGE_REPAIR_THRESHOLD = 0.4;
const MIN_REPAIR_SIZE = 36;
const MAX_REPAIR_SIZE = 96;
const UNSAFE_REPAIR_WARNING = 'GemClean found a likely mark, but kept the original because automatic removal would damage this dark area.';

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

function growConnectedBrightPixels(
  mask: Uint8Array,
  source: PixelImageData,
  left: number,
  top: number,
  patchWidth: number,
  patchHeight: number,
  position: NonNullable<WatermarkMeta['position']>
): Uint8Array {
  const surrounding = getSurroundingLuminanceStats(source, position);
  if (!surrounding || surrounding.mean >= 128) return mask;

  const brightThreshold = surrounding.mean + Math.max(8, surrounding.standardDeviation * 1.25);
  const candidates = new Uint8Array(mask.length);
  for (let y = 0; y < patchHeight; y += 1) {
    for (let x = 0; x < patchWidth; x += 1) {
      const imageX = left + x;
      const imageY = top + y;
      if (
        imageX < position.x || imageX >= position.x + position.width ||
        imageY < position.y || imageY >= position.y + position.height
      ) continue;
      const sourceIndex = (imageY * source.width + imageX) * 4;
      const luminance = source.data[sourceIndex] * 0.2126 +
        source.data[sourceIndex + 1] * 0.7152 +
        source.data[sourceIndex + 2] * 0.0722;
      if (luminance >= brightThreshold) candidates[y * patchWidth + x] = 1;
    }
  }

  let current = dilateMask(mask, patchWidth, patchHeight, 2);
  const maximumPasses = Math.max(position.width, position.height);
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    let passAdded = false;
    const next = new Uint8Array(current);
    for (let y = 1; y < patchHeight - 1; y += 1) {
      for (let x = 1; x < patchWidth - 1; x += 1) {
        const index = y * patchWidth + x;
        if (current[index] !== 0 || candidates[index] === 0) continue;
        let connected = false;
        for (let dy = -1; dy <= 1 && !connected; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) {
            if (current[(y + dy) * patchWidth + x + dx] !== 0) {
              next[index] = 1;
              connected = true;
              passAdded = true;
              break;
            }
          }
        }
      }
    }
    current = next;
    if (!passAdded) break;
  }
  return current;
}

export function repairVisibleResidual(
  source: PixelImageData,
  normalizedSource: PixelImageData,
  normalizedResult: PixelImageData,
  normalizedPosition: NonNullable<WatermarkMeta['position']>,
  paddingTop: number,
  includeFullDarkFootprint = false
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
  const footprintMask = includeFullDarkFootprint
    ? growConnectedBrightPixels(mask, source, left, top, patchWidth, patchHeight, {
        ...normalizedPosition,
        y: mappedY,
      })
    : mask;
  const repairMask = dilateMask(footprintMask, patchWidth, patchHeight, dilationRadius);
  const patch = new Float32Array(patchWidth * patchHeight * 3);
  const seedColor = [0, 0, 0];
  let seedCount = 0;

  for (let y = 0; y < patchHeight; y += 1) {
    for (let x = 0; x < patchWidth; x += 1) {
      const sourceIndex = ((top + y) * source.width + left + x) * 4;
      const patchIndex = (y * patchWidth + x) * 3;
      patch[patchIndex] = source.data[sourceIndex];
      patch[patchIndex + 1] = source.data[sourceIndex + 1];
      patch[patchIndex + 2] = source.data[sourceIndex + 2];
      if (repairMask[y * patchWidth + x] === 0) {
        seedColor[0] += source.data[sourceIndex];
        seedColor[1] += source.data[sourceIndex + 1];
        seedColor[2] += source.data[sourceIndex + 2];
        seedCount += 1;
      }
    }
  }

  if (seedCount > 0) {
    seedColor[0] /= seedCount;
    seedColor[1] /= seedCount;
    seedColor[2] /= seedCount;
    for (let y = 0; y < patchHeight; y += 1) {
      for (let x = 0; x < patchWidth; x += 1) {
        if (repairMask[y * patchWidth + x] === 0) continue;
        const patchIndex = (y * patchWidth + x) * 3;
        patch[patchIndex] = seedColor[0];
        patch[patchIndex + 1] = seedColor[1];
        patch[patchIndex + 2] = seedColor[2];
      }
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
  if (!meta.applied || !position) return false;
  if (
    position.width < MIN_REPAIR_SIZE ||
    position.width > MAX_REPAIR_SIZE ||
    position.height < MIN_REPAIR_SIZE ||
    position.height > MAX_REPAIR_SIZE
  ) return false;

  const hasDestructiveDamage = hasDestructiveRemovalDamage(meta);
  if (hasDestructiveDamage) return true;

  return meta.source.includes('adaptive') &&
    imperfections?.detected === true &&
    (imperfections.score ?? 0) >= 0.8 &&
    typeof confidence === 'number' &&
    confidence < 0.2;
}

function hasDestructiveRemovalDamage(meta: ExtendedMeta): boolean {
  const damage = meta.qualitySignals?.damageComponents;
  return (damage?.nearBlack ?? 0) >= DAMAGE_REPAIR_THRESHOLD ||
    (damage?.nearWhite ?? 0) >= DAMAGE_REPAIR_THRESHOLD ||
    (damage?.clipped ?? 0) >= DAMAGE_REPAIR_THRESHOLD;
}

interface RegionStats {
  nearBlack: number;
  nearWhite: number;
  clipped: number;
  meanLuminance: number;
  count: number;
}

function getRegionStats(
  imageData: PixelImageData,
  position: NonNullable<WatermarkMeta['position']>
): RegionStats {
  const left = Math.max(0, position.x);
  const top = Math.max(0, position.y);
  const right = Math.min(imageData.width, position.x + position.width);
  const bottom = Math.min(imageData.height, position.y + position.height);
  let nearBlack = 0;
  let nearWhite = 0;
  let clipped = 0;
  let luminance = 0;
  let count = 0;

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      const index = (y * imageData.width + x) * 4;
      const red = imageData.data[index];
      const green = imageData.data[index + 1];
      const blue = imageData.data[index + 2];
      const pixelLuminance = red * 0.2126 + green * 0.7152 + blue * 0.0722;
      if (pixelLuminance <= 8) nearBlack += 1;
      if (pixelLuminance >= 247) nearWhite += 1;
      if (red <= 1 || green <= 1 || blue <= 1 || red >= 254 || green >= 254 || blue >= 254) clipped += 1;
      luminance += pixelLuminance;
      count += 1;
    }
  }

  return {
    nearBlack,
    nearWhite,
    clipped,
    meanLuminance: count > 0 ? luminance / count : 0,
    count,
  };
}

function getSurroundingLuminanceStats(
  imageData: PixelImageData,
  position: NonNullable<WatermarkMeta['position']>
): { mean: number; standardDeviation: number } | null {
  const border = Math.max(6, Math.ceil(position.width * 0.2));
  const left = Math.max(0, position.x - border);
  const top = Math.max(0, position.y - border);
  const right = Math.min(imageData.width, position.x + position.width + border);
  const bottom = Math.min(imageData.height, position.y + position.height + border);
  let luminance = 0;
  let squaredLuminance = 0;
  let count = 0;

  for (let y = top; y < bottom; y += 1) {
    for (let x = left; x < right; x += 1) {
      if (
        x >= position.x && x < position.x + position.width &&
        y >= position.y && y < position.y + position.height
      ) continue;
      const index = (y * imageData.width + x) * 4;
      const pixelLuminance = imageData.data[index] * 0.2126 +
        imageData.data[index + 1] * 0.7152 +
        imageData.data[index + 2] * 0.0722;
      luminance += pixelLuminance;
      squaredLuminance += pixelLuminance * pixelLuminance;
      count += 1;
    }
  }

  if (count === 0) return null;
  const mean = luminance / count;
  return {
    mean,
    standardDeviation: Math.sqrt(Math.max(0, squaredLuminance / count - mean * mean)),
  };
}

function expandToKnownMarkFootprint(
  imageData: PixelImageData,
  position: NonNullable<WatermarkMeta['position']>
): NonNullable<WatermarkMeta['position']> {
  const width = Math.min(imageData.width, Math.max(MAX_REPAIR_SIZE, position.width));
  const height = Math.min(imageData.height, Math.max(MAX_REPAIR_SIZE, position.height));
  const centerX = position.x + position.width / 2;
  const centerY = position.y + position.height / 2;
  const x = Math.max(0, Math.min(imageData.width - width, Math.round(centerX - width / 2)));
  const y = Math.max(0, Math.min(imageData.height - height, Math.round(centerY - height / 2)));
  return { x, y, width, height };
}

export function isBoundedTextureRepairSafe(
  source: PixelImageData,
  unsafeResult: PixelImageData,
  repaired: PixelImageData,
  position: NonNullable<WatermarkMeta['position']>
): boolean {
  const sourceStats = getRegionStats(source, position);
  const unsafeStats = getRegionStats(unsafeResult, position);
  const repairedStats = getRegionStats(repaired, position);
  const tolerance = Math.max(4, Math.ceil(sourceStats.count * 0.01));

  if (repairedStats.nearBlack > sourceStats.nearBlack + tolerance) return false;
  if (repairedStats.nearWhite > sourceStats.nearWhite + tolerance) return false;
  if (repairedStats.clipped > sourceStats.clipped + tolerance) return false;

  const surrounding = getSurroundingLuminanceStats(source, position);
  if (surrounding === null) return true;
  const unsafeDistance = Math.abs(unsafeStats.meanLuminance - surrounding.mean);
  const repairedDistance = Math.abs(repairedStats.meanLuminance - surrounding.mean);
  return repairedDistance <= unsafeDistance + 3 || repairedDistance <= 12;
}

export function repairDetectedResidual(
  source: PixelImageData,
  result: ImageDataRemovalResult,
): ImageDataRemovalResult {
  const meta = result.meta as ExtendedMeta;
  if (!shouldRepairDetectedResidual(meta) || !meta.position) {
    return {
      imageData: result.imageData,
      meta: {
        ...meta,
        repairMode: meta.applied ? 'reverse-alpha' : null,
        repairSafety: 'not-needed',
        qualityWarning: null,
      } as WatermarkMeta,
    };
  }

  const hasDestructiveDamage = hasDestructiveRemovalDamage(meta);
  const repairPosition = hasDestructiveDamage
    ? expandToKnownMarkFootprint(source, meta.position)
    : meta.position;
  const repaired = repairVisibleResidual(
    source,
    source,
    result.imageData,
    repairPosition,
    0,
    hasDestructiveDamage
  );
  if (!isBoundedTextureRepairSafe(source, result.imageData, repaired, repairPosition)) {
    return {
      imageData: clonePixels(source),
      meta: {
        ...meta,
        applied: false,
        skipReason: 'unsafe-removal-rejected',
        source: `${meta.source}+unsafe-rejected`,
        repairMode: 'unchanged-unsafe',
        repairSafety: 'rejected',
        qualityWarning: UNSAFE_REPAIR_WARNING,
      } as WatermarkMeta,
    };
  }

  return {
    imageData: repaired,
    meta: {
      ...meta,
      source: `${meta.source}+bounded-texture-repair`,
      repairMode: 'bounded-texture',
      repairSafety: 'passed',
      qualityWarning: null,
    } as WatermarkMeta,
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
      source: `${meta.source}+panorama-normalized${meta.qualityStatus === 'visible-residual' ? '+bounded-texture-repair' : ''}`,
      repairMode: meta.qualityStatus === 'visible-residual' ? 'bounded-texture' : 'reverse-alpha',
      repairSafety: meta.qualityStatus === 'visible-residual' ? 'passed' : 'not-needed',
      qualityWarning: null,
    } as WatermarkMeta,
  };
}
