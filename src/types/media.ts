import type { MetadataReport } from '@/lib/metadata/scan';

export type MediaKind = 'image' | 'video';

export type ProcessingPhase =
  | 'idle'
  | 'validating'
  | 'ready'
  | 'detecting'
  | 'processing'
  | 'encoding'
  | 'complete'
  | 'failed'
  | 'cancelled';

export type ProcessorErrorCode =
  | 'unsupported-format'
  | 'unsupported-codec'
  | 'no-watermark'
  | 'decode-failed'
  | 'encode-failed'
  | 'cancelled'
  | 'unsafe-removal'
  | 'processing-failed';

export type ImageRepairMode =
  | 'reverse-alpha'
  | 'bounded-texture'
  | 'content-aware-telea'
  | 'content-aware-migan'
  | 'unchanged-unsafe';
export type RepairSafetyOutcome = 'not-needed' | 'passed' | 'rejected';

export interface ProcessorProgress {
  phase: Extract<ProcessingPhase, 'detecting' | 'processing' | 'encoding'>;
  progress: number;
  message: string;
  processedFrames?: number;
  frameEstimate?: number | null;
}

export interface WatermarkDetection {
  applied: boolean;
  decisionTier: string | null;
  skipReason: string | null;
  size: number | null;
  position: { x: number; y: number; width: number; height: number } | null;
  repairMode?: ImageRepairMode | null;
  repairSafety?: RepairSafetyOutcome | null;
  qualityStatus?: string | null;
  qualityWarning?: string | null;
}

export interface MetadataOutcome {
  /** What the original file carried; container 'unknown' for HEIC, which is converted before cleaning. */
  before: MetadataReport | null;
  /** A re-scan of the file offered for download. */
  after: MetadataReport;
  /** True when the pixels were not re-encoded. */
  lossless: boolean;
}

export interface ProcessorResult {
  blob: Blob;
  mimeType: string;
  fileName: string;
  detection: WatermarkDetection;
  audioPreserved?: boolean;
  operation?: 'watermark' | 'metadata';
  metadata?: MetadataOutcome;
}

export interface ProcessingJob {
  phase: ProcessingPhase;
  progress: number;
  message: string;
  errorCode?: ProcessorErrorCode;
}

export interface ProcessorOptions {
  signal: AbortSignal;
  onProgress: (progress: ProcessorProgress) => void;
}
