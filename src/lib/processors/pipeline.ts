import { removeWatermarkFromImageDataSync } from '@pilio/gemini-watermark-remover/image-data';
import type { ImageDataRemovalResult } from '@pilio/gemini-watermark-remover';
import {
  hasDestructiveRemovalDamage,
  repairDetectedResidual,
  tryPanoramaImageFallback,
  type ExtendedMeta,
  type PixelImageData,
} from './image-panorama-fallback';
import { repairWithMigan, type MiganSessionFactory } from './migan-inpaint';
import {
  hasMarkEvidence,
  isGeminiPlacement,
  locateMarkByTemplate,
  markScore,
  outlineResidual,
  OUTLINE_RESIDUAL_SCORE,
  removeMarkAt,
  removeMarkByTemplateSearch,
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
  const source = { width: input.width, height: input.height, data: new Uint8ClampedArray(input.data) };
  const primary = removeWatermarkFromImageDataSync(source, {
    adaptiveMode: 'auto',
    aggressiveLocatedFallback: true,
    locatedAggressiveRemoval: true,
  });
  // The catalog can "validate" a mark where the original shows none (e.g. a 108px match on an
  // already-clean image), and reverse-alpha then paints a dark sparkle into the picture. A real
  // mark always leaves its outline in the original, so a detection without one is discarded.
  const phantom = primary.meta.applied && !!primary.meta.position && !(await hasMarkEvidence(original, primary.meta.position));
  const primaryApplied = primary.meta.applied && !phantom;
  const untouched: ImageDataRemovalResult = {
    imageData: { width: original.width, height: original.height, data: new Uint8ClampedArray(original.data) },
    meta: { ...primary.meta, applied: false, skipReason: 'no-mark-evidence', position: null, size: null } as typeof primary.meta,
  };
  // `located` is the reverse-alpha removal the rest of the pipeline builds on.
  let located = primaryApplied ? primary : phantom ? untouched : primary;
  let result: ImageDataRemovalResult = located;
  // The catalog can also "validate" a standard-size mark in the wrong place when the image was
  // resized afterwards, leaving the real, smaller sparkle untouched. Cross-check with a free search.
  const crossCheck = primaryApplied ? await locateMarkByTemplate(original) : null;
  // When the two disagree on where the mark is or how big it is, keep the one that explains the
  // pixels better; overriding also needs the match to sit where Gemini places the mark.
  const primaryBox = primary.meta.position;
  const disagree = !!crossCheck && !!primaryBox && (
    overlap(primaryBox, crossCheck.position) < 0.5
    || Math.max(primaryBox.width, crossCheck.position.width) / Math.min(primaryBox.width, crossCheck.position.width) > 1.15
  );
  const misplaced = disagree && crossCheck && primaryBox
    && isGeminiPlacement(original.width, original.height, crossCheck.position)
    && crossCheck.score > (await markScore(original, primaryBox)) + 0.05
    ? await removeMarkAt(original, crossCheck)
    : null;
  if (misplaced) {
    located = misplaced;
    result = repairDetectedResidual(original, misplaced);
  } else if (primaryApplied) {
    result = repairDetectedResidual(original, primary);
  } else {
    const fresh = phantom ? { width: original.width, height: original.height, data: new Uint8ClampedArray(original.data) } : source;
    const panorama = tryPanoramaImageFallback(fresh, removeWatermarkFromImageDataSync);
    if (panorama && (!panorama.meta.position || await hasMarkEvidence(original, panorama.meta.position))) {
      result = panorama;
    } else {
      // The catalog only predicts official offsets; resized or re-cropped Gemini
      // images need a free search of the corner.
      const searched = await removeMarkByTemplateSearch(original);
      if (searched) {
        located = searched;
        result = repairDetectedResidual(original, searched);
      }
    }
  }
  const reverseAlpha = located.imageData;

  // MI-GAN is the preferred content-aware repair. Telea is kept only as an
  // offline fallback for clipped/black output; for a faint leftover its smears
  // are worse than the plain reverse-alpha result.
  const resultMeta = result.meta as ExtendedMeta;
  const outlinePosition = resultMeta.applied && resultMeta.repairMode === 'reverse-alpha' ? resultMeta.position : null;
  const outlineLeft = !!outlinePosition && await outlineResidual(result.imageData, outlinePosition) >= OUTLINE_RESIDUAL_SCORE;
  let migan: ImageDataRemovalResult | null = null;
  try {
    migan = await repairWithMigan(original, reverseAlpha, result, options.miganSessionFactory, outlineLeft && outlinePosition
      ? async (candidate) => await outlineResidual(candidate, outlinePosition) < OUTLINE_RESIDUAL_SCORE
      : undefined);
  } catch (error) {
    // The optional model may be unavailable (offline, or not shipped to this host).
    options.onMiganError?.(error);
  }
  if (migan) return migan;
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
