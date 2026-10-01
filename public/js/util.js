// Odds and ends shared by the screens.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

// html`<b>${name}</b>` escapes every interpolation unless it's wrapped in raw().
const RAW = Symbol('raw');
export const raw = (s) => ({ [RAW]: String(s) });
export function html(strings, ...vals) {
  let out = strings[0];
  vals.forEach((v, i) => {
    if (Array.isArray(v)) out += v.map((x) => (x && x[RAW] !== undefined ? x[RAW] : esc(x))).join('');
    else if (v && v[RAW] !== undefined) out += v[RAW];
    else if (v === false || v === null || v === undefined) out += '';
    else out += esc(v);
    out += strings[i + 1];
  });
  return raw(out);
}
// Only touch the DOM when the markup actually changed, so a broadcast
// landing mid-click doesn't swap the button out from under the pointer.
export const render = (el, tpl) => {
  const markup = tpl[RAW];
  if (el._markup === markup) return;
  el._markup = markup;
  el.innerHTML = markup;
};

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

// Saddle cloth colours as used on American tracks, numbers 1 to 6.
export const CLOTHS = [
  { bg: '#c8352b', fg: '#fff', trail: '#eeb9b0', trail2: '#d98b80', head: '#c8352b', name: 'red' },
  { bg: '#f7f4ec', fg: '#1d1a15', trail: '#cdd2d4', trail2: '#a4abb0', head: '#5f686e', name: 'white' },
  { bg: '#2456a6', fg: '#fff', trail: '#b9c9e8', trail2: '#86a0d0', head: '#2456a6', name: 'blue' },
  { bg: '#f0c419', fg: '#1d1a15', trail: '#f2dc87', trail2: '#e2bd45', head: '#b88f00', name: 'yellow' },
  { bg: '#2f7d3b', fg: '#fff', trail: '#b9d8b5', trail2: '#86b981', head: '#2f7d3b', name: 'green' },
  { bg: '#1b1b1b', fg: '#f0c419', trail: '#b3aea4', trail2: '#837d71', head: '#1b1b1b', name: 'black' },
];

export function cloth(n, extra = '') {
  const c = CLOTHS[n - 1];
  return html`<span class="cloth ${extra}" style="--c-bg:${c.bg};--c-fg:${c.fg}">${n}</span>`;
}

export const fmtOdds = (o) => (!o ? '—' : o[0] === o[1] ? 'Evens' : `${o[0]}-${o[1]}`);
export const decimal = (o) => 1 + o[0] / o[1];
export const fmtPts = (n) => Math.round(n).toLocaleString('en-GB');
export const signed = (n) => (n > 0 ? `+${fmtPts(n)}` : n < 0 ? `−${fmtPts(-n)}` : '±0');

export const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

// Server clock: every room message carries serverNow; keep the offset.
let offset = 0;
export const syncClock = (serverNow) => { offset = serverNow - Date.now(); };
export const now = () => Date.now() + offset;

export function setupCanvas(canvas, width, height) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

export function sparkline(values, w = 64, h = 18) {
  if (!values || values.length < 2) return '';
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * (w - 2) + 1;
    const y = h - 1 - ((v - min) / span) * (h - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts.join(' ')}"/></svg>`;
}
