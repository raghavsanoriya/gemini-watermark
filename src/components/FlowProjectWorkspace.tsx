'use client';
/* eslint-disable @next/next/no-img-element -- previews are local object URLs */

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  Download,
  FileArchive,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Square,
  Video,
  X,
} from 'lucide-react';
import { formatBytes } from '@/lib/media';
import { processImage } from '@/lib/processors/image';
import type { FlowArchiveManifest, FlowAsset, FlowAssetBatchItem } from '@/types/flow';

type BatchMap = Record<string, FlowAssetBatchItem>;

const DRIVE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID
  && process.env.NEXT_PUBLIC_GOOGLE_API_KEY
  && process.env.NEXT_PUBLIC_GOOGLE_APP_ID
);

function AssetImage({ asset, blob, alt }: { asset: FlowAsset; blob?: Blob; alt: string }) {
  const [url, setUrl] = useState<string>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    let objectUrl: string | undefined;
    void (async () => {
      try {
        const source = blob ?? await asset.loadFile();
        objectUrl = URL.createObjectURL(source);
        if (active) setUrl(objectUrl);
        else URL.revokeObjectURL(objectUrl);
      } catch {
        if (active) setFailed(true);
      }
    })();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset, blob]);
  if (failed) return <div className="flow-thumb-fallback"><ImageIcon size={24} /> Preview unavailable</div>;
  if (!url) return <div className="flow-thumb-fallback"><LoaderCircle className="spin" size={22} /> Loading preview</div>;
  return <img src={url} alt={alt} />;
}

function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

