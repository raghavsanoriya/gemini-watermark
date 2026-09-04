import type { ProcessorResult } from '@/types/media';

export type FlowImportSource =
  | { kind: 'local-zip'; label: string }
  | { kind: 'local-folder'; label: string }
  | { kind: 'google-drive'; label: string; fileId: string };

export type FlowAssetKind = 'image' | 'video' | 'audio' | 'other';

export type FlowBatchState =
  | 'queued'
  | 'processing'
  | 'complete'
  | 'clean'
  | 'failed'
  | 'cancelled';

export interface FlowAsset {
  id: string;
  mediaId: string | null;
  projectId: string;
  projectName: string;
  name: string;
  sourcePath: string;
  outputPath: string;
  mimeType: string;
  size: number;
  kind: FlowAssetKind;
  supported: boolean;
  loadFile: () => Promise<File>;
}

export interface FlowProject {
  id: string;
  name: string;
  assetIds: string[];
}

export interface FlowArchiveManifest {
  source: FlowImportSource;
  projects: FlowProject[];
  assets: FlowAsset[];
  skippedEntries: number;
  warnings: string[];
  dispose: () => Promise<void>;
}

export interface FlowAssetBatchItem {
  state: FlowBatchState;
  progress: number;
  message: string;
  result?: ProcessorResult;
}

export interface FlowZipResult {
  asset: FlowAsset;
  blob: Blob;
}
