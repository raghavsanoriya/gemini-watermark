import { describe, expect, it } from 'vitest';
import type { PixelImageData } from './image-panorama-fallback';
import { teleaInpaint } from './telea-inpaint';

function gradient(width: number, height: number): PixelImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const value = 50 + x * 2;
      data[index] = value;
      data[index + 1] = value;
      data[index + 2] = value;
      data[index + 3] = 255;
    }
  }
  return { width, height, data };
}

describe('Telea content-aware fill', () => {
  it('continues a smooth background through the selected footprint', () => {
    const source = gradient(64, 64);
    const damaged = { ...source, data: new Uint8ClampedArray(source.data) };
    const mask = new Uint8Array(64 * 64);
    for (let y = 22; y < 42; y += 1) {
      for (let x = 22; x < 42; x += 1) {
        mask[y * 64 + x] = 1;
        const index = (y * 64 + x) * 4;
        damaged.data[index] = 245;
        damaged.data[index + 1] = 245;
        damaged.data[index + 2] = 245;
      }
    }

    const repaired = teleaInpaint(damaged, mask);
    const center = (32 * 64 + 32) * 4;
    expect(Math.abs(repaired.data[center] - source.data[center])).toBeLessThan(18);
  });

  it('keeps every unmasked pixel and the alpha channel byte-identical', () => {
    const source = gradient(32, 32);
    source.data[(16 * 32 + 16) * 4 + 3] = 77;
    const mask = new Uint8Array(32 * 32);
    mask[16 * 32 + 16] = 1;
    const repaired = teleaInpaint(source, mask);
    for (let pixel = 0; pixel < mask.length; pixel += 1) {
      if (mask[pixel] === 0) {
        expect([...repaired.data.slice(pixel * 4, pixel * 4 + 4)]).toEqual(
          [...source.data.slice(pixel * 4, pixel * 4 + 4)],
        );
      }
    }
    expect(repaired.data[(16 * 32 + 16) * 4 + 3]).toBe(77);
  });
});
