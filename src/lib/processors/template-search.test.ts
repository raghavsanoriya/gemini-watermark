import { describe, expect, it } from 'vitest';
import { createWatermarkEngine } from '@pilio/gemini-watermark-remover';
import { cleanImageData } from './pipeline';
import { isGeminiPlacement, locateMarkByTemplate, removeMarkByTemplateSearch } from './template-search';

/** Textured image, 1536x2752 by default (a common Gemini 9:16 size), with an optional mark. */
async function scene(mark?: { size: number; marginRight: number; marginBottom: number; gain: number }, width = 1536, height = 2752) {
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

  // The same photo saved at half size: the catalog "validated" a 36px mark in the wrong
  // place and left the real 24px sparkle untouched.
  it('removes a small mark on a shrunk image even when the catalog claims another spot', async () => {
    const { image, clean } = await scene({ size: 24, marginRight: 44, marginBottom: 44, gain: 0.65 }, 768, 1376);
    const result = await cleanImageData(image);
    expect(result.meta.applied).toBe(true);
    const left = 768 - 44 - 24;
    const top = 1376 - 44 - 24;
    expect(Math.abs(result.meta.position!.x - left)).toBeLessThanOrEqual(2);
    expect(Math.abs(result.meta.position!.y - top)).toBeLessThanOrEqual(2);
    let maxError = 0;
    for (let y = top; y < top + 24; y += 1) {
      for (let x = left; x < left + 24; x += 1) {
        const index = (y * 768 + x) * 4;
        maxError = Math.max(maxError, Math.abs(result.imageData.data[index] - clean[index]));
      }
    }
    expect(maxError).toBeLessThan(16);
  }, 60_000);

  // A phone screenshot: the picture was scaled down and its bottom cut off, so the margins differ.
  it('finds a small mark in a screenshot that cropped the bottom margin', async () => {
    const { image } = await scene({ size: 22, marginRight: 41, marginBottom: 25, gain: 0.65 }, 720, 1300);
    const result = await cleanImageData(image);
    expect(result.meta.applied).toBe(true);
    expect(Math.abs(result.meta.position!.x - (720 - 41 - 22))).toBeLessThanOrEqual(2);
    expect(Math.abs(result.meta.position!.y - (1300 - 25 - 22))).toBeLessThanOrEqual(2);
  }, 60_000);

  it('ignores a small sparkle shape away from where Gemini places the mark', async () => {
    const { image } = await scene({ size: 20, marginRight: 150, marginBottom: 60, gain: 0.65 }, 768, 1376);
    expect(await locateMarkByTemplate(image)).toBeNull();
  }, 60_000);

  it('recognises Gemini placement by proportionate margins', () => {
    expect(isGeminiPlacement(1536, 2752, { x: 1399, y: 2615, width: 48, height: 48 })).toBe(true);
    expect(isGeminiPlacement(768, 1376, { x: 699, y: 1307, width: 25, height: 25 })).toBe(true);
    // A screenshot that cut the bottom keeps the right margin.
    expect(isGeminiPlacement(720, 1300, { x: 656, y: 1251, width: 22, height: 22 })).toBe(true);
    expect(isGeminiPlacement(1000, 1000, { x: 700, y: 700, width: 20, height: 20 })).toBe(false);
    expect(isGeminiPlacement(1000, 1000, { x: 975, y: 900, width: 20, height: 20 })).toBe(false);
    expect(isGeminiPlacement(1000, 1000, { x: 900, y: 970, width: 20, height: 20 })).toBe(false);
  });
});
