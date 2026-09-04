import sharp from 'sharp';
import { removeWatermarkFromImageDataSync } from '@pilio/gemini-watermark-remover/image-data';

const inputPath = process.argv[2];
if (!inputPath) throw new Error('Pass an image path.');
const { data, info } = await sharp(inputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const source = { width: info.width, height: info.height, data: new Uint8ClampedArray(data) };
const result = removeWatermarkFromImageDataSync(source, {
  adaptiveMode: 'auto',
  aggressiveLocatedFallback: true,
  locatedAggressiveRemoval: true,
});
const summaries = result.meta.candidateSummaries?.map((candidate) => ({
  id: candidate.id,
  family: candidate.family,
  rank: candidate.rank,
  finalScore: candidate.finalScore,
  qualityStatus: candidate.qualityStatus,
  position: candidate.qualitySignals?.position,
  original: candidate.qualitySignals?.original,
  final: candidate.qualitySignals?.final,
  visibility: candidate.qualitySignals?.visibility,
  damage: candidate.qualitySignals?.damageComponents,
})) ?? [];
console.log(JSON.stringify({
  selected: {
    source: result.meta.source,
    size: result.meta.size,
    position: result.meta.position,
    config: result.meta.config,
    alphaGain: result.meta.alphaGain,
    qualityStatus: result.meta.qualityStatus,
    selectionConfidence: result.meta.selectionConfidence,
    imperfections: result.meta.qualitySignals?.imperfections,
  },
  candidates: summaries,
}, null, 2));
