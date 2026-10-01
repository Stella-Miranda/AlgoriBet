import { setupCanvas } from '../util.js';

const WALL = '#2b271f';
const FLOOR = '#fbf8f1';
const START = '#1f4a33';

export class PathPanel {
  constructor(canvas, map, cloth, result = null) {
    this.canvas = canvas;
    this.map = map;
    this.cloth = cloth;
    this.res = result;
    this.trailUpTo = 0;
  }

  resize(width) {
    const { w, h } = this.map;
    this.cs = width / w;
    this.width = width;
    this.height = Math.round(this.cs * h);
    this.ctx = setupCanvas(this.canvas, width, this.height);
    this.base = this.layer();
    this.paintBase(this.base.getContext('2d'));
    this.trail = this.layer();
    this.trailUpTo = 0;
  }

  layer() {
    const c = document.createElement('canvas');
    const dpr = this.canvas.width / this.width;
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
    return c;
  }

  rect(ctx, cell, inset = 0) {
    const { w } = this.map, cs = this.cs;
    const x = (cell % w) * cs, y = Math.floor(cell / w) * cs;
    ctx.fillRect(x + inset, y + inset, cs - 2 * inset + 0.4, cs - 2 * inset + 0.4);
  }

  paintBase(ctx) {
    const { w, h, walls } = this.map;
    ctx.fillStyle = FLOOR;
    ctx.fillRect(0, 0, this.width, this.height);
    ctx.fillStyle = WALL;
    for (let i = 0; i < w * h; i++) if (walls[i]) this.rect(ctx, i);
  }

  paintTrail(step) {
    const ctx = this.trail.getContext('2d');
    if (step < this.trailUpTo) {
      ctx.clearRect(0, 0, this.width, this.height);
      this.trailUpTo = 0;
    }
    const { ev, sides } = this.res;
    for (let k = this.trailUpTo; k < step; k++) {
      ctx.fillStyle = sides && sides[k] === 2 ? this.cloth.trail2 : this.cloth.trail;
      this.rect(ctx, ev[k]);
    }
    this.trailUpTo = step;
  }

  ends(ctx) {
    const cs = this.cs, { w } = this.map;
    const centre = (c) => [(c % w) * cs + cs / 2, Math.floor(c / w) * cs + cs / 2];
    // the gate: a green disc that spills a little past its cell
    const [sx, sy] = centre(this.map.start);
    ctx.beginPath();
    ctx.arc(sx, sy, cs * 0.75, 0, Math.PI * 2);
    ctx.fillStyle = START;
    ctx.fill();
    ctx.lineWidth = Math.max(1, cs * 0.18);
    ctx.strokeStyle = FLOOR;
    ctx.stroke();
    // the post: a chequered square, 3x3, with a light rim
    const [gx, gy] = centre(this.map.goal);
    const size = cs * 1.5, q = size / 3;
    const x0 = gx - size / 2, y0 = gy - size / 2;
    ctx.fillStyle = FLOOR;
    ctx.fillRect(x0 - cs * 0.15, y0 - cs * 0.15, size + cs * 0.3, size + cs * 0.3);
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = i % 2 ? '#fff' : '#b3291d';
      ctx.fillRect(x0 + (i % 3) * q, y0 + Math.floor(i / 3) * q, q + 0.3, q + 0.3);
    }
  }

  draw(step = 0) {
    const ctx = this.ctx;
    ctx.drawImage(this.base, 0, 0, this.width, this.height);
    if (this.res) {
      this.paintTrail(step);
      ctx.drawImage(this.trail, 0, 0, this.width, this.height);
    }
    this.ends(ctx);
    if (!this.res || step === 0) return;
    const done = step >= this.res.steps;
    if (done && this.res.solved && this.res.path.length) {
      const cs = this.cs, { w } = this.map;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.beginPath();
      this.res.path.forEach((c, i) => {
        const x = (c % w) * cs + cs / 2, y = Math.floor(c / w) * cs + cs / 2;
        if (i) ctx.lineTo(x, y);
        else ctx.moveTo(x, y);
      });
      // light casing first so the route reads over walls and trail alike
      ctx.strokeStyle = FLOOR;
      ctx.lineWidth = Math.max(2.5, cs * 0.62);
      ctx.stroke();
      ctx.strokeStyle = this.cloth.head;
      ctx.lineWidth = Math.max(1.2, cs * 0.32);
      ctx.stroke();
      this.ends(ctx);
    } else if (!done) {
      // the cell being looked at right now
      ctx.fillStyle = this.cloth.head;
      this.rect(ctx, this.res.ev[step - 1], -this.cs * 0.15);
    }
  }
}
