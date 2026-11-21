import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanUploadedImage } from './clean';
import { serverConfig } from './config';
import { HttpError } from './http';
import { clientAddress, resetRateLimitsForTests, takeRateLimit } from './rate-limit';
// @ts-expect-error The calibrated alpha maps are internal to the library; tests only use them to stamp a real mark.
import { getEmbeddedAlphaMap } from '../../node_modules/@pilio/gemini-watermark-remover/src/core/embeddedAlphaMaps.js';

async function png(pixels: Buffer, width: number, height: number, name: string): Promise<File> {
  const bytes = await sharp(pixels, { raw: { width, height, channels: 3 } }).png().toBuffer();
  return new File([new Uint8Array(bytes)], name, { type: 'image/png' });
}

describe('server cleaning (in memory)', () => {
  it('removes a real 48px Gemini mark and returns a PNG', async () => {
    const width = 1024;
    const size = 48;
    const origin = width - 32 - size;
    const pixels = Buffer.alloc(width * width * 3);
    for (let y = 0; y < width; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 3;
        pixels[index] = 40 + (x * 150) / width;
        pixels[index + 1] = 60 + (y * 120) / width;
        pixels[index + 2] = 110;
      }
    }
    const clean = Buffer.from(pixels);
    const alpha = getEmbeddedAlphaMap(size) as Float32Array;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const a = alpha[y * size + x];
        const index = ((origin + y) * width + origin + x) * 3;
        for (let channel = 0; channel < 3; channel += 1) pixels[index + channel] = Math.round(a * 255 + (1 - a) * pixels[index + channel]);
      }
    }

    const outcome = await cleanUploadedImage(await png(pixels, width, width, 'gemini.png'));
    expect(outcome.applied).toBe(true);
    const { data, info } = await sharp(outcome.png!).raw().toBuffer({ resolveWithObject: true });
    let maxError = 0;
    for (let y = origin; y < origin + size; y += 1) {
      for (let x = origin; x < origin + size; x += 1) {
        maxError = Math.max(maxError, Math.abs(data[(y * info.width + x) * info.channels] - clean[(y * width + x) * 3]));
      }
    }
    expect(maxError).toBeLessThan(6);
  }, 60_000);

  it('reports images without a mark instead of returning a copy', async () => {
    const outcome = await cleanUploadedImage(await png(Buffer.alloc(64 * 64 * 3, 120), 64, 64, 'plain.png'));
    expect(outcome).toMatchObject({ applied: false, png: null });
  });

  it('rejects unsupported, empty, oversized and undecodable uploads', async () => {
    await expect(cleanUploadedImage(new File(['x'], 'a.gif', { type: 'image/gif' }))).rejects.toMatchObject({ status: 415 });
    await expect(cleanUploadedImage(new File([], 'a.png', { type: 'image/png' }))).rejects.toMatchObject({ status: 400 });
    const big = new File([new Uint8Array(serverConfig.maxUploadBytes + 1)], 'big.png', { type: 'image/png' });
    await expect(cleanUploadedImage(big)).rejects.toMatchObject({ status: 413 });
    await expect(cleanUploadedImage(new File(['not a png'], 'bad.png', { type: 'image/png' }))).rejects.toBeInstanceOf(HttpError);
  });
});

describe('rate limit', () => {
  beforeEach(() => resetRateLimitsForTests());

  it('allows the configured number of images per window, then asks the client to wait', () => {
    const start = 1_000_000;
    for (let index = 0; index < serverConfig.rateLimitCount; index += 1) expect(takeRateLimit('1.2.3.4', start)).toBe(0);
    expect(takeRateLimit('1.2.3.4', start + 1000)).toBeGreaterThan(0);
    expect(takeRateLimit('5.6.7.8', start + 1000)).toBe(0);
    expect(takeRateLimit('1.2.3.4', start + serverConfig.rateLimitWindowMs)).toBe(0);
  });

  it('reads the client address from proxy headers', () => {
    expect(clientAddress(new Request('http://x/', { headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } }))).toBe('9.9.9.9');
    expect(clientAddress(new Request('http://x/'))).toBe('unknown');
  });
});
