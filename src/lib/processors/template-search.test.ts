import { describe, expect, it } from 'vitest';
import { createWatermarkEngine } from '@pilio/gemini-watermark-remover';
import { cleanImageData } from './pipeline';
import { locateMarkByTemplate, removeMarkByTemplateSearch } from './template-search';

/** Textured 1536x2752 image (a common Gemini 9:16 size) with an optional mark. */
async function scene(mark?: { size: number; marginRight: number; marginBottom: number; gain: number }) {
  const width = 1536;
  const height = 2752;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4;
      const value = 95 + Math.sin(x * 0.11) * 12 + Math.cos(y * 0.07) * 10;
      data[index] = value;
      data[index + 1] = value - 4;
      data[index + 2] = value - 8;
      data[index + 3] = 255;
    }
  }
  const clean = new Uint8ClampedArray(data);
  if (mark) {
    const alpha = await (await createWatermarkEngine()).getAlphaMap(mark.size);
    const left = width - mark.marginRight - mark.size;
    const top = height - mark.marginBottom - mark.size;
    for (let y = 0; y < mark.size; y += 1) {
      for (let x = 0; x < mark.size; x += 1) {
        const a = Math.min(1, alpha[y * mark.size + x] * mark.gain);
        const index = ((top + y) * width + left + x) * 4;
        for (let channel = 0; channel < 3; channel += 1) data[index + channel] = Math.round(a * 255 + (1 - a) * data[index + channel]);
      }
    }
  }
  return { image: { width, height, data }, clean };
}

describe('corner template search', () => {
  // The user's face-swap image: a faint 48px mark ~90px from the edges, which
  // matches none of the catalog's official offsets (32, 64, 96).
  const offCatalog = { size: 48, marginRight: 89, marginBottom: 89, gain: 0.65 };

  it('finds a mark at an offset the catalog does not predict', async () => {
    const { image } = await scene(offCatalog);
    const match = await locateMarkByTemplate(image);
    expect(match).not.toBeNull();
    expect(Math.abs(match!.position.x - (1536 - 89 - 48))).toBeLessThanOrEqual(2);
    expect(Math.abs(match!.position.y - (2752 - 89 - 48))).toBeLessThanOrEqual(2);
    expect(Math.abs(match!.position.width - 48)).toBeLessThanOrEqual(3);
  }, 60_000);

  it('removes that mark accurately', async () => {
    const { image, clean } = await scene(offCatalog);
    const result = await removeMarkByTemplateSearch(image);
    expect(result?.meta.applied).toBe(true);
    const left = 1536 - 89 - 48;
    const top = 2752 - 89 - 48;
    let maxError = 0;
    for (let y = top; y < top + 48; y += 1) {
      for (let x = left; x < left + 48; x += 1) {
        const index = (y * 1536 + x) * 4;
        maxError = Math.max(maxError, Math.abs(result!.imageData.data[index] - clean[index]));
      }
    }
    expect(maxError).toBeLessThan(12);
    expect((await cleanImageData(image)).meta.applied).toBe(true);
  }, 60_000);

  it('does not invent a mark on an image without one', async () => {
    const { image } = await scene();
    expect(await locateMarkByTemplate(image)).toBeNull();
    expect((await cleanImageData(image)).meta.applied).toBe(false);
  }, 60_000);
});