export function FlowProjectWorkspace() {
  const zipInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const manifestRef = useRef<FlowArchiveManifest | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [manifest, setManifest] = useState<FlowArchiveManifest | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [projectFilter, setProjectFilter] = useState('all');
  const [batch, setBatch] = useState<BatchMap>({});
  const [busy, setBusy] = useState(false);
  const [importing, setImporting] = useState(false);
  const [overallProgress, setOverallProgress] = useState(0);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [previewAsset, setPreviewAsset] = useState<FlowAsset | null>(null);
  const [previewSide, setPreviewSide] = useState<'before' | 'after'>('after');

  useEffect(() => () => {
    abortRef.current?.abort();
    void manifestRef.current?.dispose();
  }, []);

  const replaceManifest = async (next: FlowArchiveManifest) => {
    abortRef.current?.abort();
    await manifestRef.current?.dispose();
    manifestRef.current = next;
    setManifest(next);
    setSelected(new Set(next.assets.filter((asset) => asset.supported).map((asset) => asset.id)));
    setBatch(Object.fromEntries(next.assets.filter((asset) => asset.supported).map((asset) => [asset.id, {
      state: 'queued', progress: 0, message: 'Ready',
    } satisfies FlowAssetBatchItem])));
    setProjectFilter('all');
    setOverallProgress(0);
    setError('');
    setMessage(`${next.assets.length} media items found. Review the selection before cleaning.`);
  };

  const reset = async () => {
    abortRef.current?.abort();
    await manifestRef.current?.dispose();
    manifestRef.current = null;
    setManifest(null);
    setSelected(new Set());
    setBatch({});
    setBusy(false);
    setPreviewAsset(null);
    setError('');
    setMessage('');
    if (zipInputRef.current) zipInputRef.current.value = '';
    if (folderInputRef.current) folderInputRef.current.value = '';
  };

  const importZip = async (file?: File) => {
    if (!file) return;
    setImporting(true);
    setError('');
    try {
      if (!file.name.toLowerCase().endsWith('.zip')) throw new Error('Choose a .zip archive exported from Flow or Google Takeout.');
      const { importFlowZip } = await import('@/lib/flow/archive');
      await replaceManifest(await importFlowZip(file));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The archive could not be imported.');
    } finally {
      setImporting(false);
    }
  };

  const importFolder = async (files: File[]) => {
    if (!files.length) return;
    setImporting(true);
    setError('');
    try {
      const { importFlowFolder } = await import('@/lib/flow/archive');
      await replaceManifest(await importFlowFolder(files));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The folder could not be imported.');
    } finally {
      setImporting(false);
    }
  };

  const importDrive = async () => {
    setImporting(true);
    setError('');
    try {
      const [{ selectFlowZipFromDrive }, { importFlowZip }] = await Promise.all([
        import('@/lib/flow/google-drive'),
        import('@/lib/flow/archive'),
      ]);
      const selection = await selectFlowZipFromDrive();
      await replaceManifest(await importFlowZip(selection.file, {
        kind: 'google-drive', label: selection.file.name, fileId: selection.fileId,
      }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Google Drive import failed.');
    } finally {
      setImporting(false);
    }
  };

  const visibleAssets = useMemo(() => manifest?.assets.filter((asset) => (
    projectFilter === 'all' || asset.projectId === projectFilter
  )) ?? [], [manifest, projectFilter]);
  const visibleSupported = visibleAssets.filter((asset) => asset.supported);
  const visibleSelected = visibleSupported.filter((asset) => selected.has(asset.id)).length;

  const toggleAllVisible = () => {
    setSelected((current) => {
      const next = new Set(current);
      const shouldSelect = visibleSelected !== visibleSupported.length;
      visibleSupported.forEach((asset) => shouldSelect ? next.add(asset.id) : next.delete(asset.id));
      return next;
    });
  };

  const updateBatch = (id: string, update: Partial<FlowAssetBatchItem>) => {
    setBatch((current) => ({ ...current, [id]: { ...current[id], ...update } }));
  };

  const processAssets = async (assets: FlowAsset[]) => {
    if (!assets.length) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError('');
    setOverallProgress(0);
    setMessage(`Cleaning ${assets.length} selected image${assets.length === 1 ? '' : 's'} sequentially…`);
    const { runSequentialImageBatch } = await import('@/lib/flow/batch');
    await runSequentialImageBatch(assets, controller.signal, processImage, {
      onStart: (asset, index, total) => {
        updateBatch(asset.id, { state: 'processing', progress: 0, message: `Image ${index + 1} of ${total}` });
      },
      onProgress: (asset, progress, itemMessage, index, total) => {
        updateBatch(asset.id, { state: 'processing', progress, message: itemMessage });
        setOverallProgress((index + progress) / total);
      },
      onComplete: (asset, result, index, total) => {
        updateBatch(asset.id, {
          state: result.detection.applied ? 'complete' : 'clean',
          progress: 1,
          message: result.detection.applied ? 'Visible mark repaired' : 'No supported mark found; original kept',
          result,
        });
        setOverallProgress((index + 1) / total);
      },
      onError: (asset, cause, index, total) => {
        updateBatch(asset.id, { state: 'failed', progress: 0, message: cause instanceof Error ? cause.message : 'Processing failed' });
        setOverallProgress((index + 1) / total);
      },
      onCancelled: (asset) => updateBatch(asset.id, { state: 'cancelled', progress: 0, message: 'Cancelled' }),
    });
    abortRef.current = null;
    setBusy(false);
    setMessage(controller.signal.aborted ? 'Batch cancelled. Finished results are still available.' : 'Batch finished. Review or download the results.');
  };

  const startSelected = () => {
    if (!manifest) return;
    const assets = manifest.assets.filter((asset) => asset.supported && selected.has(asset.id));
    assets.forEach((asset) => updateBatch(asset.id, { state: 'queued', progress: 0, message: 'Queued', result: undefined }));
    void processAssets(assets);
  };

  const retryUnfinished = () => {
    if (!manifest) return;
    const assets = manifest.assets.filter((asset) => ['failed', 'cancelled'].includes(batch[asset.id]?.state));
    void processAssets(assets);
  };

  const downloadOne = async (asset: FlowAsset) => {
    const item = batch[asset.id];
    const blob = item?.result?.blob ?? await asset.loadFile();
    downloadBlob(blob, item?.result?.fileName ?? asset.name);
  };

  const downloadZip = async () => {
    if (!manifest) return;
    setMessage('Building result ZIP locally…');
    try {
      const completed = manifest.assets.filter((asset) => ['complete', 'clean'].includes(batch[asset.id]?.state));
      const results = await Promise.all(completed.map(async (asset) => ({
        asset,
        blob: batch[asset.id]?.result?.blob ?? await asset.loadFile(),
      })));
      const { createResultsZip } = await import('@/lib/flow/archive');
      downloadBlob(await createResultsZip(results), 'gemclean-flow-results.zip');
      setMessage(`Downloaded ${results.length} result${results.length === 1 ? '' : 's'} with project folders preserved.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The result ZIP could not be created.');
    }
  };

  const completeCount = Object.values(batch).filter((item) => ['complete', 'clean'].includes(item.state)).length;
  const retryCount = Object.values(batch).filter((item) => ['failed', 'cancelled'].includes(item.state)).length;
  const previewResult = previewAsset ? batch[previewAsset.id]?.result : undefined;

  if (!manifest) {
    return (
      <div className="workspace flow-import-workspace">
        <div className="flow-import-icon"><FileArchive size={34} /></div>
        <h2>Import a Flow export</h2>
        <p>Open an exported Flow project or Google Takeout archive. Nothing is uploaded to GemClean.</p>
        <input ref={zipInputRef} type="file" accept=".zip,application/zip" hidden onChange={(event) => void importZip(event.target.files?.[0])} />
        <input ref={folderInputRef} type="file" hidden {...{ webkitdirectory: '', directory: '' }} onChange={(event) => void importFolder(Array.from(event.target.files ?? []))} />
        <div className="flow-import-actions">
          <button onClick={() => zipInputRef.current?.click()} disabled={importing}><FileArchive size={18} /> Choose ZIP</button>
          <button onClick={() => folderInputRef.current?.click()} disabled={importing}><FolderOpen size={18} /> Choose folder</button>
          <button onClick={() => void importDrive()} disabled={importing || !DRIVE_CONFIGURED} title={!DRIVE_CONFIGURED ? 'Add the three NEXT_PUBLIC_GOOGLE_* environment variables to enable Drive.' : undefined}><HardDrive size={18} /> Google Drive</button>
        </div>
        {importing && <div className="flow-importing" role="status"><LoaderCircle className="spin" size={18} /> Reading export locally…</div>}
        {!DRIVE_CONFIGURED && <small className="drive-config-note">Drive import is optional and currently disabled. Add the documented Google credentials; ZIP and folder import always work.</small>}
        <div className="flow-privacy"><ShieldCheck size={16} /><span>Drive selects only an exported ZIP. It does not access live Flow projects, and its access token stays in memory.</span></div>
        {error && <div className="inline-error" role="alert"><AlertTriangle size={16} />{error}</div>}
      </div>
    );
  }

  return (
    <div className="workspace flow-gallery-workspace">
      <div className="flow-gallery-header">
        <div><span className="flow-source"><FileArchive size={15} /> {manifest.source.label}</span><h2>Review imported media</h2><p>{manifest.projects.length} project{manifest.projects.length === 1 ? '' : 's'} · {manifest.assets.length} media items · processed locally</p></div>
        <button className="flow-close" onClick={() => void reset()} aria-label="Close imported project"><X size={18} /></button>
      </div>

      <div className="flow-toolbar">
        <label>Project<select value={projectFilter} onChange={(event) => setProjectFilter(event.target.value)}><option value="all">All projects</option>{manifest.projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select></label>
        <button className="flow-select-all" onClick={toggleAllVisible}>{visibleSelected === visibleSupported.length && visibleSupported.length ? 'Clear visible' : 'Select visible'} <span>{visibleSelected}/{visibleSupported.length}</span></button>
      </div>

      {(manifest.warnings.length > 0 || manifest.skippedEntries > 0) && <div className="flow-warning"><AlertTriangle size={15} /><span>{manifest.skippedEntries} non-media/oversized entries skipped.{manifest.warnings[0] ? ` ${manifest.warnings[0]}` : ''}</span></div>}

      <div className="flow-grid">
        {visibleAssets.map((asset) => {
          const item = batch[asset.id];
          const chosen = selected.has(asset.id);
          return <article className={`flow-asset ${chosen ? 'selected' : ''}`} key={asset.id}>
            <button className="flow-thumb" onClick={() => { if (asset.supported) { setPreviewSide(item?.result ? 'after' : 'before'); setPreviewAsset(asset); } }} disabled={!asset.supported} aria-label={`Preview ${asset.name}`}>
              {asset.kind === 'image' ? <AssetImage asset={asset} blob={item?.result?.blob} alt="" /> : <div className="flow-thumb-fallback"><Video size={27} /> {asset.kind} asset</div>}
              {item?.state === 'processing' && <span className="flow-card-progress" style={{ '--progress': `${Math.round(item.progress * 100)}%` } as React.CSSProperties}>{Math.round(item.progress * 100)}%</span>}
            </button>
            <div className="flow-card-copy"><label><input type="checkbox" checked={chosen} disabled={!asset.supported || busy} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(asset.id)) next.delete(asset.id); else next.add(asset.id); return next; })} /><span><b>{asset.name}</b><small>{asset.projectName} · {formatBytes(asset.size)}</small></span></label>
              {!asset.supported && <span className="flow-status unsupported">Visible only · not processed</span>}
              {item && item.state !== 'queued' && <span className={`flow-status ${item.state}`}>{item.state === 'complete' ? <Check size={12} /> : item.state === 'failed' ? <AlertTriangle size={12} /> : null}{item.message}</span>}
              {['complete', 'clean'].includes(item?.state) && <button className="flow-download-one" onClick={() => void downloadOne(asset)}><Download size={13} /> Download</button>}
            </div>
          </article>;
        })}
      </div>

      <div className="flow-batch-bar">
        <div><b>{message}</b>{busy && <div className="flow-overall"><i style={{ width: `${Math.round(overallProgress * 100)}%` }} /></div>}</div>
        {busy ? <button className="flow-cancel" onClick={() => abortRef.current?.abort()}><Square size={13} /> Cancel</button> : <>
          {retryCount > 0 && <button className="flow-secondary" onClick={retryUnfinished}><RefreshCw size={14} /> Retry {retryCount}</button>}
          {completeCount > 0 && <button className="flow-secondary" onClick={() => void downloadZip()}><Download size={15} /> Results ZIP ({completeCount})</button>}
          <button className="process-btn" disabled={selected.size === 0} onClick={startSelected}>Clean {selected.size} selected</button>
        </>}
      </div>
      {error && <div className="inline-error" role="alert"><AlertTriangle size={16} />{error}</div>}

      {previewAsset && <div className="flow-preview-modal" role="dialog" aria-modal="true" aria-label={`Preview ${previewAsset.name}`}>
        <div className="flow-preview-panel">
          <div className="flow-preview-top"><div><b>{previewAsset.name}</b><small>Full image · no crop</small></div><button onClick={() => setPreviewAsset(null)} aria-label="Close preview"><X size={19} /></button></div>
          <div className="flow-full-preview"><AssetImage asset={previewAsset} blob={previewSide === 'after' ? previewResult?.blob : undefined} alt={`${previewSide} preview of ${previewAsset.name}`} /></div>
          <div className="flow-preview-actions">
            <div className="compare-toggle static"><button className={previewSide === 'before' ? 'active' : ''} onClick={() => setPreviewSide('before')}>Before</button><button className={previewSide === 'after' ? 'active' : ''} disabled={!previewResult} onClick={() => setPreviewSide('after')}>After</button></div>
            {previewResult && <button className="flow-secondary" onClick={() => void downloadOne(previewAsset)}><Download size={15} /> Download</button>}
          </div>
        </div>
      </div>}
    </div>
  );
}
