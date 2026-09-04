import { describe, expect, it } from 'vitest';
import type { PixelImageData } from './image-panorama-fallback';
import {
  compositeMiganWindow,
  createMiganMask,
  packMiganWindow,
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
