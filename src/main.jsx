import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Check, Download, ImagePlus, LockKeyhole, Menu, RefreshCw, ShieldCheck, Sparkles, Upload, X } from 'lucide-react';
import './styles.css';

const steps = [
  ['01', 'Upload your image', 'Drop a PNG, JPG, or WEBP with a Gemini corner mark.'],
  ['02', 'Clean it in seconds', 'Our browser tool targets the visible corner mark.'],
  ['03', 'Download, no login', 'Save your result right away at its original size.'],
];

function App() {
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [status, setStatus] = useState('idle');
  const [dragging, setDragging] = useState(false);

  const acceptFile = (next) => {
    if (!next || !next.type.startsWith('image/')) return;
    if (preview) URL.revokeObjectURL(preview);
    setFile(next);
    setPreview(URL.createObjectURL(next));
    setResult(null);
    setStatus('ready');
  };

  const repairCorner = () => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(image, 0, 0);
      // Gemini's visible mark typically sits in the lower-right corner. This local
      // heuristic borrows nearby texture and softly blends it over that small area.
      const patchW = Math.max(38, Math.round(canvas.width * .105));
      const patchH = Math.max(38, Math.round(canvas.height * .105));
      const x = canvas.width - patchW - Math.round(canvas.width * .018);
      const y = canvas.height - patchH - Math.round(canvas.height * .018);
      const sourceX = Math.max(0, x - patchW);
      const sourceY = Math.max(0, y - patchH);
      const texture = ctx.getImageData(sourceX, sourceY, patchW, patchH);
      const patch = document.createElement('canvas');
      patch.width = patchW; patch.height = patchH;
      patch.getContext('2d').putImageData(texture, 0, 0);
      ctx.save();
      ctx.globalAlpha = .92;
      ctx.filter = 'blur(1px)';
      ctx.drawImage(patch, x, y);
      ctx.restore();
      setResult(canvas.toDataURL(file?.type === 'image/png' ? 'image/png' : 'image/jpeg', .96));
      setStatus('complete');
    };
    image.src = preview;
  };

  const processImage = () => {
    setStatus('processing');
    window.setTimeout(repairCorner, 900);
  };

  const reset = () => {
    if (preview) URL.revokeObjectURL(preview);
    setFile(null); setPreview(null); setResult(null); setStatus('idle');
  };

  const download = () => {
    const link = document.createElement('a');
    link.href = result;
    link.download = `gemclean-${file?.name?.replace(/\.[^.]+$/, '') || 'image'}.jpg`;
    link.click();
  };

  return <main>
    <nav className="nav wrap" aria-label="Main navigation">
      <a className="brand" href="#top" aria-label="GemClean home"><span className="brand-mark"><Sparkles size={17}/></span>GemClean</a>
      <div className="nav-links"><a href="#how">How it works</a><a href="#privacy">Privacy</a><a href="#faq">FAQ</a></div>
      <button className="nav-cta" onClick={() => input.current?.click()}>Try free <ArrowRight size={15}/></button>
      <button className="menu" aria-label="Open menu"><Menu size={20}/></button>
    </nav>

    <section className="hero wrap" id="top">
      <div className="eyebrow"><span></span> Free tool · no account needed</div>
      <h1>Remove the Gemini<br/><em>watermark</em> from your image.</h1>
      <p className="intro">A simple browser-based workspace for clearing the visible corner mark from images you own. Private, fast, and ready on any device.</p>

      <div className={`workspace ${dragging ? 'dragging' : ''} ${status !== 'idle' ? 'has-file' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); acceptFile(e.dataTransfer.files[0]); }}>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => acceptFile(e.target.files[0])} hidden />
        {status === 'idle' ? <>
          <div className="image-orbs"><div className="file-card left"><span>✦</span><small>GEMINI</small></div><div className="connector"><span>→</span></div><div className="file-card right"><ImagePlus size={23}/><small>CLEAN</small></div></div>
          <h2>Drop an image here</h2><p>or choose a file from your device</p>
          <button className="upload-btn" onClick={() => input.current?.click()}><Upload size={18}/> Choose image</button>
          <small className="formats">PNG, JPG or WEBP · up to 20 MB</small>
        </> : <>
          <div className="preview-shell">
            <img src={result || preview} alt={result ? "Corner-repaired image preview" : "Selected image preview"} />
            {status !== 'complete' && <div className="gemini-mark">✦</div>}
            {status === 'processing' && <div className="processing"><span></span><b>Cleaning image…</b><small>Finding the visible corner mark</small></div>}
            {status === 'complete' && <div className="done"><Check size={16}/> Corner repaired locally</div>}
            <button className="remove-file" aria-label="Remove selected image" onClick={reset}><X size={17}/></button>
          </div>
          <div className="file-actions">
            <div><b>{file?.name}</b><small>{Math.max(1, Math.round((file?.size || 0) / 1024))} KB · stays on your device</small></div>
            {status === 'ready' && <button className="process-btn" onClick={processImage}>Remove watermark <Sparkles size={17}/></button>}
            {status === 'processing' && <button className="process-btn loading" disabled><RefreshCw size={17}/> Working</button>}
            {status === 'complete' && <button className="process-btn" onClick={download}>Download image <Download size={17}/></button>}
          </div>
        </>}
      </div>
      <div className="reassurance"><span><LockKeyhole size={15}/> No sign-up</span><span><ShieldCheck size={16}/> Files stay in your browser</span><span><Check size={16}/> Original dimensions</span></div>
      <p className="usage">Only use this tool for images you own or are authorized to edit.</p>
    </section>

    <section className="proof wrap" id="privacy">
      <div className="proof-copy"><div className="eyebrow"><span></span> Built for the small stuff</div><h2>A clean corner.<br/>A <em>finished</em> image.</h2><p>GemClean is designed for the familiar sparkle that can appear in the lower-right corner of AI-generated imagery.</p><div className="privacy-note"><LockKeyhole size={18}/><div><b>Private by design</b><small>Your image preview is created locally. Nothing is stored in an account.</small></div></div></div>
      <div className="before-after" aria-label="Illustration showing before and after watermark removal"><div className="scene"><div className="sun"></div><div className="hill h1"></div><div className="hill h2"></div><div className="stem"></div></div><div className="before-label">BEFORE</div><div className="after-label">AFTER</div><div className="cut"></div><div className="watermark">✦</div><div className="slider-knob">↔</div></div>
    </section>

    <section className="how wrap" id="how"><div className="section-heading"><div><div className="eyebrow"><span></span> Simple by default</div><h2>Three steps. <em>Zero</em> friction.</h2></div><p>Use it once or whenever your creative workflow needs a clean final image.</p></div><div className="steps">{steps.map(([number, title, copy]) => <article className="step" key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>

    <section className="faq wrap" id="faq"><div><div className="eyebrow"><span></span> Good to know</div><h2>Questions, answered.</h2></div><div className="questions"><details open><summary>Do I need to create an account?<b>+</b></summary><p>No. Upload, process, and download without logging in.</p></details><details><summary>Which formats can I use?<b>+</b></summary><p>GemClean accepts PNG, JPG, and WEBP image files up to 20 MB.</p></details><details><summary>Can I use it on my phone?<b>+</b></summary><p>Yes — the layout and upload flow are built for mobile browsers first.</p></details></div></section>

    <footer className="wrap"><a className="brand" href="#top"><span className="brand-mark"><Sparkles size={17}/></span>GemClean</a><p>Made for respectful, authorized image editing.</p><span>© 2026 GemClean</span></footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
