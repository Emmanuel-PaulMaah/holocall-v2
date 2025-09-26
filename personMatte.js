// personMatte.js
// Receiver-side person cut-out using MediaPipe SelfieSegmentation.
// Exposes `PersonMatte` with .canvas (RGBA, background transparent).

export class PersonMatte {
  constructor(videoEl, {
    modelSelection = 1,      // 0=fast, 1=accurate
    featherPx = 1.0,
    dilatePx = 0.6,
    emaAlpha = 0.35,         // temporal smoothing (0..1), higher = more weight on new frame
    rgbScale = 0.992,        // slight shrink so mask overhang hides jitter
    depthFpsDivider = 1      // 1=every frame, 2=every other frame
  } = {}) {
    if (!window.SelfieSegmentation) throw new Error("MediaPipe SelfieSegmentation not loaded");
    this.videoEl = videoEl;
    this.opts = { modelSelection, featherPx, dilatePx, emaAlpha, rgbScale, depthFpsDivider };

    // public output
    this.canvas = document.createElement('canvas');

    // internals
    this._maskRaw = document.createElement('canvas');
    this._maskNice = document.createElement('canvas');
    this._scratch  = document.createElement('canvas');
    this._stopped = false;
    this._frame = 0;

    this.seg = new SelfieSegmentation({ locateFile: f =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${f}`
    });
    this.seg.setOptions({ modelSelection, selfieMode: false });
    this.seg.onResults(r => this._onResults(r));
  }

  async start() {
    await this._waitForVideo();
    const w = this.videoEl.videoWidth || this.videoEl.width;
    const h = this.videoEl.videoHeight || this.videoEl.height;
    [this.canvas, this._maskRaw, this._maskNice, this._scratch].forEach(c => { c.width = w; c.height = h; });
    this._tick();
  }

  stop(){ this._stopped = true; }

  async _tick() {
    if (this._stopped) return;
    this._frame++;

    const divide = Math.max(1, this.opts.depthFpsDivider|0);
    if (divide > 1 && (this._frame % divide)) {
      this._composite({ image: this.videoEl }); // reuse last mask, redraw RGB
    } else {
      try { await this.seg.send({ image: this.videoEl }); }
      catch { /* if a frame fails, keep going with last good mask */ this._composite({ image: this.videoEl }); }
    }
    requestAnimationFrame(() => this._tick());
  }

  _onResults(results) {
    const w = this.canvas.width, h = this.canvas.height;

    // 1) copy raw mask
    const r = this._maskRaw.getContext('2d');
    r.globalCompositeOperation = 'copy';
    r.drawImage(results.segmentationMask, 0, 0, w, h);

    // 2) EMA temporal smoothing
    const n = this._maskNice.getContext('2d');
    const s = this._scratch.getContext('2d');
    s.globalCompositeOperation = 'copy'; s.drawImage(this._maskNice, 0, 0, w, h);
    n.clearRect(0,0,w,h);
    n.globalAlpha = (1 - this.opts.emaAlpha); n.drawImage(this._scratch, 0,0,w,h);
    n.globalAlpha = this.opts.emaAlpha;       n.drawImage(this._maskRaw, 0,0,w,h);
    n.globalAlpha = 1;

    // 3) feather + slight dilation in a single blur pass (cheap & good enough)
    if (this.opts.dilatePx > 0 || this.opts.featherPx > 0) {
      const total = Math.max(0, this.opts.dilatePx + this.opts.featherPx);
      n.filter = `blur(${total}px)`; n.drawImage(this._maskNice, 0,0,w,h); n.filter = 'none';
    }

    // 4) composite matte
    this._composite(results);
  }

  _composite(results) {
    const w = this.canvas.width, h = this.canvas.height;
    const ctx = this.canvas.getContext('2d');
    ctx.save();
    ctx.clearRect(0,0,w,h);

    // draw mask into output
    ctx.globalCompositeOperation = 'source-over';
    ctx.drawImage(this._maskNice, 0, 0, w, h);

    // soft after-feather (subtle)
    if (this.opts.featherPx > 0.2) {
      ctx.filter = `blur(${this.opts.featherPx * 0.6}px)`;
      ctx.drawImage(this.canvas, 0, 0);
      ctx.filter = 'none';
    }

    // keep only masked pixels for RGB
    ctx.globalCompositeOperation = 'source-in';
    const s = Math.min(1, Math.max(0.97, this.opts.rgbScale));
    const w2 = w*s, h2 = h*s, x = (w - w2)/2, y = (h - h2)/2;
    ctx.drawImage(results.image || this.videoEl, x, y, w2, h2);

    ctx.restore();
  }

  _waitForVideo() {
    return new Promise(res => {
      if (this.videoEl.readyState >= 2) return res();
      this.videoEl.onloadeddata = () => res();
    });
  }
}
