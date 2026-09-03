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
  const [coverage, setCoverage] = useState(22);
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

  const findGeminiMark = (ctx, width, height, percentage) => {
    const image = ctx.getImageData(0, 0, width, height);
    const startX = Math.floor(width * (1 - percentage / 100));
    const startY = Math.floor(height * (1 - percentage / 100));
    const zoneW = width - startX;
    const zoneH = height - startY;
    const seen = new Uint8Array(zoneW * zoneH);
    const candidates = [];
    const isBrightNeutral = (x, y) => {
      const offset = (y * width + x) * 4;
      const r = image.data[offset], g = image.data[offset + 1], b = image.data[offset + 2];
      const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b);
      const luminance = r * .2126 + g * .7152 + b * .0722;
      return luminance > 200 && maximum > 0 && (maximum - minimum) / maximum < .42;
    };
    for (let y = startY; y < height; y += 1) for (let x = startX; x < width; x += 1) {
      const seed = (y - startY) * zoneW + x - startX;
      if (seen[seed] || !isBrightNeutral(x, y)) continue;
      const queue = [[x, y]];
      seen[seed] = 1;
      let pixels = 0, minX = x, maxX = x, minY = y, maxY = y;
      for (let pointer = 0; pointer < queue.length; pointer += 1) {
        const [cx, cy] = queue[pointer];
        pixels += 1; minX = Math.min(minX, cx); maxX = Math.max(maxX, cx); minY = Math.min(minY, cy); maxY = Math.max(maxY, cy);
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < startX || ny < startY || nx >= width || ny >= height) continue;
          const index = (ny - startY) * zoneW + nx - startX;
          if (!seen[index] && isBrightNeutral(nx, ny)) { seen[index] = 1; queue.push([nx, ny]); }
        }
      }
      const componentWidth = maxX - minX + 1;
      const componentHeight = maxY - minY + 1;
      const centerX = (minX + maxX) / 2;
      const centerY = (minY + maxY) / 2;
      const sizeLimit = Math.min(width, height) * .1;
      if (pixels > 32 && componentWidth <= sizeLimit && componentHeight <= sizeLimit && centerX > width * .78 && centerY > height * .78) {
        const distance = Math.hypot(centerX - width * .88, centerY - height * .88);
        candidates.push({ pixels, minX, maxX, minY, maxY, points: queue, score: pixels / (1 + distance / 120) });
      }
    }
    const mark = candidates.sort((a, b) => b.score - a.score)[0];
    if (!mark) return null;
    return { minX: mark.minX, maxX: mark.maxX, minY: mark.minY, maxY: mark.maxY, points: mark.points };
  };

  const inpaintMark = (ctx, width, height, rect) => {
    if (!rect) return;
    const source = ctx.getImageData(0, 0, width, height);
    let previous = new Uint8ClampedArray(source.data);
    const next = new Uint8ClampedArray(source.data);
    const padding = Math.max(4, Math.round(Math.min(width, height) * .004));
    const mask = new Uint8Array(width * height);
    for (const [pointX, pointY] of rect.points) for (let dy = -padding; dy <= padding; dy += 1) for (let dx = -padding; dx <= padding; dx += 1) {
      const x = pointX + dx, y = pointY + dy;
      if (x >= 0 && y >= 0 && x < width && y < height && dx * dx + dy * dy <= padding * padding) mask[y * width + x] = 1;
    }
    const left = Math.max(0, rect.minX - padding), top = Math.max(0, rect.minY - padding);
    const right = Math.min(width - 1, rect.maxX + padding), bottom = Math.min(height - 1, rect.maxY + padding);
    // Diffuse colours only through the icon-shaped mask, never a full rectangle.
    for (let pass = 0; pass < padding * 3; pass += 1) {
      for (let y = top; y <= bottom; y += 1) for (let x = left; x <= right; x += 1) {
        if (!mask[y * width + x]) continue;
        const offset = (y * width + x) * 4;
        const neighbors = [[Math.max(0, x - 1), y], [Math.min(width - 1, x + 1), y], [x, Math.max(0, y - 1)], [x, Math.min(height - 1, y + 1)]];
        for (let channel = 0; channel < 3; channel += 1) next[offset + channel] = Math.round(neighbors.reduce((sum, [nx, ny]) => sum + previous[(ny * width + nx) * 4 + channel], 0) / neighbors.length);
      }
      previous = new Uint8ClampedArray(next);
    }
    source.data.set(previous);
    ctx.putImageData(source, 0, 0);
  };

  const paintRepair = (ctx, width, height, percentage, rect = null) => {
    const mark = rect || findGeminiMark(ctx, width, height, percentage);
    inpaintMark(ctx, width, height, mark);
    return mark;
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
      let detectedMark = null;
      const repairFrame = () => {
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        detectedMark = paintRepair(ctx, canvas.width, canvas.height, coverage, detectedMark);
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
            {status === 'processing' && <div className="processing"><span></span><b>Cleaning {mediaType}…</b><small>{mediaType === 'video' ? 'Trimming the marked edge frame by frame — keep this tab open' : 'Trimming the marked lower-right edge'}</small></div>}
            {status === 'complete' && <div className="done"><Check size={16}/> {mediaType === 'video' ? 'Video edge cleaned locally' : 'Image edge cleaned locally'}</div>}
            <button className="remove-file" aria-label="Remove selected file" onClick={reset}><X size={17}/></button>
          </div>
          <div className="file-actions">
            <div><b>{file?.name}</b><small>{Math.max(1, Math.round((file?.size || 0) / 1024))} KB · stays on your device</small></div>
            <label className="repair-control">Gemini mark scan <strong>{coverage}%</strong><input aria-label="Gemini mark scan area" type="range" min="15" max="35" value={coverage} onChange={(event) => setCoverage(Number(event.target.value))} /><small>Scans the lower-right area and removes only the detected sparkle.</small></label>
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
      <div className="proof-copy"><div className="eyebrow"><span></span> Built for the small stuff</div><h2>A clean corner.<br/>A <em>finished</em> frame.</h2><p>GemClean cleanly removes the marked lower-right edge, then preserves the original output dimensions. No artificial texture patch is added.</p><div className="privacy-note"><LockKeyhole size={18}/><div><b>Private by design</b><small>Your media stays in your browser. There are no credits, accounts, or cloud upload quotas.</small></div></div></div>
      <div className="before-after" aria-label="Illustration showing before and after watermark removal"><div className="scene"><div className="sun"></div><div className="hill h1"></div><div className="hill h2"></div><div className="stem"></div></div><div className="before-label">BEFORE</div><div className="after-label">AFTER</div><div className="cut"></div><div className="watermark">✦</div><div className="slider-knob">↔</div></div>
    </section>

    <section className="how wrap" id="how"><div className="section-heading"><div><div className="eyebrow"><span></span> Simple by default</div><h2>Three steps. <em>Zero</em> friction.</h2></div><p>Use it once or whenever your creative workflow needs a clean final image.</p></div><div className="steps">{steps.map(([number, title, copy]) => <article className="step" key={number}><span>{number}</span><h3>{title}</h3><p>{copy}</p></article>)}</div></section>

    <section className="faq wrap" id="faq"><div><div className="eyebrow"><span></span> Good to know</div><h2>Questions, answered.</h2></div><div className="questions"><details open><summary>Is video processing unlimited?<b>+</b></summary><p>Yes — there are no accounts, credits, batch caps, or fixed upload-size restrictions. Video is processed locally, so the usable limit is your browser and device memory.</p></details><details><summary>Which formats can I use?<b>+</b></summary><p>GemClean accepts PNG, JPG, WEBP, MP4, MOV, and WEBM. Video exports as WEBM after local processing.</p></details><details><summary>Can I use it on my phone?<b>+</b></summary><p>Yes. For large videos, keep the tab open and use a modern browser with sufficient free memory.</p></details></div></section>

    <footer className="wrap"><a className="brand" href="#top"><span className="brand-mark"><Sparkles size={17}/></span>GemClean</a><p>Made for respectful, authorized image editing.</p><span>© 2026 GemClean</span></footer>
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
