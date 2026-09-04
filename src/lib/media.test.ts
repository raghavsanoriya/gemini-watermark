import { describe, expect, it } from 'vitest';
import {
  SOFT_VIDEO_BYTES,
  getMediaKind,
  needsVideoOverride,
  outputFileName,
  validateMediaFile,
} from './media';

describe('media validation', () => {
  it('classifies supported image and video types', () => {
    expect(getMediaKind({ type: 'image/png' })).toBe('image');
    expect(getMediaKind({ type: 'video/mp4' })).toBe('video');
    expect(getMediaKind({ type: 'application/pdf' })).toBeNull();
  });

  it('rejects unsupported and empty files', () => {
    expect(() => validateMediaFile({ type: 'application/pdf', size: 10 })).toThrow(/Use PNG/);
    expect(() => validateMediaFile({ type: 'image/png', size: 0 })).toThrow(/empty/);
  });

  it('uses soft video limits without hard rejecting files', () => {
    expect(needsVideoOverride(SOFT_VIDEO_BYTES + 1, 30)).toBe(true);
    expect(needsVideoOverride(10, 121)).toBe(true);
    expect(needsVideoOverride(10, 120)).toBe(false);
  });

  it('creates predictable output names', () => {
    expect(outputFileName('photo.final.png', 'image', 'image/png')).toBe('gemclean-photo.final.png');
    expect(outputFileName('clip.mov', 'video')).toBe('gemclean-clip.mp4');
  });
});
