'use client';
/* eslint-disable @next/next/no-img-element -- static demo images under public/, shown at their natural size */

import { useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * A real before and after: an openly licensed photo with the calibrated Gemini mark
 * added at Gemini's 1376 x 768 size, then cleaned by GemClean's own pipeline.
 * Without script the slider rests at the middle and both halves stay visible.
 */
export function BeforeAfter() {
  const [split, setSplit] = useState(62);
  return (
    <div className="compare" style={{ '--split': `${split}%` } as React.CSSProperties}>
      <div className="compare-frame">
        <img className="compare-img" src={`${BASE}/demo/timber-before.jpg`} width={1376} height={768} alt="A sunlit timber room with the Gemini sparkle mark in the bottom-right corner" />
        <img className="compare-img compare-after" src={`${BASE}/demo/timber-after.jpg`} width={1376} height={768} alt="The same room after GemClean, with the corner mark removed" />
        <span className="compare-line" aria-hidden="true" />
        <span className="compare-tag compare-tag-before">Before</span>
        <span className="compare-tag compare-tag-after">After</span>
      </div>
      <label className="compare-control">
        <span className="visually-hidden">Move the divider between before and after</span>
        <input type="range" min={0} max={100} value={split} onChange={(event) => setSplit(Number(event.target.value))} />
      </label>
      <div className="compare-crops">
        <figure>
          <div className="crop"><img src={`${BASE}/demo/timber-before.jpg`} width={1376} height={768} alt="The corner before, the sparkle mark visible, enlarged four times" /></div>
          <figcaption>Corner before, 4×</figcaption>
        </figure>
        <figure>
          <div className="crop"><img src={`${BASE}/demo/timber-after.jpg`} width={1376} height={768} alt="The corner after, the wood grain restored, enlarged four times" /></div>
          <figcaption>Corner after, 4×</figcaption>
        </figure>
      </div>
    </div>
  );
}
