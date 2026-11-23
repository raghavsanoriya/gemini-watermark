import { ArrowRight, Check, LockKeyhole, Menu, ShieldCheck, Sparkles } from 'lucide-react';
import { BeforeAfter } from '@/components/BeforeAfter';
import { WorkspaceHub } from '@/components/WorkspaceHub';

// Server builds add optional uploads; the GitHub Pages build is local-only.
const SERVER_MODE = process.env.NEXT_PUBLIC_SERVER_MODE === '1';

const modes = [
  {
    id: 'single',
    name: 'Single file',
    gives: 'One image or video.',
    detail: 'Compare before and after at full size, then save it. Same dimensions, same format; video comes back as MP4.',
    input: 'photo.png',
    output: 'gemclean-photo.png',
  },
  {
    id: 'batch',
    name: 'Batch images',
    gives: 'Many images at once.',
    detail: 'Drop a set and they are cleaned one by one on this device. Download them together as one ZIP, names kept.',
    input: '24 images',
    output: 'gemclean-results.zip',
  },
  {
    id: 'flow',
    name: 'Flow project',
    gives: 'A Flow export or Takeout ZIP.',
    detail: 'Open the ZIP or its folder, pick images by project, and get a ZIP back with project folders preserved.',
    input: 'flow-export.zip',
    output: 'gemclean-flow-results.zip',
  },
  ...(SERVER_MODE ? [{
    id: 'server',
    name: 'Upload to server',
    gives: 'One image, up to 4 MB.',
    detail: 'Sent to the GemClean server, cleaned in memory and returned in the same response. Nothing is stored.',
    input: 'photo.jpg',
    output: 'gemclean-photo.png',
  }] : []),
];

