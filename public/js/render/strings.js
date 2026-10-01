import { setupCanvas } from '../util.js';

const COLS = 32;
const BG = '#fbf8f1';
const INK = '#1d1a15';
const FAINT = '#a39a88';

export class TextPanel {
  constructor(canvas, map, cloth, result = null, horseId = null) {
    this.canvas = canvas;
    this.map = map;
    this.cloth = cloth;
    this.res = result;
    this.horse = horseId;
    this.rows = Math.ceil(map.n / COLS);
  }

  resize(width) {
    this.width = width;
    this.cw = width / COLS;
    this.ch = this.cw * 1.32;
    this.height = Math.round(this.ch * (this.rows + 1.7));
    this.ctx = setupCanvas(this.canvas, width, this.height);
  }

  cell(i) {
    return [(i % COLS) * this.cw, Math.floor(i / COLS) * this.ch];
  }

  draw(step = 0) {
    const ctx = this.ctx, { cw, ch } = this;
    const { text, pattern, n } = this.map;
    ctx.fillStyle = BG;
    ctx.fillRect(0, 0, this.width, this.height);

    let win = -1, idx = -1, reach = -1;
    const found = [];
    if (this.res && step > 0) {
      const ev = this.res.ev;
      win = ev[2 * (step - 1)];
      idx = ev[2 * (step - 1) + 1];
      // how far through the text it has got
      for (let k = 0; k < step; k++) if (ev[2 * k + 1] > reach) reach = ev[2 * k + 1];
      const hits = this.res.hits;
      for (let h = 0; h < hits.length; h += 2) if (hits[h] < step) found.push(hits[h + 1]);
    }
    const done = this.res && step >= this.res.steps;
    const m = pattern.length;

    // window
    if (!done && win >= 0 && idx !== -1) {
      ctx.fillStyle = this.cloth.trail;
      for (let i = win; i < Math.min(n, win + m); i++) {
        const [x, y] = this.cell(i);
        ctx.fillRect(x, y + 1, cw + 0.3, ch - 2);
      }
    }
    // the character under the magnifying glass
    if (!done && idx >= 0) {
      const [x, y] = this.cell(idx);
      const p = idx - win;
      const exact = this.horse !== 'bitap' && p >= 0 && p < m;
      ctx.fillStyle = !exact ? this.cloth.head : text[idx] === pattern[p] ? '#2f7d3b' : '#c8352b';
      ctx.fillRect(x, y + 1, cw + 0.3, ch - 2);
    }

    ctx.font = `${Math.round(cw * 1.08)}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < n; i++) {
      const [x, y] = this.cell(i);
      const ch0 = text[i] === ' ' ? '·' : text[i];
      const lit = !done && i === idx;
      ctx.fillStyle = lit ? '#fff' : text[i] === ' ' ? '#cfc6b3' : this.res && i <= reach && !done ? FAINT : INK;
      ctx.fillText(ch0, x + cw / 2, y + ch / 2 + 1);
    }

    // underline every copy found so far
    ctx.fillStyle = this.cloth.head;
    for (const s of found) {
      for (let i = s; i < s + m; i++) {
        const [x, y] = this.cell(i);
        ctx.fillRect(x, y + ch - 2.5, cw + 0.3, 2.5);
      }
    }

    // pattern strip along the bottom
    const py = this.rows * this.ch + this.ch * 0.35;
    ctx.fillStyle = '#e8e0cd';
    ctx.fillRect(0, py, this.width, this.ch * 1.2);
    const studying = !done && this.res && idx === -1 && win === -1;
    ctx.textAlign = 'left';
    ctx.fillStyle = studying ? this.cloth.head : '#6b6457';
    ctx.font = `600 ${Math.round(cw * 0.9)}px "IBM Plex Mono", ui-monospace, monospace`;
    const label = studying ? 'studying ' : 'find ';
    ctx.fillText(label, cw * 0.4, py + this.ch * 0.62);
    const lw = ctx.measureText(label).width;
    ctx.fillStyle = INK;
    ctx.font = `600 ${Math.round(cw * 1.08)}px "IBM Plex Mono", ui-monospace, monospace`;
    ctx.fillText(pattern.replace(/ /g, '·'), cw * 0.4 + lw, py + this.ch * 0.62);
    if (this.res && found.length) {
      ctx.textAlign = 'right';
      ctx.fillStyle = this.cloth.head;
      ctx.font = `600 ${Math.round(cw * 0.9)}px "IBM Plex Mono", ui-monospace, monospace`;
      ctx.fillText(`${found.length}/${this.map.found.length} found`, this.width - cw * 0.4, py + this.ch * 0.62);
    }
  }
}
