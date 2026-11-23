import { describe, expect, it, vi } from 'vitest';
import type { FlowAsset } from '@/types/flow';
import type { ProcessorResult } from '@/types/media';
import type { MetadataReport } from '@/lib/metadata/scan';
import { describeBatchResult, runSequentialImageBatch } from './batch';

function asset(id: string): FlowAsset {
  const file = new File([id], `${id}.png`, { type: 'image/png' });
  return {
    id,
    mediaId: id,
    projectId: 'p',
    projectName: 'Project',
    name: file.name,
    sourcePath: file.name,
    outputPath: `Project/${file.name}`,
    mimeType: file.type,
    size: file.size,
    kind: 'image',
    supported: true,
    loadFile: async () => file,
  };
}

function result(applied = true): ProcessorResult {
  return {
    blob: new Blob(['processed']),
    mimeType: 'image/png',
    fileName: 'result.png',
    detection: { applied, decisionTier: null, skipReason: null, size: null, position: null },
  };
}

describe('sequential Flow processing', () => {
  it('processes one image at a time and preserves a clean original', async () => {
    let active = 0;
    let peak = 0;
    const processor = vi.fn(async (file: File) => {
      active += 1;
      peak = Math.max(peak, active);
      await Promise.resolve();
      active -= 1;
      return result(file.name !== 'b.png');
    });
    const completed: ProcessorResult[] = [];
    await runSequentialImageBatch([asset('a'), asset('b')], new AbortController().signal, processor, {
      onStart: vi.fn(), onProgress: vi.fn(), onError: vi.fn(), onCancelled: vi.fn(),
      onComplete: (_asset, value) => completed.push(value),
    });
    expect(peak).toBe(1);
    expect(processor.mock.calls.map(([file]) => file.name)).toEqual(['a.png', 'b.png']);
    expect(await completed[1].blob.text()).toBe('b');
    expect(completed[1].fileName).toBe('b.png');
  });

  it('cancels the active item and all remaining items', async () => {
    const controller = new AbortController();
    const cancelled: string[] = [];
    await runSequentialImageBatch([asset('a'), asset('b'), asset('c')], controller.signal, async () => {
      controller.abort();
      throw new DOMException('cancelled', 'AbortError');
    }, {
      onStart: vi.fn(), onProgress: vi.fn(), onComplete: vi.fn(), onError: vi.fn(),
      onCancelled: (item) => cancelled.push(item.id),
    });
    expect(cancelled).toEqual(['a', 'b', 'c']);
  });

  it('continues after one image fails', async () => {
    const failed: string[] = [];
    const completed: string[] = [];
    await runSequentialImageBatch([asset('a'), asset('b')], new AbortController().signal, async (file) => {
      if (file.name === 'a.png') throw new Error('bad image');
      return result();
    }, {
      onStart: vi.fn(), onProgress: vi.fn(), onCancelled: vi.fn(),
      onError: (item) => failed.push(item.id),
      onComplete: (item) => completed.push(item.id),
    });
    expect(failed).toEqual(['a']);
    expect(completed).toEqual(['b']);
  });

  it('keeps a metadata-only result and passes the asset to the processor', async () => {
    const seen: string[] = [];
    const completed: ProcessorResult[] = [];
    await runSequentialImageBatch([asset('a')], new AbortController().signal, async (_file, _options, item) => {
      seen.push(item.id);
      return { ...result(false), operation: 'metadata' };
    }, {
      onStart: vi.fn(), onProgress: vi.fn(), onError: vi.fn(), onCancelled: vi.fn(),
      onComplete: (_item, value) => completed.push(value),
    });
    expect(seen).toEqual(['a']);
    expect(await completed[0].blob.text()).toBe('processed');
  });
});

function report(found: MetadataReport['found'], container: MetadataReport['container'] = 'png'): MetadataReport {
  return { container, found, details: {} };
}

describe('batch result wording', () => {
  it('describes metadata-only outcomes', () => {
    const stripped = (before: MetadataReport, after: MetadataReport): ProcessorResult => ({
      ...result(false), operation: 'metadata', metadata: { before, after, lossless: true },
      detection: { applied: false, decisionTier: 'metadata-only', skipReason: null, size: null, position: null },
    });
    expect(describeBatchResult(stripped(report(['gps', 'exif']), report([])), undefined))
      .toEqual({ state: 'complete', message: 'Metadata removed, pixels unchanged' });
    expect(describeBatchResult(stripped(report([]), report([])), undefined).state).toBe('clean');
    expect(describeBatchResult(stripped(report([], 'unknown'), report([])), undefined).message).toBe('Converted to PNG, metadata removed');
    expect(describeBatchResult(stripped(report(['xmp']), report(['xmp'])), undefined).message).toContain('still has XMP');
  });

  it('describes an image without a mark whose metadata was still removed', () => {
    const fallback: ProcessorResult = {
      ...result(false), operation: 'metadata', metadata: { before: report(['gps']), after: report([]), lossless: true },
    };
    expect(describeBatchResult(fallback, report(['gps'])))
      .toEqual({ state: 'clean', message: 'No supported mark found; picture kept, metadata removed' });
  });

  it('notes metadata on watermark results and kept originals', () => {
    const repaired: ProcessorResult = { ...result(true), metadata: { before: report(['c2pa']), after: report([]), lossless: false } };
    expect(describeBatchResult(repaired, report(['c2pa'])).message).toBe('Visible mark repaired and metadata removed');
    expect(describeBatchResult(result(false), report(['gps'])))
      .toEqual({ state: 'clean', message: 'No supported mark found; original kept (it still has hidden metadata)' });
    expect(describeBatchResult(result(false), report([])).message).toBe('No supported mark found; original kept');
  });
});
