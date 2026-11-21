'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { FileArchive, Image as ImageIcon, Images } from 'lucide-react';
// The batch and Flow views load only when their tab opens, keeping the first screen light.
const FlowProjectWorkspace = dynamic(() => import('@/components/FlowProjectWorkspace').then((m) => m.FlowProjectWorkspace));
import { MediaWorkspace } from '@/components/MediaWorkspace';

type Mode = 'single' | 'batch' | 'flow';

export function WorkspaceHub() {
  const [mode, setMode] = useState<Mode>('single');
  const tab = (value: Mode, label: string, icon: React.ReactNode) => (
    <button role="tab" aria-selected={mode === value} className={mode === value ? 'active' : ''} onClick={() => setMode(value)}>{icon} {label}</button>
  );
  return <div className="workspace-hub" id="workspace">
    <div className="workspace-tabs" role="tablist" aria-label="Import mode">
      {tab('single', 'Single file', <ImageIcon size={16} />)}
      {tab('batch', 'Batch images', <Images size={16} />)}
      {tab('flow', 'Import Flow project', <FileArchive size={16} />)}
    </div>
    {mode === 'single' && <MediaWorkspace />}
    {mode === 'batch' && <FlowProjectWorkspace key="batch" variant="images" />}
    {mode === 'flow' && <FlowProjectWorkspace key="flow" />}
  </div>;
}
