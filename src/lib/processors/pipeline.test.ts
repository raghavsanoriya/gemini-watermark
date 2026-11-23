import { existsSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { nodeMiganSessionFactory } from '@/server/migan-node';
import { cleanImageData } from './pipeline';
import { outlineResidual, OUTLINE_RESIDUAL_SCORE } from './template-search';

const demo = (name: string) => join(process.cwd(), 'public', 'demo', name);
const modelAvailable = existsSync(join(process.cwd(), 'public', 'vendor', 'models', 'migan-pipeline-v2.onnx'));
const noMigan = { miganSessionFactory: async () => { throw new Error('MI-GAN disabled in this test'); } };

async function load(path: string, width?: number) {
  const pipeline = width ? sharp(path).resize(width).jpeg({ quality: 88 }) : sharp(path);
  const { data, info } = await sharp(await pipeline.toBuffer()).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
}

describe('image pipeline safeguards', () => {
  it('leaves an already-clean image untouched instead of painting a phantom mark', async () => {
    const image = await load(demo('timber-after.jpg'));
    const result = await cleanImageData(image, noMigan);
    expect(result.meta.applied).toBe(false);
    expect(Buffer.from(result.imageData.data).equals(Buffer.from(image.data))).toBe(true);
  }, 60_000);

  it('spots the outline a resized near-opaque mark leaves after the exact reverse solve', async () => {
    const result = await cleanImageData(await load(demo('timber-before.jpg'), 688), noMigan);
    expect(result.meta.applied).toBe(true);
    expect(await outlineResidual(result.imageData, result.meta.position!)).toBeGreaterThanOrEqual(OUTLINE_RESIDUAL_SCORE);
  }, 60_000);

  it.skipIf(!modelAvailable)('repaints that outline with MI-GAN', async () => {
    const result = await cleanImageData(await load(demo('timber-before.jpg'), 688), { miganSessionFactory: nodeMiganSessionFactory });
    expect((result.meta as { repairMode?: string }).repairMode).toBe('content-aware-migan');
    expect(await outlineResidual(result.imageData, result.meta.position!)).toBeLessThan(OUTLINE_RESIDUAL_SCORE);
  }, 120_000);
});