export default function Home() {
  return (
    <main>
      <p className="banner">Free and private. Only process media you own or are authorized to edit.</p>

      <header className="bar">
        <nav className="container bar-inner" aria-label="Main navigation">
          <a className="brand" href="#top" aria-label="GemClean home"><span className="brand-mark"><Sparkles size={16} aria-hidden="true" /></span>GemClean</a>
          <div className="nav-links"><a href="#how">How it works</a><a href="#privacy">Privacy</a><a href="#faq">Questions</a></div>
          <details className="nav-menu">
            <summary aria-label="Open menu"><Menu size={20} aria-hidden="true" /></summary>
            <div className="nav-menu-links"><a href="#how">How it works</a><a href="#privacy">Privacy</a><a href="#faq">Questions</a></div>
          </details>
          <a className="pill pill-cta" href="#workspace">Clean a file <ArrowRight size={15} aria-hidden="true" /></a>
        </nav>
      </header>

      <section className="hero" id="top">
        <div className="container hero-grid">
          <div className="hero-copy">
            <h1>Remove the mark. Keep the picture.</h1>
            <p className="lead">Clean the visible Gemini, Veo and Flow corner mark and the hidden metadata, with one button, in your browser.</p>
            <ul className="facts">
              <li><LockKeyhole size={16} aria-hidden="true" /> No sign-up</li>
              <li><ShieldCheck size={16} aria-hidden="true" /> {SERVER_MODE ? 'Free mode never uploads' : 'Files never upload'}</li>
              <li><Check size={16} aria-hidden="true" /> Original dimensions</li>
            </ul>
            <a className="text-link" href="#demo">See a before and after</a>
          </div>
          <div className="hero-stage">
            <div className="ruler" aria-hidden="true" />
            <WorkspaceHub />
          </div>
        </div>
      </section>

      <section className="demo" id="demo">
        <div className="container">
          <div className="head-split">
            <h2>Only the mark changes.</h2>
            <p className="lead">GemClean detects known visible Google AI marks and reverses their alpha blend. It does not crop the frame, blur a rectangle, or send your file to an AI service.</p>
          </div>
          <BeforeAfter />
          <p className="note">An openly licensed photo with the Gemini mark added at Gemini’s 1376 by 768 size, then cleaned by GemClean in this browser’s engine.</p>
        </div>
      </section>

      <section className="modes" id="how">
        <div className="container">
          <h2>One file or a whole project.</h2>
          <div className="switcher">
            <div className="switch-tabs" role="radiogroup" aria-label="Ways to use GemClean">
              {modes.map((mode, index) => (
                <label key={mode.id} className="switch-tab">
                  <input type="radio" name="mode" value={mode.id} defaultChecked={index === 0} />
                  <span>{mode.name}</span>
                </label>
              ))}
            </div>
            <div className="switch-panels">
              {modes.map((mode) => (
                <article key={mode.id} className={`switch-panel switch-${mode.id}`}>
                  <div className="switch-copy">
                    <h3>{mode.gives}</h3>
                    <p>{mode.detail}</p>
                    <a className="text-link" href="#workspace">Open {mode.name.toLowerCase()}</a>
                  </div>
                  <div className="lanes" aria-hidden="true">
                    <div className="lane"><span className="lane-name">In</span><span className="clip clip-in"><span>{mode.input}</span></span></div>
                    <div className="lane"><span className="lane-name">Cleaned</span><span className="clip clip-work"><i /></span></div>
                    <div className="lane"><span className="lane-name">Out</span><span className="clip clip-out"><span>{mode.output}</span></span></div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="spec-section" id="formats">
        <div className="container">
          <h2>What it takes, what it gives.</h2>
          <table className="spec">
            <caption className="visually-hidden">Supported formats and limits</caption>
            <thead><tr><th scope="col">Media</th><th scope="col">Takes</th><th scope="col">Gives</th></tr></thead>
            <tbody>
              <tr><th scope="row">Images</th><td>PNG, JPG, WebP and HEIC</td><td>The same size and format; HEIC comes back as PNG</td></tr>
              <tr><th scope="row">Video</th><td>MP4, MOV, WebM, MKV, MPG and MPEG, when your browser can decode them</td><td>MP4 with H.264</td></tr>
              <tr><th scope="row">Long video</th><td>Over 120 seconds or 500 MB asks before it starts</td><td>Depends on browser codec support and device memory</td></tr>
              {SERVER_MODE && <tr><th scope="row">Server mode</th><td>One image up to 4 MB, 20 every 10 minutes</td><td>A PNG in the same response, nothing stored</td></tr>}
              <tr><th scope="row">Metadata</th><td>EXIF, GPS, XMP, IPTC, C2PA Content Credentials and AI prompts</td><td>Removed together with the mark, and the download is re-checked</td></tr>
              <tr><th scope="row">Left alone</th><td>Invisible SynthID, which is woven into the pixels</td><td>Untouched: it is not file metadata and cannot be stripped</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section className="privacy" id="privacy">
        <div className="container privacy-grid">
          <p className="figure" aria-hidden="true">0</p>
          <div className="privacy-copy">
            <h2>{SERVER_MODE ? 'Files uploaded in free mode.' : 'Files uploaded.'}</h2>
            <p className="lead">{SERVER_MODE
              ? 'Your media stays in browser memory and disappears when you close or reset the page. Optional server processing uploads only the image you send; it is cleaned in memory and not stored.'
              : 'Your media stays in browser memory and disappears when you close or reset the page. The processing engine is downloaded with the app and runs on your own device.'}</p>
          </div>
        </div>
      </section>

      <section className="faq" id="faq">
        <div className="container faq-grid">
          <h2>Questions, answered.</h2>
          <div className="questions">
            <details open><summary>Does my file leave this device?</summary><p>{SERVER_MODE ? 'Not in the default free mode: decoding, detection, restoration, and export all happen locally in your browser. Only if you choose "Upload to server" is that one image sent to the GemClean server, where it is cleaned in memory and returned. Nothing is stored and no account is needed.' : 'No. Decoding, detection, restoration, and export all happen locally in your browser. There is no upload API.'}</p></details>
            <details><summary>Which formats can I use?</summary><p>Images: PNG, JPG, WebP, and HEIC. Videos: MP4, MOV, WebM, MKV, MPG, and MPEG when your browser can decode them. Video exports as MP4/H.264.</p></details>
            <details><summary>Why was no mark detected?</summary><p>GemClean intentionally stops when it cannot confidently match a known Gemini, Veo, or Flow mark. This protects unrelated corner details from being changed.</p></details>
            <details><summary>Does this remove SynthID?</summary><p>No. SynthID is hidden in the pixels themselves, not in the file&rsquo;s metadata. GemClean repairs the visible corner mark and removes file metadata such as C2PA Content Credentials, the IPTC &ldquo;made with AI&rdquo; label, EXIF, GPS, XMP and AI prompts.</p></details>
            <details><summary>What does &ldquo;Best quality&rdquo; do?</summary><p>When a leftover needs repainting, it uses the larger LaMa model instead of the standard one. It rebuilds hair, fabric edges and texture boundaries more faithfully, but a repaint can take up to a minute, and the 92 MB model downloads once, only the first time it is needed. Everything still runs on your device.</p></details>
            <details><summary>What if my image has no mark?</summary><p>The picture is left exactly as it was, but its hidden metadata is still removed, so you always get a cleaned file when there was something to clean.</p></details>
          </div>
        </div>
      </section>

      <section className="close">
        <div className="container close-grid">
          <h2>Ready when your file is.</h2>
          <a className="pill pill-cta pill-large" href="#workspace">Choose a file <ArrowRight size={16} aria-hidden="true" /></a>
        </div>
      </section>

      <footer className="footer">
        <div className="container">
          <p className="footer-statement">Made for respectful, authorized media editing.</p>
          <div className="footer-row">
            <a className="brand" href="#top"><span className="brand-mark"><Sparkles size={16} aria-hidden="true" /></span>GemClean</a>
            <nav className="footer-links" aria-label="Footer"><a href="#how">How it works</a><a href="#privacy">Privacy</a><a href="#faq">Questions</a></nav>
            <span>© 2026 GemClean</span>
          </div>
          <p className="credit">Photograph: <a href="https://commons.wikimedia.org/wiki/File:Brettsperrholzkonstruktion.jpg">RoterRolf</a> (CC0, Wikimedia Commons), with a Gemini mark added for the demo.</p>
        </div>
      </footer>
    </main>
  );
}
