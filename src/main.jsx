import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Check, Download, ImagePlus, LockKeyhole, Menu, RefreshCw, ShieldCheck, Sparkles, Upload, Video, X } from 'lucide-react';
import './styles.css';

const steps = [
  ['01', 'Upload your file', 'Drop an image or video with a visible Gemini corner mark.'],
  ['02', 'Clean it locally', 'The browser repairs the lower-right mark frame by frame.'],
  ['03', 'Download, no login', 'Save the result immediately — no artificial upload cap.'],
];

function App() {
  const input = useRef(null);
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [mediaType, setMediaType] = useState('image');
  const [coverage, setCoverage] = useState(18);
  const [status, setStatus] = useState('idle');
  const [dragging, setDragging] = useState(false);

  const acceptFile = (next) => {
    if (!next || (!next.type.startsWith('image/') && !next.type.startsWith('video/'))) return;
    if (preview) URL.revokeObjectURL(preview);
    if (result?.startsWith('blob:')) URL.revokeObjectURL(result);
    setFile(next);
    setPreview(URL.createObjectURL(next));
    setResult(null);
    setMediaType(next.type.startsWith('video/') ? 'video' : 'image');
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
      paintRepair(ctx, canvas.width, canvas.height, coverage);
      setResult(canvas.toDataURL(file?.type === 'image/png' ? 'image/png' : 'image/jpeg', .96));
      setStatus('complete');
    };
    image.src = preview;
  };

  const paintRepair = (ctx, width, height, percentage) => {
    // Keep the source safely outside the repair rectangle. The previous approach
    // sampled adjacent pixels, which could include the left half of a wide mark.
    const patchW = Math.min(width, Math.max(48, Math.round(width * (percentage / 100))));
    const patchH = Math.min(height, Math.max(42, Math.round(height * Math.min(.17, percentage / 140))));
    const insetX = Math.round(width * .018);
    const insetY = Math.round(height * .018);
    const x = Math.max(0, width - patchW - insetX);
    const y = Math.max(0, height - patchH - insetY);
    const sourceX = Math.max(0, x - patchW - Math.round(width * .025));
    const sourceY = sourceX === 0 ? Math.max(0, y - patchH - Math.round(height * .025)) : y;
    const donor = document.createElement('canvas');
    donor.width = patchW; donor.height = patchH;
    donor.getContext('2d').drawImage(ctx.canvas, sourceX, sourceY, patchW, patchH, 0, 0, patchW, patchH);
    ctx.save();
    ctx.globalAlpha = .96;
    ctx.filter = 'blur(.65px)';
    ctx.drawImage(donor, x, y);
    ctx.restore();
  };

  const processImage = () => {
    setStatus('processing');
    window.setTimeout(repairCorner, 900);
  };

  const processVideo = () => {
    setStatus('processing');
    const video = document.createElement('video');
    video.src = preview;
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = async () => {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      const stream = canvas.captureStream(30);
      const captured = video.captureStream?.();
      captured?.getAudioTracks().forEach((track) => stream.addTrack(track));
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus') ? 'video/webm;codecs=vp9,opus' : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks = [];
      recorder.ondataavailable = (event) => event.data.size && chunks.push(event.data);
      recorder.onstop = () => {
        setResult(URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })));
        setStatus('complete');
      };
      const repairFrame = () => {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        paintRepair(ctx, canvas.width, canvas.height, coverage);
        if (!video.ended) requestAnimationFrame(repairFrame);
      };
      video.onended = () => recorder.stop();
      recorder.start(1000);
      await video.play();
      repairFrame();
    };
  };

  const reset = () => {
    if (preview) URL.revokeObjectURL(preview);
    if (result?.startsWith('blob:')) URL.revokeObjectURL(result);
    setFile(null); setPreview(null); setResult(null); setStatus('idle');
  };

  const download = () => {
    const link = document.createElement('a');
    link.href = result;
    link.download = `gemclean-${file?.name?.replace(/\.[^.]+$/, '') || 'file'}.${mediaType === 'video' ? 'webm' : 'jpg'}`;
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
      <h1>Remove Gemini marks<br/>from <em>images &amp; video.</em></h1>
      <p className="intro">A browser-based workspace for clearing the visible corner mark from media you own. Process as many files as you need — with no account and no fixed upload-size quota.</p>

      <div className={`workspace ${dragging ? 'dragging' : ''} ${status !== 'idle' ? 'has-file' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); acceptFile(e.dataTransfer.files[0]); }}>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime" onChange={(e) => acceptFile(e.target.files[0])} hidden />
        {status === 'idle' ? <>
          <div className="image-orbs"><div className="file-card left"><span>✦</span><small>GEMINI</small></div><div className="connector"><span>→</span></div><div className="file-card right"><ImagePlus size={23}/><small>CLEAN</small></div></div>
          <h2>Drop a file here</h2><p>image or video — choose from your device</p>
          <button className="upload-btn" onClick={() => input.current?.click()}><Upload size={18}/> Choose file</button>
          <small className="formats">PNG, JPG, WEBP, MP4, MOV or WEBM · no fixed file-size cap</small>
        </> : <>
          <div className="preview-shell">
            {mediaType === 'video' ? <video src={result || preview} controls playsInline aria-label="Selected video preview" /> : <img src={result || preview} alt={result ? "Corner-repaired image preview" : "Selected image preview"} />}
            {status !== 'complete' && <div className="gemini-mark">✦</div>}
            {status === 'processing' && <div className="processing"><span></span><b>Cleaning {mediaType}…</b><small>{mediaType === 'video' ? 'Repairing frames locally — keep this tab open' : 'Finding the visible corner mark'}</small></div>}
            {status === 'complete' && <div className="done"><Check size={16}/> {mediaType === 'video' ? 'Video repaired locally' : 'Corner repaired locally'}</div>}
            <button className="remove-file" aria-label="Remove selected file" onClick={reset}><X size={17}/></button>
          </div>
          <div className="file-actions">
            <div><b>{file?.name}</b><small>{Math.max(1, Math.round((file?.size || 0) / 1024))} KB · stays on your device</small></div>
            <label className="repair-control">Repair coverage <strong>{coverage}%</strong><input aria-label="Repair coverage" type="range" min="12" max="30" value={coverage} onChange={(event) => setCoverage(Number(event.target.value))} /><small>Use a wider zone if any part of the corner mark remains.</small></label>
            {status === 'ready' && <button className="process-btn" onClick={mediaType === 'video' ? processVideo : processImage}>Remove watermark {mediaType === 'video' ? <Video size={17}/> : <Sparkles size={17}/>}</button>}
            {status === 'processing' && <button className="process-btn loading" disabled><RefreshCw size={17}/> Working</button>}
            {status === 'complete' && <button className="process-btn" onClick={download}>Download {mediaType} <Download size={17}/></button>}
          </div>
        </>}
      </div>
      <div className="reassurance"><span><LockKeyhole size={15}/> No sign-up</span><span><ShieldCheck size={16}/> Files stay in your browser</span><span><Check size={16}/> Unlimited files</span></div>
      <p className="usage">No artificial size limit. Long or high-resolution videos depend on available device memory. Only use media you own or are authorized to edit.</p>
    </section>

    <section className="proof wrap" id="privacy">
      <div className="proof-copy"><div className="eyebrow"><span></span> Built for the small stuff</div><h2>A clean corner.<br/>A <em>finished</em> frame.</h2><p>GemClean treats the familiar lower-right sparkle as a local frame repair — for still images and browser-processed video.</p><div className="privacy-note"><LockKeyhole size={18}/><div><b>Private by design</b><small>Your media stays in your browser. There are no credits, accounts, or cloud upload quotas.</small></div></div></div>
      <div className="before-after" aria-label="Illustration showing before and after watermark removal"><div className="scene"><div className="sun"></div><div className="hill h1"></div><div className="hill h2"></div><div className="stem"></div></div><div className="before-label">BEFORE</div><div className="after-label">AFTER</div><div className="cut"></div><div className="watermark">✦</div><div className="slider-knob">↔</div></div>
    </section>

    <section className="how wrap" id="how"><div className="section-heading"><div><div className="eyebrow"><span></span> Simple by default</div><h2>Three steps. <em>Zero</em> friction.</h2></div><p>Use it once or whenever your creative workflow needs a clean final image.</p></div><div className="steps">{steps.map(([number, title, copy]) => <article className="step" key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>

    <section className="faq wrap" id="faq"><div><div className="eyebrow"><span></span> Good to know</div><h2>Questions, answered.</h2></div><div className="questions"><details open><summary>Is video processing unlimited?<b>+</b></summary><p>Yes — there are no accounts, credits, batch caps, or fixed upload-size restrictions. Video is processed locally, so the usable limit is your browser and device memory.</p></details><details><summary>Which formats can I use?<b>+</b></summary><p>GemClean accepts PNG, JPG, WEBP, MP4, MOV, and WEBM. Video exports as WEBM after local processing.</p></details><details><summary>Can I use it on my phone?<b>+</b></summary><p>Yes. For large videos, keep the tab open and use a modern browser with sufficient free memory.</p></details></div></section>

    <footer className="wrap"><a className="brand" href="#top"><span className="brand-mark"><Sparkles size={17}/></span>GemClean</a><p>Made for respectful, authorized image editing.</p><span>© 2026 GemClean</span></footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
