import { describe, expect, it } from 'vitest';
import {
  needsPanoramaFallback,
  padPanoramaForDetection,
  repairDetectedResidual,
  shouldRepairDetectedResidual,
  tryPanoramaImageFallback,
  type PixelImageData,
} from './image-panorama-fallback';

function createPixels(width: number, height: number, value = 120): PixelImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < data.length; index += 4) {
    data[index] = value;
    data[index + 1] = value;
    data[index + 2] = value;
    data[index + 3] = 255;
  }
  return { width, height, data };
}

describe('panoramic image watermark fallback', () => {
  it('only activates for short, wide images missed by the standard size rule', () => {
    expect(needsPanoramaFallback(createPixels(1850, 335))).toBe(true);
    expect(needsPanoramaFallback(createPixels(1200, 900))).toBe(false);
    expect(needsPanoramaFallback(createPixels(900, 300))).toBe(false);
  });

  it('normalizes height without changing source rows', () => {
    const source = createPixels(4, 2, 77);
    const normalized = padPanoramaForDetection(source);
    const sourceStart = normalized.paddingTop * source.width * 4;

    expect(normalized.imageData.height).toBe(1025);
    expect(normalized.imageData.data.slice(sourceStart)).toEqual(source.data);
  });

  it('rejects a weak normalized match and leaves the caller to return the original result', () => {
    const source = createPixels(1200, 400);
    const fallback = tryPanoramaImageFallback(source, (imageData) => ({
      imageData,
      meta: {
        applied: true,
        skipReason: null,
        size: 62,
        position: { x: 1050, y: 880, width: 62, height: 62 },
        config: { logoSize: 62, marginRight: 88, marginBottom: 83 },
        detection: {
          adaptiveConfidence: 0.2,
          originalSpatialScore: 0.3,
          originalGradientScore: 0.2,
          processedSpatialScore: 0,
          processedGradientScore: 0,
          suppressionGain: 0,
        },
        source: 'adaptive',
        decisionTier: 'validated-match',
        alphaGain: 1,
        passCount: 1,
        attemptedPassCount: 1,
        passStopReason: null,
      },
    }));

    expect(fallback).toBeNull();
  });
});

describe('detected residual cleanup', () => {
  const suspiciousMeta = {
    applied: true,
    skipReason: null,
    size: 62,
    position: { x: 20, y: 20, width: 48, height: 48 },
    config: { logoSize: 62, marginRight: 82, marginBottom: 86 },
    detection: {
      adaptiveConfidence: 0.44,
      originalSpatialScore: 0.7,
      originalGradientScore: 0.28,
      processedSpatialScore: 0.15,
      processedGradientScore: 0.2,
      suppressionGain: 0.55,
    },
    source: 'adaptive+aggressive-located',
    decisionTier: 'validated-match',
    alphaGain: 0.41,
    passCount: 2,
    attemptedPassCount: 2,
    passStopReason: null,
    qualityStatus: 'clean',
    selectionConfidence: 0.13,
    qualitySignals: { imperfections: { detected: true, severity: 'moderate', score: 0.92 } },
  };

  it('only enables bounded cleanup for low-confidence adaptive results with a strong residual signal', () => {
    expect(shouldRepairDetectedResidual({ ...suspiciousMeta, position: { x: 0, y: 0, width: 62, height: 62 } })).toBe(true);
    expect(shouldRepairDetectedResidual({ ...suspiciousMeta, source: 'catalog', position: { x: 0, y: 0, width: 62, height: 62 } })).toBe(false);
    expect(shouldRepairDetectedResidual({ ...suspiciousMeta, selectionConfidence: 0.5, position: { x: 0, y: 0, width: 62, height: 62 } })).toBe(false);
  });

  it('removes a residual-shaped change without touching pixels outside the bounded patch', () => {
    const source = createPixels(96, 96, 100);
    const changed = createPixels(96, 96, 100);
    for (let y = 35; y < 53; y += 1) {
      for (let x = 35; x < 53; x += 1) {
        const index = (y * changed.width + x) * 4;
        changed.data[index] = 145;
        changed.data[index + 1] = 145;
        changed.data[index + 2] = 145;
      }
    }
    const result = repairDetectedResidual(source, {
      imageData: changed,
      meta: suspiciousMeta,
    });
    expect(result.imageData.data[(44 * 96 + 44) * 4]).toBe(100);
    expect(result.imageData.data[(2 * 96 + 2) * 4]).toBe(100);
    expect(result.meta.source).toContain('bounded-residual-inpaint');
  });
});
