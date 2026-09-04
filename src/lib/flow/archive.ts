import {
  BlobReader,
  BlobWriter,
  TextWriter,
  ZipReader,
  ZipWriter,
} from '@zip.js/zip.js';
import type {
  FlowArchiveManifest,
  FlowAsset,
  FlowAssetKind,
  FlowImportSource,
  FlowProject,
  FlowZipResult,
} from '@/types/flow';

const MIME_BY_EXTENSION: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  mkv: 'video/x-matroska',
  mpg: 'video/mpeg',
  mpeg: 'video/mpeg',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
};

const MAX_ENTRY_BYTES = 512 * 1024 * 1024;
const METADATA_LIMIT_BYTES = 8 * 1024 * 1024;

interface ArchiveFile {
  path: string;
  size: number;
  mimeType: string;
  readText: () => Promise<string>;
  loadFile: () => Promise<File>;
}

interface MetadataIndex {
  projectNames: Map<string, string>;
  mediaProjects: Map<string, string>;
  pathProjects: Map<string, string>;
}

function extensionOf(path: string): string {
  return path.split('.').pop()?.toLowerCase() ?? '';
}

export function normalizeArchivePath(path: string): string | null {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)) return null;
  const parts = normalized.split('/').filter((part) => part && part !== '.');
  if (!parts.length || parts.some((part) => part === '..')) return null;
  return parts.join('/');
}

function baseName(path: string): string {
  return path.split('/').pop() ?? path;
}

function stem(path: string): string {
  return baseName(path).replace(/\.[^.]+$/, '');
}

function dirname(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/');
}

function classify(path: string): { kind: FlowAssetKind; mimeType: string; supported: boolean } {
  const mimeType = MIME_BY_EXTENSION[extensionOf(path)] ?? 'application/octet-stream';
  const kind: FlowAssetKind = mimeType.startsWith('image/')
    ? 'image'
    : mimeType.startsWith('video/')
      ? 'video'
      : mimeType.startsWith('audio/')
        ? 'audio'
        : 'other';
  return { kind, mimeType, supported: kind === 'image' };
}

function asObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(object: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = object[key];
    if (typeof value === 'string' || typeof value === 'number') return String(value);
  }
  return null;
}

function visitMetadata(value: unknown, index: MetadataIndex, inheritedProjectId: string | null = null): void {
  if (Array.isArray(value)) {
    value.forEach((item) => visitMetadata(item, index, inheritedProjectId));
    return;
  }
  const object = asObject(value);
  if (!object) return;

  const explicitProjectId = stringValue(object, ['project_id', 'projectId']);
  const genericId = stringValue(object, ['id']);
  const projectName = stringValue(object, ['project_name', 'projectName', 'title', 'name']);
  const looksLikeProject = Boolean(
    explicitProjectId ||
    object.media || object.media_ids || object.assets ||
    String(object.type ?? '').toLowerCase().includes('project')
  );
  const projectId = explicitProjectId ?? (looksLikeProject ? genericId : null) ?? inheritedProjectId;
  if (projectId && projectName) index.projectNames.set(projectId, projectName);

  const mediaId = stringValue(object, ['media_id', 'mediaId', 'asset_id', 'assetId']);
  if (mediaId && projectId) index.mediaProjects.set(mediaId, projectId);
  const filePath = stringValue(object, ['path', 'file_path', 'filePath', 'filename', 'file_name']);
  const safePath = filePath ? normalizeArchivePath(filePath) : null;
  if (safePath && projectId) {
    index.pathProjects.set(safePath.toLowerCase(), projectId);
    index.pathProjects.set(baseName(safePath).toLowerCase(), projectId);
  }

  for (const [key, child] of Object.entries(object)) {
    if (['project_id', 'projectId', 'project_name', 'projectName', 'title', 'name'].includes(key)) continue;
    if (Array.isArray(child) && projectId && ['media_ids', 'mediaIds'].includes(key)) {
      child.forEach((id) => {
        if (typeof id === 'string' || typeof id === 'number') index.mediaProjects.set(String(id), projectId);
      });
    }
    visitMetadata(child, index, projectId);
  }
}

async function buildMetadataIndex(files: ArchiveFile[], warnings: string[]): Promise<MetadataIndex> {
  const index: MetadataIndex = {
    projectNames: new Map(),
    mediaProjects: new Map(),
    pathProjects: new Map(),
  };
  const metadata = files.filter((file) => {
    const name = baseName(file.path).toLowerCase();
    return file.size <= METADATA_LIMIT_BYTES && (name === 'projects.json' || name.endsWith('_metadata.json'));
  });
  for (const file of metadata) {
    try {
      visitMetadata(JSON.parse(await file.readText()), index);
    } catch {
      warnings.push(`Ignored unreadable metadata: ${file.path}`);
    }
  }
  return index;
}

