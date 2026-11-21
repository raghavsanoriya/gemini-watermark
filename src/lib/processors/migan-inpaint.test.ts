import { describe, expect, it } from 'vitest';
import type { PixelImageData } from './image-panorama-fallback';
import {
  compositeMiganWindow,
  createMiganMask,
  isProportionateRepair,
  meanMaskedChange,
  packMiganWindow,
  wantsContentAwareRepair,
  windowForMask,
} from './migan-inpaint';

function pixels(width: number, height: number): PixelImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      data[index] = x;
      data[index + 1] = y;
      data[index + 2] = x + y;
      data[index + 3] = 255;
    }
  }
  return { width, height, data };
}

describe('MI-GAN fallback preparation', () => {
  it('builds a halo-expanded mask from reverse-alpha changes', () => {
    const source = pixels(320, 320);
    const changed = pixels(320, 320);
    changed.data[(280 * 320 + 280) * 4] += 8;
    const mask = createMiganMask(source, changed, { x: 270, y: 270, width: 32, height: 32 });
    expect(mask[280 * 320 + 280]).toBe(1);
    expect(mask[276 * 320 + 276]).toBe(1);
    expect(mask[20 * 320 + 20]).toBe(0);
  });

  it('packs CHW pixels and inverts the model mask', () => {
    const source = pixels(320, 320);
    const mask = new Uint8Array(320 * 320);
    mask[200 * 320 + 210] = 1;
    const window = windowForMask(source, mask);
    expect(window).not.toBeNull();
    if (!window) return;
    const packed = packMiganWindow(source, mask, window);
    const local = (200 - window.y) * window.width + 210 - window.x;
    expect(packed.mask[local]).toBe(0);
    expect(packed.image[local]).toBe(source.data[(200 * 320 + 210) * 4]);
    expect(window.width % 8).toBe(0);
  });

  it('composites model output only inside the watermark mask', () => {
    const source = pixels(320, 320);
    const mask = new Uint8Array(320 * 320);
    mask[200 * 320 + 210] = 1;
    const window = windowForMask(source, mask);
    expect(window).not.toBeNull();
    if (!window) return;
    const model = new Uint8Array(window.width * window.height * 3).fill(123);
    const result = compositeMiganWindow(source, mask, window, model);
    expect(result.data[(200 * 320 + 210) * 4]).toBe(123);
    expect(result.data[(10 * 320 + 10) * 4]).toBe(source.data[(10 * 320 + 10) * 4]);
  });
});

describe('MI-GAN acceptance', () => {
  const position = { x: 24, y: 24, width: 48, height: 48 };

  it('only runs when a content-aware repair was applied or attempted', () => {
    expect(wantsContentAwareRepair({ position, repairMode: 'content-aware-telea' } as never)).toBe(true);
    expect(wantsContentAwareRepair({ position, repairMode: 'reverse-alpha', repairSafety: 'rejected' } as never)).toBe(true);
    expect(wantsContentAwareRepair({ position, repairMode: 'reverse-alpha', repairSafety: 'not-needed' } as never)).toBe(false);
    expect(wantsContentAwareRepair({ position: null, repairMode: 'content-aware-telea' } as never)).toBe(false);
  });
});

describe('MI-GAN proportionality guard', () => {
  it('rejects a fill that rewrites a corner with no measurable leftover', () => {
    const position = { x: 8, y: 8, width: 16, height: 16 };
    const source = pixels(32, 32);
    const reverseAlpha = pixels(32, 32);
    const mask = new Uint8Array(32 * 32);
    for (let y = 8; y < 24; y += 1) mask.fill(1, y * 32 + 8, y * 32 + 24);
    const hallucinated = pixels(32, 32);
    const gentle = pixels(32, 32);
    for (let pixel = 0; pixel < mask.length; pixel += 1) {
      if (!mask[pixel]) continue;
      for (let channel = 0; channel < 3; channel += 1) {
        hallucinated.data[pixel * 4 + channel] += 60;
        gentle.data[pixel * 4 + channel] += 4;
      }
    }
    expect(meanMaskedChange(hallucinated, reverseAlpha, mask)).toBe(60);
    expect(isProportionateRepair(source, reverseAlpha, hallucinated, mask, position)).toBe(false);
    expect(isProportionateRepair(source, reverseAlpha, gentle, mask, position)).toBe(true);
  });
});
