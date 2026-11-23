import type { ReactNode } from 'react';
import { AlertTriangle, ShieldCheck } from 'lucide-react';
import { METADATA_LABELS, type MetadataReport } from '@/lib/metadata/scan';
import type { MetadataOutcome } from '@/types/media';

function Details({ report }: { report: MetadataReport }) {
  const { camera, software, generator, creatorTool, digitalSourceType } = report.details;
  const madeWith = generator ?? creatorTool ?? software;
  const lines = [
    camera && `Camera: ${camera}`,
    madeWith && `Made with: ${madeWith}`,
    digitalSourceType && /algorithmic|synthetic/i.test(digitalSourceType) && 'Labelled inside the file as AI-generated',
  ].filter(Boolean) as string[];
  if (!lines.length) return null;
  return <p>{lines.join('. ')}.</p>;
}

function Tags({ report }: { report: MetadataReport }) {
  return <ul className="meta-tags">{report.found.map((kind) => <li key={kind}>{METADATA_LABELS[kind]}</li>)}</ul>;
}

interface Props {
  /** The scan of the file as chosen, shown until it is processed. */
  before: MetadataReport | null;
  outcome?: MetadataOutcome;
  /** Shown under the list when the file has metadata to remove. */
  action?: ReactNode;
}

export function MetadataPanel({ before, outcome, action }: Props) {
  const source = outcome?.before ?? before;

  if (outcome) {
    const leftover = outcome.after.found;
    const heic = source?.container === 'unknown';
    const droppedTrailing = !!source?.found.includes('trailing-data');
    const pixels = outcome.lossless ? (droppedTrailing ? ', main image pixels unchanged' : ', pixels unchanged') : '';
    return (
      <section className="meta-panel" aria-label="File metadata">
        {heic
          ? <h3>Converted from HEIC, which left its metadata behind</h3>
          : source && source.found.length > 0
            ? <><h3>Removed from the file</h3><Tags report={source} /></>
            : <h3>{source ? 'No hidden metadata was in the file' : 'Metadata'}</h3>}
        {droppedTrailing && <p>The data after the image is gone too: on some phones that is a motion-photo clip or an HDR gain map.</p>}
        {leftover.length === 0 ? (
          <p className="meta-ok"><ShieldCheck size={14} aria-hidden="true" />
            {` Checked: no metadata left in the download${pixels}.`}
            {outcome.after.details.orientationOnly ? ' Only the rotation tag stays, so the photo shows upright.' : ''}
          </p>
        ) : (
          <p className="meta-warn"><AlertTriangle size={14} aria-hidden="true" /> Still in the download: {leftover.map((kind) => METADATA_LABELS[kind]).join(', ')}.</p>
        )}
      </section>
    );
  }

  if (!source) return null;
  if (source.container === 'unknown') {
    return <section className="meta-panel" aria-label="File metadata"><p>HEIC photos are converted to PNG on this device, which leaves their metadata behind.</p></section>;
  }
  return (
    <section className="meta-panel" aria-label="File metadata">
      {source.found.length > 0
        ? <><h3>Hidden data in this file</h3><Tags report={source} /><Details report={source} />{action}</>
        : <h3>No hidden metadata found in this file</h3>}
    </section>
  );
}
