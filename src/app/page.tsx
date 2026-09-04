import { ArrowRight, Check, LockKeyhole, Menu, ShieldCheck, Sparkles } from 'lucide-react';
import { WorkspaceHub } from '@/components/WorkspaceHub';

const steps = [
  ['01', 'Choose your file', 'Select an authorized Gemini image or a Gemini, Veo, or Flow video.'],
  ['02', 'Repair it locally', 'Calibrated templates restore the visible mark without uploading your media.'],
  ['03', 'Review and download', 'Compare the full-resolution result, then save it directly from your browser.'],
];

export default function Home() {
  return (
    <main>
      <nav className="nav wrap" aria-label="Main navigation">
        <a className="brand" href="#top" aria-label="GemClean home"><span className="brand-mark"><Sparkles size={17} /></span>GemClean</a>
        <div className="nav-links"><a href="#how">How it works</a><a href="#privacy">Privacy</a><a href="#faq">FAQ</a></div>
        <a className="nav-cta" href="#workspace">Try free <ArrowRight size={15} /></a>
        <button className="menu" aria-label="Open menu"><Menu size={20} /></button>
      </nav>

      <section className="hero wrap" id="top">
        <div className="eyebrow"><span /> Local-first · no account needed</div>
        <h1>Remove Gemini marks<br />from <em>images &amp; video.</em></h1>
        <p className="intro">A private browser workspace for repairing visible Gemini, Veo, and Google Flow corner marks with calibrated pixel restoration.</p>
        <WorkspaceHub />
        <div className="reassurance">
          <span><LockKeyhole size={15} /> No sign-up</span>
          <span><ShieldCheck size={16} /> Files never upload</span>
          <span><Check size={16} /> Original dimensions</span>
        </div>
        <p className="usage">Long or high-resolution videos depend on browser codec support and available device memory. Only process media you own or are authorized to edit.</p>
      </section>

      <section className="proof wrap" id="privacy">
        <div className="proof-copy">
          <div className="eyebrow"><span /> Calibrated, not guessed</div>
          <h2>A clean corner.<br />A <em>finished</em> frame.</h2>
          <p>GemClean detects known visible Google AI marks and reverses their alpha blend. It does not crop the frame, blur a rectangle, or send your file to an AI service.</p>
          <div className="privacy-note"><LockKeyhole size={18} /><div><b>Private by design</b><small>Your media stays in browser memory and disappears when you close or reset the page.</small></div></div>
        </div>
        <div className="before-after" aria-label="Illustration showing before and after visible watermark removal">
          <div className="scene"><div className="sun" /><div className="hill h1" /><div className="hill h2" /><div className="stem" /></div>
          <div className="before-label">BEFORE</div><div className="after-label">AFTER</div><div className="cut" /><div className="watermark">✦</div><div className="slider-knob">↔</div>
        </div>
      </section>

      <section className="how wrap" id="how">
        <div className="section-heading"><div><div className="eyebrow"><span /> Simple by default</div><h2>Three steps. <em>Zero</em> uploads.</h2></div><p>The processing engine is downloaded with the app and runs on your own device.</p></div>
        <div className="steps">{steps.map(([number, title, copy]) => <article className="step" key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div>
      </section>

      <section className="faq wrap" id="faq">
        <div><div className="eyebrow"><span /> Good to know</div><h2>Questions, answered.</h2></div>
        <div className="questions">
          <details open><summary>Does my file leave this device?<b>+</b></summary><p>No. Decoding, detection, restoration, and export all happen locally in your browser. There is no upload API.</p></details>
          <details><summary>Which formats can I use?<b>+</b></summary><p>Images: PNG, JPG, and WebP. Videos: MP4, MOV, WebM, MKV, MPG, and MPEG when your browser can decode them. Video exports as MP4/H.264.</p></details>
          <details><summary>Why was no mark detected?<b>+</b></summary><p>GemClean intentionally stops when it cannot confidently match a known Gemini, Veo, or Flow mark. This protects unrelated corner details from being changed.</p></details>
          <details><summary>Does this remove SynthID?<b>+</b></summary><p>No. It repairs only the visible corner mark and does not remove invisible SynthID or provenance metadata.</p></details>
        </div>
      </section>

      <footer className="wrap"><a className="brand" href="#top"><span className="brand-mark"><Sparkles size={17} /></span>GemClean</a><p>Made for respectful, authorized media editing.</p><span>© 2026 GemClean</span></footer>
    </main>
  );
}
