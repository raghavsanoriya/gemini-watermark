'use client';

import { useState } from 'react';
import { FileArchive, Image as ImageIcon } from 'lucide-react';
import { FlowProjectWorkspace } from '@/components/FlowProjectWorkspace';
import { MediaWorkspace } from '@/components/MediaWorkspace';

export function WorkspaceHub() {
  const [mode, setMode] = useState<'single' | 'flow'>('single');
  return <div className="workspace-hub" id="workspace">
    <div className="workspace-tabs" role="tablist" aria-label="Import mode">
      <button role="tab" aria-selected={mode === 'single'} className={mode === 'single' ? 'active' : ''} onClick={() => setMode('single')}><ImageIcon size={16} /> Single file</button>
      <button role="tab" aria-selected={mode === 'flow'} className={mode === 'flow' ? 'active' : ''} onClick={() => setMode('flow')}><FileArchive size={16} /> Import Flow project</button>
    </div>
    {mode === 'single' ? <MediaWorkspace /> : <FlowProjectWorkspace />}
  </div>;
}
