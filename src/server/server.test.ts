import sharp from 'sharp';
import { beforeEach, describe, expect, it } from 'vitest';
import { cleanUploadedImage, MAX_INPUT_PIXELS } from './clean';
import { serverConfig } from './config';
import { HttpError } from './http';
import { positiveNumber } from './config';
import { clientAddress, rateLimitEntryCount, resetRateLimitsForTests, takeRateLimit } from './rate-limit';
import { readUploadedFile } from './upload';
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

  it('decodes only real PNG, JPEG and WebP bytes, whatever the upload claims', async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/></svg>';
    await expect(cleanUploadedImage(new File([svg], 'x.png', { type: 'image/png' }))).rejects.toMatchObject({ status: 415 });
    const gif = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#888' } }).gif().toBuffer();
    await expect(cleanUploadedImage(new File([new Uint8Array(gif)], 'x.png', { type: 'image/png' }))).rejects.toMatchObject({ status: 415 });
  });

  it('refuses tiny files that decode to huge images', async () => {
    // A 40 MP flat PNG compresses to ~130 KB but needed over 1 GB of server memory.
    const side = Math.ceil(Math.sqrt(MAX_INPUT_PIXELS)) + 16;
    const bomb = await sharp({ create: { width: side, height: side, channels: 3, background: '#808080' } }).png({ compressionLevel: 9 }).toBuffer();
    expect(bomb.length).toBeLessThan(serverConfig.maxUploadBytes);
    await expect(cleanUploadedImage(new File([new Uint8Array(bomb)], 'bomb.png', { type: 'image/png' }))).rejects.toMatchObject({ status: 413 });
  }, 60_000);
});

describe('upload body', () => {
  const form = (bytes: Uint8Array) => {
    const body = new FormData();
    body.append('file', new File([bytes as Uint8Array<ArrayBuffer>], 'a.png', { type: 'image/png' }));
    return body;
  };

  it('returns the uploaded file when the body is within the limit', async () => {
    const file = await readUploadedFile(new Request('http://x/', { method: 'POST', body: form(new Uint8Array(1000)) }), 4096);
    expect(file.size).toBe(1000);
  });

  it('rejects an oversized body from its declared length without reading it', async () => {
    const request = new Request('http://x/', { method: 'POST', body: 'x', headers: { 'content-length': String(50 * 1024 * 1024), 'content-type': 'multipart/form-data; boundary=x' } });
    await expect(readUploadedFile(request, 4096)).rejects.toMatchObject({ status: 413 });
    expect(request.bodyUsed).toBe(false);
  });

  it('stops reading a streamed body once it passes the limit', async () => {
    let pulled = 0;
    const chunk = new Uint8Array(64 * 1024);
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) { pulled += 1; if (pulled > 1000) controller.close(); else controller.enqueue(chunk); },
    });
    const request = new Request('http://x/', {
      method: 'POST', body: stream, headers: { 'content-type': 'multipart/form-data; boundary=x' }, duplex: 'half',
    } as RequestInit);
    await expect(readUploadedFile(request, 256 * 1024)).rejects.toMatchObject({ status: 413 });
    expect(pulled).toBeLessThan(20);
  });

  it('asks for a file field', async () => {
    const body = new FormData();
    body.append('other', 'x');
    await expect(readUploadedFile(new Request('http://x/', { method: 'POST', body }), 4096)).rejects.toMatchObject({ status: 400 });
  });
});

describe('server settings', () => {
  it('falls back to the default for missing, empty, zero, negative or non-numeric values', () => {
    expect(positiveNumber(undefined, 4)).toBe(4);
    for (const bad of ['', '0', '-1', 'abc', '4MB', 'Infinity']) expect(positiveNumber(bad, 4)).toBe(4);
    expect(positiveNumber('2.5', 4)).toBe(2.5);
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

  it('keeps a bounded number of addresses in memory', () => {
    const start = 2_000_000;
    for (let index = 0; index < 30_000; index += 1) takeRateLimit(`10.0.${index >> 8}.${index & 255}-${index}`, start);
    expect(rateLimitEntryCount()).toBeLessThanOrEqual(10_000);
  });

  it('reads the client address from proxy headers', () => {
    expect(clientAddress(new Request('http://x/', { headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } }))).toBe('9.9.9.9');
    expect(clientAddress(new Request('http://x/'))).toBe('unknown');
  });
});
