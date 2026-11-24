import { removeWatermarkFromImageDataSync } from '@pilio/gemini-watermark-remover/image-data';
import type { ImageDataRemovalResult } from '@pilio/gemini-watermark-remover';
import {
  hasDestructiveRemovalDamage,
  repairDetectedResidual,
  tryPanoramaImageFallback,
  type ExtendedMeta,
  type PixelImageData,
} from './image-panorama-fallback';
import { lamaModel, type LamaSessionFactory } from './lama-inpaint';
import { miganModel, repairWithModel, type MiganRequest, type MiganSessionFactory } from './migan-inpaint';
import type { RepairQuality } from '@/types/media';

/** Marks this small always get an MI-GAN pass after the reverse solve. */
const TINY_MARK_SIZE = 18;
import {
  hasMarkEvidence,
  isGeminiPlacement,
  locateMarkByTemplate,
  markScore,
  outlineResidual,
  OUTLINE_RESIDUAL_SCORE,
  removeMarkAt,
  type TemplateMatch,
} from './template-search';

type Box = { x: number; y: number; width: number; height: number };

function overlap(a: Box, b: Box): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (w <= 0 || h <= 0) return 0;
  return (w * h) / Math.min(a.width * a.height, b.width * b.height);
}

export interface CleanImageOptions {
  /** Loads the MI-GAN model; omitted in the browser, where the bundled loader is used. */
  miganSessionFactory?: MiganSessionFactory;
  /** Called when the optional MI-GAN repair fails (the pipeline then falls back). */
  onMiganError?: (error: unknown) => void;
  /** 'best' tries the larger LaMa model first and falls back to MI-GAN if it cannot run or is rejected. */
  quality?: RepairQuality;
  /** Loads LaMa; omitted in the browser, where the self-hosted model is downloaded. */
  lamaSessionFactory?: LamaSessionFactory;
  /** Called when the LaMa repair fails to load or run (MI-GAN is tried next). */
  onLamaError?: (error: unknown) => void;
}

/**
 * The full GemClean image pipeline, shared by the browser worker and the server:
 * calibrated reverse-alpha removal, a measured residual check, MI-GAN content-aware
 * repair when a leftover is visible, and Telea only as a fallback for clipped output.
 */
