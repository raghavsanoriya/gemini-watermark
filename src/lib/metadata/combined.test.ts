import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ProcessorResult } from '@/types/media';
import { isMetadataFallback, removeWatermarkAndMetadata, scanFile } from './clean';

const EXIF = { IFD0: { Make: 'Pixel', Software: 'Google' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '12/1 0/1 0/1' } };

async function jpeg(withExif: boolean): Promise<File> {
  const image = sharp({ create: { width: 64, height: 48, channels: 3, background: { r: 90, g: 120, b: 160 } } }).jpeg();
  const bytes = await (withExif ? image.withExif(EXIF) : image).toBuffer();
  return new File([new Uint8Array(bytes)], 'photo.jpg', { type: 'image/jpeg' });
}

const options = { signal: new AbortController().signal, onProgress: () => {} };

function processorResult(blob: Blob, applied: boolean): ProcessorResult {
  return {
    blob,
    mimeType: blob.type,
    fileName: 'gemclean-photo.jpg',
    detection: { applied, decisionTier: applied ? 'validated-match' : null, skipReason: null, size: applied ? 48 : null, position: null },
  };
}

describe('one-button watermark and metadata cleaning', () => {
  // Node has no createImageBitmap; the metadata stripper only needs the decoded size.
  beforeEach(() => {
    vi.stubGlobal('createImageBitmap', async (blob: Blob) => {
      const { width, height } = await sharp(Buffer.from(await blob.arrayBuffer())).metadata();
      return { width, height, close: () => {} };
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('removes the mark and proves the download has no metadata, stripping any that survived', async () => {
    const file = await jpeg(true);
    const before = await scanFile(file);
    // A repair step that (wrongly) kept the EXIF block in its output.
    const result = await removeWatermarkAndMetadata(file, options, async (input) => processorResult(input, true), before);
    expect(result.operation).toBe('watermark');
    expect(result.metadata?.before?.found).toContain('gps');
    expect(result.metadata?.after.found).toEqual([]);
    expect((await scanFile(result.blob)).found).toEqual([]);
  });

  it('still removes the metadata when no mark is found, leaving the picture as it was', async () => {
    const file = await jpeg(true);
    const result = await removeWatermarkAndMetadata(file, options, async (input) => processorResult(input, false), await scanFile(file));
    expect(isMetadataFallback(result)).toBe(true);
    expect(result.detection.applied).toBe(false);
    expect(result.metadata?.lossless).toBe(true);
    expect((await scanFile(result.blob)).found).toEqual([]);
  });

  it('reports nothing to do when there is neither a mark nor metadata', async () => {
    const file = await jpeg(false);
    const result = await removeWatermarkAndMetadata(file, options, async (input) => processorResult(input, false), await scanFile(file));
    expect(result.operation).toBeUndefined();
    expect(result.blob).toBe(file);
  });
});
