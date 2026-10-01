import { setupCanvas } from '../util.js';
import { CMP, SWAP, WRITE } from '/shared/modes/sorting.js';

const BAR = '#8f8573';
const BG = '#fbf8f1';

export class SortPanel {
  constructor(canvas, map, cloth, result = null) {
    this.canvas = canvas;
    this.map = map;
    this.cloth = cloth;
    this.res = result;
    this.sorted = map.values.slice().sort((a, b) => a - b);
    this.reset();
  }

  reset() {
    this.a = this.map.values.slice();
    this.applied = 0;
  }

  resize(width) {
    this.width = width;
    this.height = Math.round(width * 0.46);
    this.ctx = setupCanvas(this.canvas, width, this.height);
  }

  apply(step) {
    if (step < this.applied) this.reset();
    const ev = this.res.ev, a = this.a;
    for (let k = this.applied; k < step; k++) {
      const code = ev[3 * k], x = ev[3 * k + 1], y = ev[3 * k + 2];
      if (code === SWAP) { const t = a[x]; a[x] = a[y]; a[y] = t; }
      else if (code === WRITE) a[x] = y;
    }
    this.applied = step;
  }

  draw(step = 0) {
    const ctx = this.ctx, W = this.width, H = this.height;
    const { n, max } = this.map;
    if (this.res) this.apply(step);
    const done = this.res && step >= this.res.steps;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, W, H);

    const pad = 4;
    const slot = (W - pad * 2) / n;
    const gap = slot > 6 ? 1.5 : 0.75;
    const usable = H - pad * 2 - 6;
    let hiA = -1, hiB = -1, hiCode = -1;
    if (this.res && step > 0 && !done) {
      const k = step - 1;
      hiCode = this.res.ev[3 * k];
      hiA = this.res.ev[3 * k + 1];
      hiB = hiCode === WRITE ? -1 : this.res.ev[3 * k + 2];
    }
    for (let i = 0; i < n; i++) {
      const v = this.a[i];
      const bh = Math.max(2, (v / max) * usable);
      const x = pad + i * slot;
      const y = H - pad - bh;
      const home = this.res && v === this.sorted[i];
      ctx.fillStyle = done || home ? this.cloth.head : BAR;
      if (!this.res) ctx.fillStyle = '#5d5547';
      if (i === hiA || i === hiB) ctx.fillStyle = hiCode === CMP ? '#e0a400' : '#1d1a15';
      ctx.fillRect(x + gap / 2, y, slot - gap, bh);
    }
    // marker ticks under the bars being touched
    if (hiA >= 0) {
      ctx.fillStyle = hiCode === CMP ? '#e0a400' : '#1d1a15';
      for (const i of [hiA, hiB]) if (i >= 0) ctx.fillRect(pad + i * slot + gap / 2, H - pad + 1, slot - gap, 3);
    }
  }
}
