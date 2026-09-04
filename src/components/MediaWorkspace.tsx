'use client';
/* eslint-disable @next/next/no-img-element -- object URLs are local user media and cannot use next/image */

import { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  ImagePlus,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Square,
  Upload,
  Video,
  X,
} from 'lucide-react';
import { formatBytes, isAbortError, needsVideoOverride, ProcessorError, validateMediaFile } from '@/lib/media';
import { processImage } from '@/lib/processors/image';
import type { MediaKind, ProcessingJob, ProcessorResult } from '@/types/media';

const initialJob: ProcessingJob = { phase: 'idle', progress: 0, message: '' };

function getVideoDuration(url: string): Promise<number | null> {
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const finish = (value: number | null) => {
      video.removeAttribute('src');
      video.load();
      resolve(value);
    };
    video.onloadedmetadata = () => finish(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => finish(null);
    video.src = url;
  });
}

export function MediaWorkspace() {
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const objectUrlsRef = useRef(new Set<string>());
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState<MediaKind | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [result, setResult] = useState<(ProcessorResult & { url: string }) | null>(null);
  const [job, setJob] = useState<ProcessingJob>(initialJob);
  const [dragging, setDragging] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [showWarning, setShowWarning] = useState(false);
  const [comparison, setComparison] = useState<'before' | 'after'>('after');

  useEffect(() => () => {
    abortRef.current?.abort();
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    objectUrlsRef.current.clear();
  }, []);

  const createObjectUrl = (blob: Blob) => {
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.add(url);
    return url;
  };

  const revokeObjectUrl = (url: string | null | undefined) => {
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrlsRef.current.delete(url);
  };

  const reset = () => {
    abortRef.current?.abort();
    revokeObjectUrl(previewUrl);
    revokeObjectUrl(result?.url);
    if (inputRef.current) inputRef.current.value = '';
    setFile(null);
    setKind(null);
    setPreviewUrl(null);
    setResult(null);
    setDuration(null);
    setShowWarning(false);
    setComparison('after');
    setJob(initialJob);
  };

  const acceptFile = async (next: File | undefined) => {
    if (!next) return;
    setJob({ phase: 'validating', progress: 0, message: 'Checking file…' });
    try {
      const nextKind = validateMediaFile(next);
      revokeObjectUrl(previewUrl);
      revokeObjectUrl(result?.url);
      const url = createObjectUrl(next);
      setFile(next);
      setKind(nextKind);
      setPreviewUrl(url);
      setResult(null);
      setComparison('after');
      const nextDuration = nextKind === 'video' ? await getVideoDuration(url) : null;
      setDuration(nextDuration);
      setShowWarning(false);
      setJob({ phase: 'ready', progress: 0, message: 'Ready to process locally.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'This file cannot be used.';
      setJob({ phase: 'failed', progress: 0, message, errorCode: error instanceof ProcessorError ? error.code : 'processing-failed' });
    }
  };

  const startProcessing = async (overrideLimits = false) => {
    if (!file || !kind) return;
    if (kind === 'video' && needsVideoOverride(file.size, duration) && !overrideLimits) {
      setShowWarning(true);
      return;
    }
    setShowWarning(false);
    const controller = new AbortController();
    abortRef.current = controller;
    setJob({ phase: 'detecting', progress: 0.01, message: 'Starting local detection…' });

    try {
      const processor = kind === 'image'
        ? processImage
        : (await import('@/lib/processors/video')).processVideo;
      const processed = await processor(file, {
        signal: controller.signal,
        onProgress: ({ phase, progress, message }) => setJob({ phase, progress, message }),
      });
      if (!processed.detection.applied) {
        const unsafeRemoval = processed.detection.repairMode === 'unchanged-unsafe';
        setJob({
          phase: 'failed',
          progress: 0,
          message: unsafeRemoval
            ? processed.detection.qualityWarning ?? 'The original was kept because automatic removal could damage this area.'
            : 'No supported Gemini, Veo, or Flow mark was detected. The original was left unchanged.',
          errorCode: unsafeRemoval ? 'unsafe-removal' : 'no-watermark',
        });
        return;
      }
      const url = createObjectUrl(processed.blob);
      setResult({ ...processed, url });
      setComparison('after');
      setJob({
        phase: 'complete',
        progress: 1,
        message: processed.detection.repairMode?.startsWith('content-aware') || processed.detection.repairMode === 'bounded-texture'
          ? 'Your cleaned file is ready. A safe local content-aware repair was used.'
          : 'Your cleaned file is ready.',
      });
    } catch (error) {
      if (isAbortError(error)) {
        setJob({ phase: 'cancelled', progress: 0, message: 'Processing cancelled.', errorCode: 'cancelled' });
      } else {
        setJob({
          phase: 'failed',
          progress: 0,
          message: error instanceof Error ? error.message : 'Processing failed.',
          errorCode: error instanceof ProcessorError ? error.code : 'processing-failed',
        });
      }
    } finally {
      abortRef.current = null;
    }
  };

  const download = () => {
    if (!result) return;
    const link = document.createElement('a');
    link.href = result.url;
    link.download = result.fileName;
    link.click();
  };

  const isRunning = ['detecting', 'processing', 'encoding'].includes(job.phase);
  const shownUrl = result && comparison === 'after' ? result.url : previewUrl;

  return (
    <div
      className={`workspace ${dragging ? 'dragging' : ''} ${file ? 'has-file' : ''}`}
      onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(event) => { event.preventDefault(); setDragging(false); void acceptFile(event.dataTransfer.files[0]); }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,video/x-matroska,video/mpeg"
        onChange={(event) => void acceptFile(event.target.files?.[0])}
        hidden
      />

      {!file ? (
        <>
          <div className="image-orbs"><div className="file-card left"><span>✦</span><small>GEMINI</small></div><div className="connector"><span>→</span></div><div className="file-card right"><ImagePlus size={23} /><small>CLEAN</small></div></div>
          <h2>Drop a file here</h2><p>image or video — processed only on this device</p>
          <button className="upload-btn" onClick={() => inputRef.current?.click()}><Upload size={18} /> Choose file</button>
          <small className="formats">PNG, JPG, WEBP, MP4, MOV, WEBM, MKV, MPG or MPEG</small>
          {job.phase === 'failed' && <div className="inline-error" role="alert"><AlertTriangle size={16} />{job.message}</div>}
        </>
      ) : (
        <>
          <div className={`preview-shell ${kind === 'image' ? 'full-image-preview' : ''}`}>
            {kind === 'video'
              ? <video key={shownUrl} src={shownUrl ?? undefined} controls playsInline aria-label={`${comparison} video preview`} />
              : <img src={shownUrl ?? undefined} alt={`${comparison} image preview`} />}

            {result && (
              <div className="compare-toggle" aria-label="Compare result">
                <button className={comparison === 'before' ? 'active' : ''} onClick={() => setComparison('before')}>Before</button>
                <button className={comparison === 'after' ? 'active' : ''} onClick={() => setComparison('after')}>After</button>
              </div>
            )}
            {isRunning && (
              <div className="processing" role="status" aria-live="polite">
                <span /><b>{job.phase === 'encoding' ? 'Encoding locally…' : 'Cleaning locally…'}</b><small>{job.message}</small>
                <div className="progress-track"><i style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
                <em>{Math.round(job.progress * 100)}%</em>
                <button className="cancel-btn" onClick={() => abortRef.current?.abort()}><Square size={12} /> Cancel</button>
              </div>
            )}
            {job.phase === 'complete' && (
              <div className="done"><Check size={16} />
                {result?.detection.repairMode?.startsWith('content-aware') || result?.detection.repairMode === 'bounded-texture'
                  ? 'Visible mark repaired with content-aware fill'
                  : 'Visible mark repaired locally'}
              </div>
            )}
            <button className="remove-file" aria-label="Remove selected file" onClick={reset}><X size={17} /></button>
          </div>

          <div className="file-actions">
            <div className="file-meta"><b>{file.name}</b><small>{formatBytes(file.size)}{duration ? ` · ${duration.toFixed(1)} sec` : ''} · stays on your device</small></div>
            {result?.detection.size && <div className="detection-chip"><Sparkles size={13} /> {result.detection.size}px calibrated mark</div>}
            {job.phase === 'ready' && <button className="process-btn" onClick={() => void startProcessing()}>{kind === 'video' ? <Video size={17} /> : <Sparkles size={17} />} Remove visible mark</button>}
            {job.phase === 'complete' && <button className="process-btn" onClick={download}><Download size={17} /> Download {kind}</button>}
            {(job.phase === 'failed' || job.phase === 'cancelled') && <button className="process-btn secondary" onClick={() => void startProcessing(true)}><RefreshCw size={16} /> Try again</button>}
          </div>

          {showWarning && (
            <div className="limit-warning" role="alert">
              <AlertTriangle size={18} />
              <div><b>Large local video</b><p>This file exceeds 120 seconds or 500 MB. Processing may use significant memory and must keep this tab open.</p></div>
              <button onClick={() => void startProcessing(true)}>Process anyway</button>
            </div>
          )}
          {(job.phase === 'failed' || job.phase === 'cancelled') && <div className="inline-error" role="alert"><AlertTriangle size={16} /><span>{job.message}</span><button onClick={reset}><RotateCcw size={14} /> Start over</button></div>}
        </>
      )}
    </div>
  );
}
