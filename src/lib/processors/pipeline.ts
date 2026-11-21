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
import { removeMarkByTemplateSearch } from './template-search';

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
  // `located` is the reverse-alpha removal the rest of the pipeline builds on.
  let located = primary;
  let result: ImageDataRemovalResult = primary;
  if (primary.meta.applied) {
    result = repairDetectedResidual(original, primary);
  } else {
    const panorama = tryPanoramaImageFallback(source, removeWatermarkFromImageDataSync);
    if (panorama) {
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
  let migan: ImageDataRemovalResult | null = null;
  try {
    migan = await repairWithMigan(original, reverseAlpha, result, options.miganSessionFactory);
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
