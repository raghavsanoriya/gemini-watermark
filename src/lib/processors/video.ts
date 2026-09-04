/*
 * Video container and audio-copy flow adapted from GargantuaX/gemini-watermark-remover.
 * Copyright (c) 2025 Jad and (c) 2024 AllenK (Kwyshell), used under the MIT License.
 */
import { removeWatermarkFromImageDataSync } from '@pilio/gemini-watermark-remover/image-data';
import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  canEncodeVideo,
} from 'mediabunny';
import { outputFileName, ProcessorError } from '@/lib/media';
import type { ProcessorOptions, ProcessorResult, WatermarkDetection } from '@/types/media';

const VIDEO_BITRATE = 12_000_000;
const SAMPLE_COUNT = 12;

function abortIfNeeded(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException('Video processing cancelled.', 'AbortError');
}

function createCanvas(width: number, height: number): HTMLCanvasElement | OffscreenCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export async function processVideo(file: File, options: ProcessorOptions): Promise<ProcessorResult> {
  const { signal, onProgress } = options;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  let output: Output | null = null;
  let sourceCodec: string | null = null;

  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new ProcessorError('decode-failed', 'The file does not contain a video track.');

    const [width, height, firstTimestamp, codec, durationValue, stats] = await Promise.all([
      videoTrack.getDisplayWidth(),
      videoTrack.getDisplayHeight(),
      videoTrack.getFirstTimestamp().catch(() => 0),
      videoTrack.getCodec().catch(() => null),
      input.getDurationFromMetadata([videoTrack], { skipLiveWait: true }).catch(() => null),
      videoTrack.computePacketStats(90, { skipLiveWait: true }).catch(() => null),
    ]);
    sourceCodec = codec;
    const duration = Number.isFinite(durationValue) && Number(durationValue) > 0
      ? Number(durationValue)
      : await videoTrack.computeDuration({ skipLiveWait: true }).catch(() => 0);
    const frameRate = stats?.averagePacketRate && stats.averagePacketRate > 0 ? stats.averagePacketRate : 30;
    const frameEstimate = duration > 0 ? Math.max(1, Math.round(duration * frameRate)) : null;
    abortIfNeeded(signal);

    onProgress({ phase: 'detecting', progress: 0.03, message: 'Checking video and codec support…' });
    const canEncodeAvc = await canEncodeVideo('avc', {
      width,
      height,
      bitrate: VIDEO_BITRATE,
      latencyMode: 'quality',
      bitrateMode: 'constant',
      hardwareAcceleration: 'no-preference',
      contentHint: 'detail',
    });
    if (!canEncodeAvc) {
      throw new ProcessorError(
        'unsupported-codec',
        'This browser cannot encode H.264 locally. Use a current version of Chrome or Edge.'
      );
    }

    const canvas = createCanvas(width, height);
    const context = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
    if (!context) throw new ProcessorError('processing-failed', 'Canvas video processing is unavailable.');

    const targets = Array.from({ length: SAMPLE_COUNT }, (_, index) =>
      Math.max(0, firstTimestamp) + (duration > 0 ? duration * (index + 1) / (SAMPLE_COUNT + 1) : index / frameRate)
    );
    const detectionSink = new VideoSampleSink(videoTrack);
    let targetIndex = 0;
    let bestDetection: WatermarkDetection | null = null;
    let detectedFrames = 0;

    for await (const sample of detectionSink.samples()) {
      try {
        abortIfNeeded(signal);
        if (targetIndex >= targets.length) break;
        if (sample.timestamp < targets[targetIndex]) continue;
        sample.draw(context, 0, 0, width, height);
        const result = removeWatermarkFromImageDataSync(context.getImageData(0, 0, width, height), {
          adaptiveMode: 'auto',
          aggressiveLocatedFallback: true,
          locatedAggressiveRemoval: true,
        });
        if (result.meta.applied) {
          detectedFrames += 1;
          bestDetection = {
            applied: true,
            decisionTier: result.meta.decisionTier,
            skipReason: result.meta.skipReason,
            size: result.meta.size,
            position: result.meta.position,
          };
        }
        targetIndex += 1;
        onProgress({
          phase: 'detecting',
          progress: 0.05 + 0.2 * (targetIndex / targets.length),
          message: `Checking representative frames (${targetIndex}/${targets.length})…`,
        });
      } finally {
        sample.close();
      }
    }
    if (!bestDetection || detectedFrames === 0) {
      throw new ProcessorError('no-watermark', 'No supported Gemini, Veo, or Flow mark was detected confidently.');
    }

    abortIfNeeded(signal);
    const target = new BufferTarget();
    const format = new Mp4OutputFormat({ fastStart: 'in-memory' });
    output = new Output({ format, target });
    const canvasSource = new CanvasSource(canvas, {
      codec: 'avc',
      bitrate: VIDEO_BITRATE,
      alpha: 'discard',
      keyFrameInterval: 2,
      latencyMode: 'quality',
      bitrateMode: 'constant',
      hardwareAcceleration: 'no-preference',
      contentHint: 'detail',
    });
    output.addVideoTrack(canvasSource, { frameRate });

    const audioTrack = await input.getPrimaryAudioTrack().catch(() => null);
    let audioSource: EncodedAudioPacketSource | null = null;
    let audioCopyPromise: Promise<number> = Promise.resolve(0);
    if (audioTrack) {
      const audioCodec = await audioTrack.getCodec().catch(() => null);
      if (!audioCodec || !format.getSupportedAudioCodecs().includes(audioCodec)) {
        throw new ProcessorError(
          'unsupported-codec',
          'The video audio codec cannot be copied into MP4 by this browser. Convert the source audio to AAC and retry.'
        );
      }
      audioSource = new EncodedAudioPacketSource(audioCodec);
      output.addAudioTrack(audioSource);
      const decoderConfig = await audioTrack.getDecoderConfig().catch(() => null);
      const source = audioSource;
      audioCopyPromise = (async () => {
        let count = 0;
        const sink = new EncodedPacketSink(audioTrack);
        for await (const packet of sink.packets()) {
          abortIfNeeded(signal);
          const shifted = packet.timestamp - firstTimestamp;
          if (packet.timestamp + packet.duration <= firstTimestamp) continue;
          const normalized = shifted >= 0
            ? packet
            : packet.clone({ timestamp: 0, duration: Math.max(0, packet.duration + shifted) });
          await source.add(normalized, { decoderConfig: decoderConfig ?? undefined });
          count += 1;
        }
        source.close();
        return count;
      })();
    }

    await output.start();
    const sink = new VideoSampleSink(videoTrack);
    let processedFrames = 0;
    let lastTimestamp = -Infinity;
    const fallbackDuration = 1 / frameRate;

    for await (const sample of sink.samples()) {
      try {
        abortIfNeeded(signal);
        sample.draw(context, 0, 0, width, height);
        const frame = context.getImageData(0, 0, width, height);
        const repaired = removeWatermarkFromImageDataSync(frame, {
          adaptiveMode: 'auto',
          aggressiveLocatedFallback: true,
          locatedAggressiveRemoval: true,
        });
        const repairedPixels = new Uint8ClampedArray(repaired.imageData.data.length);
        repairedPixels.set(repaired.imageData.data);
        context.putImageData(new ImageData(repairedPixels, width, height), 0, 0);

        let timestamp = Math.max(0, sample.timestamp - firstTimestamp);
        if (timestamp < lastTimestamp) timestamp = lastTimestamp + fallbackDuration;
        const frameDuration = sample.duration > 0 ? sample.duration : fallbackDuration;
        await canvasSource.add(timestamp, frameDuration);
        lastTimestamp = timestamp;
        processedFrames += 1;
        const progress = duration > 0
          ? Math.min(0.93, 0.25 + 0.68 * ((timestamp + frameDuration) / duration))
          : Math.min(0.93, 0.25 + 0.68 * (processedFrames / Math.max(1, frameEstimate ?? processedFrames + 1)));
        onProgress({
          phase: 'processing',
          progress,
          message: `Repairing video frame ${processedFrames}${frameEstimate ? ` of about ${frameEstimate}` : ''}…`,
          processedFrames,
          frameEstimate,
        });
      } finally {
        sample.close();
      }
    }

    canvasSource.close();
    const audioPackets = await audioCopyPromise;
    onProgress({ phase: 'encoding', progress: 0.96, message: 'Finalizing the MP4…' });
    await output.finalize();
    if (!target.buffer) throw new ProcessorError('encode-failed', 'The MP4 encoder returned an empty file.');

    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    onProgress({ phase: 'encoding', progress: 1, message: 'Video ready.' });
    return {
      blob,
      mimeType: 'video/mp4',
      fileName: outputFileName(file.name, 'video'),
      detection: bestDetection,
      audioPreserved: !audioTrack || audioPackets > 0,
    };
  } catch (error) {
    if (output && output.state !== 'finalized' && output.state !== 'canceled') {
      await output.cancel().catch(() => undefined);
    }
    if (error instanceof ProcessorError || error instanceof DOMException) throw error;
    throw new ProcessorError(
      sourceCodec ? 'processing-failed' : 'decode-failed',
      error instanceof Error ? error.message : 'Video processing failed.',
      { cause: error }
    );
  } finally {
    input.dispose();
  }
}