function projectForAsset(file: ArchiveFile, index: MetadataIndex): string {
  const assetStem = stem(file.path).replace(/_metadata$/i, '');
  const sameFolderMetadata = `${dirname(file.path)}/${assetStem}_metadata.json`.replace(/^\//, '').toLowerCase();
  return index.pathProjects.get(file.path.toLowerCase())
    ?? index.pathProjects.get(baseName(file.path).toLowerCase())
    ?? index.mediaProjects.get(assetStem)
    ?? index.pathProjects.get(sameFolderMetadata)
    ?? 'ungrouped';
}

export async function createFlowManifest(
  source: FlowImportSource,
  files: ArchiveFile[],
  dispose: () => Promise<void> = async () => undefined,
): Promise<FlowArchiveManifest> {
  const warnings: string[] = [];
  const metadataIndex = await buildMetadataIndex(files, warnings);
  const mediaFiles = files.filter((file) => classify(file.path).kind !== 'other');
  const duplicateIds = new Map<string, number>();
  const assets: FlowAsset[] = [];
  let skippedEntries = files.length - mediaFiles.length;

  for (const file of mediaFiles) {
    const info = classify(file.path);
    if (file.size > MAX_ENTRY_BYTES) {
      skippedEntries += 1;
      warnings.push(`Skipped oversized entry: ${file.path}`);
      continue;
    }
    const mediaId = stem(file.path);
    const projectId = projectForAsset(file, metadataIndex);
    const projectName = projectId === 'ungrouped'
      ? 'Ungrouped media'
      : metadataIndex.projectNames.get(projectId) ?? `Project ${projectId}`;
    const baseId = mediaId || file.path;
    const duplicate = duplicateIds.get(baseId) ?? 0;
    duplicateIds.set(baseId, duplicate + 1);
    const id = duplicate ? `${baseId}#${duplicate + 1}` : baseId;
    const projectFolder = projectName.replace(/[<>:"|?*\u0000-\u001f]/g, '_').trim() || 'Ungrouped media';
    assets.push({
      id,
      mediaId: mediaId || null,
      projectId,
      projectName,
      name: baseName(file.path),
      sourcePath: file.path,
      outputPath: `${projectFolder}/${file.path}`,
      mimeType: info.mimeType,
      size: file.size,
      kind: info.kind,
      supported: info.supported,
      loadFile: file.loadFile,
    });
  }

  const projectsById = new Map<string, FlowProject>();
  for (const asset of assets) {
    const project = projectsById.get(asset.projectId) ?? {
      id: asset.projectId,
      name: asset.projectName,
      assetIds: [],
    };
    project.assetIds.push(asset.id);
    projectsById.set(project.id, project);
  }

  return {
    source,
    projects: [...projectsById.values()].sort((a, b) => a.name.localeCompare(b.name)),
    assets,
    skippedEntries,
    warnings,
    dispose,
  };
}

function makeFile(blob: Blob, path: string, mimeType: string): File {
  return new File([blob], baseName(path), { type: mimeType, lastModified: Date.now() });
}

export async function importFlowZip(file: File, source?: FlowImportSource): Promise<FlowArchiveManifest> {
  const reader = new ZipReader(new BlobReader(file), {
    checkOverlappingEntry: true,
    checkCrc32: true,
    filenameValidation: 'strict',
  });
  try {
    const entries = await reader.getEntries();
    const archiveFiles: ArchiveFile[] = [];
    for (const entry of entries) {
      if (entry.directory) continue;
      const path = normalizeArchivePath(entry.filename);
      if (!path || !('getData' in entry)) throw new Error(`Unsafe archive path: ${entry.filename}`);
      const info = classify(path);
      let cached: Promise<File> | null = null;
      archiveFiles.push({
        path,
        size: entry.uncompressedSize,
        mimeType: info.mimeType,
        readText: () => entry.getData(new TextWriter()),
        loadFile: () => {
          cached ??= entry.getData(new BlobWriter(info.mimeType)).then((blob) => makeFile(blob, path, info.mimeType));
          return cached;
        },
      });
    }
    return await createFlowManifest(
      source ?? { kind: 'local-zip', label: file.name },
      archiveFiles,
      () => reader.close(),
    );
  } catch (error) {
    await reader.close().catch(() => undefined);
    throw error;
  }
}

export async function importFlowFolder(files: File[]): Promise<FlowArchiveManifest> {
  const archiveFiles: ArchiveFile[] = [];
  for (const file of files) {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const path = normalizeArchivePath(relativePath);
    if (!path) throw new Error(`Unsafe folder path: ${relativePath}`);
    const info = classify(path);
    archiveFiles.push({
      path,
      size: file.size,
      mimeType: info.mimeType,
      readText: () => file.text(),
      loadFile: async () => file.type === info.mimeType
        ? file
        : makeFile(file, path, info.mimeType),
    });
  }
  return createFlowManifest({ kind: 'local-folder', label: 'Selected Flow folder' }, archiveFiles);
}

export async function createResultsZip(results: FlowZipResult[]): Promise<Blob> {
  const writer = new ZipWriter(new BlobWriter('application/zip'));
  const used = new Set<string>();
  for (const { asset, blob } of results) {
    let path = normalizeArchivePath(asset.outputPath) ?? asset.name;
    if (used.has(path.toLowerCase())) {
      const extension = extensionOf(path);
      const suffix = extension ? `.${extension}` : '';
      path = `${path.slice(0, Math.max(0, path.length - suffix.length))}-${asset.id.replace(/[^a-z0-9_-]/gi, '_')}${suffix}`;
    }
    used.add(path.toLowerCase());
    await writer.add(path, new BlobReader(blob));
  }
  return writer.close();
}

export type { ArchiveFile };
