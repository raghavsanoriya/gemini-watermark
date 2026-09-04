import { BlobReader, BlobWriter, TextReader, ZipWriter } from '@zip.js/zip.js';
import { describe, expect, it } from 'vitest';
import { createFlowManifest, createResultsZip, importFlowZip, normalizeArchivePath, type ArchiveFile } from './archive';

function archiveFile(path: string, content = 'data', type = 'application/octet-stream'): ArchiveFile {
  const file = new File([content], path.split('/').pop()!, { type });
  return {
    path,
    size: file.size,
    mimeType: type,
    readText: () => file.text(),
    loadFile: async () => file,
  };
}

describe('Flow archive parsing', () => {
  it('rejects unsafe archive paths', () => {
    expect(normalizeArchivePath('../secret.png')).toBeNull();
    expect(normalizeArchivePath('C:\\secret.png')).toBeNull();
    expect(normalizeArchivePath('/absolute/image.png')).toBeNull();
    expect(normalizeArchivePath('Takeout/Flow/media/image.png')).toBe('Takeout/Flow/media/image.png');
  });

  it('groups current metadata and keeps unsupported media visible', async () => {
    const files = [
      archiveFile('Takeout/Flow/projects.json', JSON.stringify({ projects: [{ id: 'p-1', name: 'Launch', media_ids: ['m-1', 'clip-1'] }] })),
      archiveFile('Takeout/Flow/media/m-1.png', 'png', 'image/png'),
      archiveFile('Takeout/Flow/media/clip-1.mp4', 'mp4', 'video/mp4'),
    ];
    const manifest = await createFlowManifest({ kind: 'local-folder', label: 'folder' }, files);
    expect(manifest.projects).toEqual([{ id: 'p-1', name: 'Launch', assetIds: ['m-1', 'clip-1'] }]);
    expect(manifest.assets[0]).toMatchObject({ projectName: 'Launch', supported: true, outputPath: 'Launch/Takeout/Flow/media/m-1.png' });
    expect(manifest.assets[1]).toMatchObject({ kind: 'video', supported: false });
  });

  it('falls back to ungrouped media and makes duplicate IDs unique', async () => {
    const manifest = await createFlowManifest({ kind: 'local-folder', label: 'folder' }, [
      archiveFile('one/same.webp', 'one', 'image/webp'),
      archiveFile('two/same.webp', 'two', 'image/webp'),
    ]);
    expect(manifest.projects[0].name).toBe('Ungrouped media');
    expect(manifest.assets.map((asset) => asset.id)).toEqual(['same', 'same#2']);
  });

  it('discovers nested ZIP entries lazily', async () => {
    const blobWriter = new BlobWriter('application/zip');
    const writer = new ZipWriter(blobWriter);
    await writer.add('projects.json', new TextReader(JSON.stringify({ projects: [{ id: 'p', title: 'Nested', media_ids: ['asset'] }] })));
    await writer.add('deep/media/asset.jpg', new TextReader('image-bytes'));
    const zip = await writer.close();
    const manifest = await importFlowZip(new File([zip], 'flow.zip', { type: 'application/zip' }));
    expect(manifest.assets[0]).toMatchObject({ name: 'asset.jpg', projectId: 'p', mimeType: 'image/jpeg' });
    expect((await manifest.assets[0].loadFile()).name).toBe('asset.jpg');
    await manifest.dispose();
  });

  it('writes result ZIPs with project organization', async () => {
    const manifest = await createFlowManifest({ kind: 'local-folder', label: 'folder' }, [archiveFile('media/a.png', 'source', 'image/png')]);
    const resultZip = await createResultsZip([{ asset: manifest.assets[0], blob: new Blob(['clean'], { type: 'image/png' }) }]);
    const { ZipReader, TextWriter } = await import('@zip.js/zip.js');
    const reader = new ZipReader(new BlobReader(resultZip));
    const entries = await reader.getEntries();
    expect(entries[0].filename).toBe('Ungrouped media/media/a.png');
    if (!entries[0].directory) expect(await entries[0].getData(new TextWriter())).toBe('clean');
    await reader.close();
  });
});