export async function cleanImageData(
  input: PixelImageData,
  options: CleanImageOptions = {},
): Promise<ImageDataRemovalResult> {
  const original = { width: input.width, height: input.height, data: new Uint8ClampedArray(input.data) };
  const copy = (): PixelImageData => ({ width: original.width, height: original.height, data: new Uint8ClampedArray(original.data) });
  const runCatalog = (adaptiveMode: 'never' | 'auto') => removeWatermarkFromImageDataSync(copy(), {
    adaptiveMode,
    aggressiveLocatedFallback: true,
    locatedAggressiveRemoval: true,
  });
  // The free corner search runs at most once.
  let searched: TemplateMatch | null | undefined;
  const search = async () => (searched === undefined ? (searched = await locateMarkByTemplate(original)) : searched);

  type Located = { located: ImageDataRemovalResult; result: ImageDataRemovalResult };
  const fromSearch = async (match: TemplateMatch | null): Promise<Located | null> => {
    const removed = await removeMarkAt(original, match);
    return removed ? { located: removed, result: repairDetectedResidual(original, removed) } : null;
  };

  /**
   * Accepts a catalog removal only if the original supports it. The catalog can "validate" a
   * mark where the picture shows none (e.g. a 108px match on an already-clean image), and the
   * reverse solve then paints a dark sparkle in; a real mark always leaves its outline and shape.
   * It can also "validate" a standard-size mark in the wrong place on a resized image, so the
   * free search is consulted: if the two disagree on position or size, the better fit wins,
   * provided the search's match sits where Gemini places the mark.
   */
  const acceptCatalog = async (found: ImageDataRemovalResult): Promise<Located | null> => {
    const box = found.meta.position;
    if (!found.meta.applied) return null;
    if (box && !(await hasMarkEvidence(original, box))) return null;
    const match = box ? await search() : null;
    const disagree = !!match && !!box && (
      overlap(box, match.position) < 0.5
      || Math.max(box.width, match.position.width) / Math.min(box.width, match.position.width) > 1.15
    );
    if (disagree && match && box
      && isGeminiPlacement(original.width, original.height, match.position)
      && match.score > (await markScore(original, box)) + 0.05) {
      const better = await fromSearch(match);
      if (better) return better;
    }
    return { located: found, result: repairDetectedResidual(original, found) };
  };

  // Cheapest first: the catalog's known offsets (~0.2 s), then the panorama layout, then the free
  // corner search (~1 s), and only then the library's adaptive search, which costs several seconds
  // on a large photo and is rarely the one that finds a mark the corner search missed.
  const quick = runCatalog('never');
  let found = await acceptCatalog(quick);
  let last = quick;
  if (!found) {
    const panorama = tryPanoramaImageFallback(copy(), removeWatermarkFromImageDataSync);
    if (panorama && (!panorama.meta.position || await hasMarkEvidence(original, panorama.meta.position))) {
      found = { located: { imageData: copy(), meta: { ...quick.meta, applied: false } as typeof quick.meta }, result: panorama };
    }
  }
  if (!found) found = await fromSearch(await search());
  if (!found) {
    last = runCatalog('auto');
    found = await acceptCatalog(last);
  }
  // Built only when nothing was found: a full-size copy is ~4 bytes per pixel of memory.
  const untouched = (): ImageDataRemovalResult => ({
    imageData: copy(),
    meta: last.meta.applied
      ? { ...last.meta, applied: false, skipReason: 'no-mark-evidence', position: null, size: null } as typeof last.meta
      : last.meta,
  });
  if (!found) return untouched();
  // `located` is the reverse-alpha removal the rest of the pipeline builds on.
  const { located } = found;
  let result: ImageDataRemovalResult = found.result;
  const reverseAlpha = located.imageData;

  // MI-GAN is the preferred content-aware repair. Telea is kept only as an
  // offline fallback for clipped/black output; for a faint leftover its smears
  // are worse than the plain reverse-alpha result.
  const resultMeta = result.meta as ExtendedMeta;
  const removedPosition = resultMeta.applied && resultMeta.repairMode === 'reverse-alpha' ? resultMeta.position : null;
  const outlineLeft = !!removedPosition && await outlineResidual(result.imageData, removedPosition) >= OUTLINE_RESIDUAL_SCORE;
  // Below ~18px (a picture saved at a third of Gemini's size) resampling has mixed the mark into
  // its neighbours, so the exact solve leaves a faint trace that no score measures reliably.
  const tinyMark = !!removedPosition && removedPosition.width <= TINY_MARK_SIZE;
  const request: MiganRequest = outlineLeft && removedPosition
    ? { force: true, accept: async (candidate) => await outlineResidual(candidate, removedPosition) < OUTLINE_RESIDUAL_SCORE }
    : { force: tinyMark };
  let repaired: ImageDataRemovalResult | null = null;
  if (options.quality === 'best') {
    try {
      repaired = await repairWithModel(original, reverseAlpha, result, lamaModel(options.lamaSessionFactory), request);
    } catch (error) {
      options.onLamaError?.(error);
    }
  }
  if (!repaired) {
    try {
      repaired = await repairWithModel(original, reverseAlpha, result, miganModel(options.miganSessionFactory), request);
    } catch (error) {
      // The optional model may be unavailable (offline, or not shipped to this host).
      options.onMiganError?.(error);
    }
  }
  if (repaired) return repaired;
  if (
    located.meta.applied &&
    (result.meta as ExtendedMeta).repairMode === 'content-aware-telea' &&
    !hasDestructiveRemovalDamage(located.meta as ExtendedMeta)
  ) {
    result = {
      imageData: reverseAlpha,
      meta: { ...result.meta, source: located.meta.source, repairMode: 'reverse-alpha', repairSafety: 'rejected' } as typeof result.meta,
    };
  }
  return result;
}
