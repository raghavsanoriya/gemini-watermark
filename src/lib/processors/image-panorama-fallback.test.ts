import { describe, expect, it } from 'vitest';
import {
  needsPanoramaFallback,
  padPanoramaForDetection,
  isBoundedTextureRepairSafe,
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

  it('repairs an engine-confirmed visible residual from the standard catalog path', () => {
    expect(shouldRepairDetectedResidual({
      ...suspiciousMeta,
      source: 'standard+catalog+fixed-local+gain',
      qualityStatus: 'visible-residual',
      selectionConfidence: 0.025,
      position: { x: 0, y: 0, width: 45, height: 45 },
      qualitySignals: {
        imperfections: { detected: true, severity: 'high', score: 2.65 },
        damageComponents: { nearBlack: 0, nearWhite: 0, texture: 0, clipped: 0 },
      },
    })).toBe(true);
  });

  it('repairs destructive catalog output even when the detector did not use the adaptive source', () => {
    const destructiveMeta = {
      ...suspiciousMeta,
      size: 36,
      position: { x: 30, y: 30, width: 36, height: 36 },
      source: 'standard+catalog+located-aggressive',
      qualityStatus: 'mixed',
      selectionConfidence: 0.000244,
      qualitySignals: {
        imperfections: { detected: true, severity: 'high', score: 2.73 },
        damageComponents: { nearBlack: 1, nearWhite: 0, texture: 0, clipped: 0.154 },
      },
    };

    expect(shouldRepairDetectedResidual(destructiveMeta)).toBe(true);
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
    expect(result.meta.source).toContain('telea-content-aware-repair');
    expect((result.meta as typeof suspiciousMeta & { repairMode?: string }).repairMode).toBe('content-aware-telea');
  });

  it('removes a black reverse-alpha imprint without changing pixels outside the bounded patch', () => {
    const source = createPixels(120, 120, 38);
    const damaged = createPixels(120, 120, 38);
    for (let y = 48; y < 72; y += 1) {
      for (let x = 48; x < 72; x += 1) {
        if (Math.abs(x - 60) + Math.abs(y - 60) > 13) continue;
        const index = (y * damaged.width + x) * 4;
        damaged.data[index] = 0;
        damaged.data[index + 1] = 0;
        damaged.data[index + 2] = 0;
      }
    }
    const destructiveMeta = {
      ...suspiciousMeta,
      size: 36,
      position: { x: 42, y: 42, width: 36, height: 36 },
      source: 'standard+catalog+located-aggressive',
      qualityStatus: 'mixed',
      qualitySignals: {
        imperfections: { detected: true, severity: 'high', score: 2.73 },
        damageComponents: { nearBlack: 1, nearWhite: 0, texture: 0, clipped: 0.154 },
      },
    };

    const result = repairDetectedResidual(source, { imageData: damaged, meta: destructiveMeta });
    const center = (60 * 120 + 60) * 4;
    const outside = (10 * 120 + 10) * 4;
    expect(result.imageData.data[center]).toBe(38);
    expect(result.imageData.data[outside]).toBe(source.data[outside]);
    expect((result.meta as typeof destructiveMeta & { repairMode?: string }).repairMode).toBe('content-aware-telea');
    expect(isBoundedTextureRepairSafe(source, damaged, result.imageData, destructiveMeta.position)).toBe(true);
  });

  it('rejects a bounded repair that still introduces clipped black pixels', () => {
    const source = createPixels(96, 96, 38);
    const unsafe = createPixels(96, 96, 38);
    const stillDamaged = createPixels(96, 96, 38);
    for (let y = 30; y < 66; y += 1) {
      for (let x = 30; x < 66; x += 1) {
        const index = (y * 96 + x) * 4;
        unsafe.data[index] = 0;
        unsafe.data[index + 1] = 0;
        unsafe.data[index + 2] = 0;
        stillDamaged.data[index] = 0;
        stillDamaged.data[index + 1] = 0;
        stillDamaged.data[index + 2] = 0;
      }
    }

    expect(isBoundedTextureRepairSafe(
      source,
      unsafe,
      stillDamaged,
      { x: 30, y: 30, width: 36, height: 36 }
    )).toBe(false);
  });

  it('expands a destructive 36px selection to repair the full connected watermark footprint', () => {
    const source = createPixels(144, 144, 38);
    const damaged = createPixels(144, 144, 38);
    for (let y = 45; y < 100; y += 1) {
      for (let x = 45; x < 100; x += 1) {
        if (Math.abs(x - 72) + Math.abs(y - 72) > 24) continue;
        const index = (y * source.width + x) * 4;
        source.data[index] = 96;
        source.data[index + 1] = 96;
        source.data[index + 2] = 96;
        damaged.data[index] = x < 78 && y < 78 ? 0 : 96;
        damaged.data[index + 1] = x < 78 && y < 78 ? 0 : 96;
        damaged.data[index + 2] = x < 78 && y < 78 ? 0 : 96;
      }
    }
    const destructiveMeta = {
      ...suspiciousMeta,
      size: 36,
      position: { x: 42, y: 42, width: 36, height: 36 },
      source: 'standard+catalog+located-aggressive',
      qualityStatus: 'mixed',
      qualitySignals: {
        imperfections: { detected: true, severity: 'high', score: 2.73 },
        damageComponents: { nearBlack: 1, nearWhite: 0, texture: 0, clipped: 0.154 },
      },
    };

    const result = repairDetectedResidual(source, { imageData: damaged, meta: destructiveMeta });
    const formerBlackCenter = (70 * 144 + 70) * 4;
    const watermarkOutsideSelection = (72 * 144 + 90) * 4;
    expect(result.imageData.data[formerBlackCenter]).toBe(38);
    expect(result.imageData.data[watermarkOutsideSelection]).toBe(38);
    expect((result.meta as typeof destructiveMeta & { repairMode?: string }).repairMode).toBe('content-aware-telea');
  });
});
