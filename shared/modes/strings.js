import { mulberry32, mix, int, pick } from '../rng.js';

const N = 320; // characters of text; the renderer lays these out 32 to a row

export const horses = [
  { id: 'naive', name: 'Brute Force', short: 'Naive', trainer: 'Unknown, prehistoric',
    note: 'Tries every alignment, left to right. Honest work.' },
  { id: 'kmp', name: 'Knuth–Morris–Pratt', short: 'KMP', trainer: 'Knuth, Morris & Pratt, 1977',
    note: 'Never looks at a text character twice after a mismatch.' },
  { id: 'horspool', name: 'Boyer–Moore–Horspool', short: 'BMH', trainer: 'R. N. Horspool, 1980',
    note: 'Reads the window backwards and skips. Dangerous on a big alphabet.' },
  { id: 'sunday', name: 'Sunday Quick Search', short: 'Sunday', trainer: 'D. M. Sunday, 1990',
    note: 'Peeks one character past the window to decide how far to jump.' },
  { id: 'rk', name: 'Rabin–Karp', short: 'RK', trainer: 'Karp & Rabin, 1987',
    note: 'Rolling hash, mod 97. Cheap per step, but collisions cost.' },
  { id: 'z', name: 'Z-Algorithm', short: 'Z', trainer: 'Main & Lorentz, 1984',
    note: 'Builds a Z-box over pattern and text in one sweep.' },
  { id: 'raita', name: 'Raita', short: 'Raita', trainer: 'T. Raita, 1992',
    note: 'Horspool\'s shifts, but checks the last, first and middle letters first.' },
  { id: 'bitap', name: 'Shift-Or', short: 'Bitap', trainer: 'Baeza-Yates & Gonnet, 1992',
    note: 'One bit-twiddle per character, no matter what. Never fast, never slow.' },
];

export const maps = [
  { id: 'prose', name: 'Prose', note: 'Lower-case English. Twenty-seven symbols.' },
  { id: 'genome', name: 'Genome', note: 'A, C, G and T only. Lots of near-misses.' },
  { id: 'stutter', name: 'Stutter', note: 'Long runs of one letter. Built to trip people up.' },
  { id: 'binary', name: 'Binary stream', note: 'Noughts and ones. The smallest alphabet there is.' },
];

export const meta = {
  id: 'strings',
  name: 'String search',
  unit: 'character checks',
  blurb: 'Find every copy of the pattern in the text. Each character check costs one step.',
};

const WORDS = (
  'the of and to in is was for on that with as by at from his her an they which this be ' +
  'or had not are but have were their one all would there been when who will more into ' +
  'horse track race stable rider mare colt filly furlong paddock going turf stretch photo ' +
  'finish rail gate starter steward bookie odds stake tote winner place show longshot ' +
  'favourite sprint mile morning evening crowd grandstand ticket'
).split(' ');

function plant(chars, pat, rng, count) {
  for (let k = 0; k < count; k++) {
    const at = int(rng, N - pat.length);
    for (let j = 0; j < pat.length; j++) chars[at + j] = pat[j];
  }
}

export function generate(seed, mapId) {
  const rng = mulberry32(mix(seed, 'map'));
  let text, pattern;
  if (mapId === 'prose') {
    const words = WORDS.filter((w) => w.length >= 3);
    pattern = pick(rng, words);
    if (rng() < 0.3) pattern = pattern + ' ' + pick(rng, WORDS);
    const out = [];
    let len = 0;
    while (len < N + 20) {
      const w = rng() < 0.05 ? pattern : pick(rng, WORDS);
      out.push(w);
      len += w.length + 1;
    }
    text = out.join(' ').slice(0, N);
  } else if (mapId === 'genome' || mapId === 'binary') {
    const alpha = mapId === 'genome' ? 'ACGT' : '01';
    const chars = Array.from({ length: N }, () => alpha[int(rng, alpha.length)]);
    const m = mapId === 'genome' ? 4 + int(rng, 9) : 5 + int(rng, 12);
    const at = int(rng, N - m);
    pattern = chars.slice(at, at + m).join('');
    plant(chars, pattern, rng, 1);
    text = chars.join('');
  } else {
    const chars = [];
    while (chars.length < N) {
      const run = 4 + int(rng, 24);
      for (let k = 0; k < run; k++) chars.push('a');
      chars.push('b');
    }
    chars.length = N;
    const m = 4 + int(rng, 8);
    const shape = int(rng, 5);
    const p = Array(m).fill('a');
    if (shape === 0) p[m - 1] = 'b';
    else if (shape === 1) p[0] = 'b';
    else if (shape === 2) p[m >> 1] = 'b';
    else if (shape === 3) { p[0] = 'b'; p[m - 1] = 'b'; }
    pattern = p.join('');
    plant(chars, pattern, rng, 1);
    text = chars.join('');
  }
  const found = [];
  for (let s = 0; s + pattern.length <= N; s++) if (text.startsWith(pattern, s)) found.push(s);
  return { mode: 'strings', type: mapId, n: N, text, pattern, found };
}

export function describe(map) {
  const k = map.found.length;
  return `${map.n} characters · pattern “${map.pattern}” · ${k} ${k === 1 ? 'copy' : 'copies'} to find`;
}

// ev holds pairs [windowStart, textIndex]. textIndex -1 = studying the
// pattern, -2 = rolling a hash. hits holds [opIndex, position].
function recorder() {
  const ev = [], hits = [];
  return {
    ev, hits,
    look(win, idx) { ev.push(win, idx); },
    hit(pos) { hits.push(ev.length / 2 - 1, pos); },
    done() { return { steps: ev.length / 2, solved: true, ev, hits }; },
  };
}

const searchers = {
  naive(T, P, r) {
    const n = T.length, m = P.length;
    for (let s = 0; s <= n - m; s++) {
      let j = 0;
      while (j < m) {
        r.look(s, s + j);
        if (T[s + j] !== P[j]) break;
        j++;
      }
      if (j === m) r.hit(s);
    }
  },
  kmp(T, P, r) {
    const n = T.length, m = P.length;
    const lps = new Array(m).fill(0);
    for (let i = 1, len = 0; i < m;) {
      r.look(-1, -1);
      if (P[i] === P[len]) lps[i++] = ++len;
      else if (len) len = lps[len - 1];
      else lps[i++] = 0;
    }
    let i = 0, j = 0;
    while (i < n) {
      r.look(i - j, i);
      if (T[i] === P[j]) {
        i++; j++;
        if (j === m) { r.hit(i - m); j = lps[j - 1]; }
      } else if (j) j = lps[j - 1];
      else i++;
    }
  },
  horspool(T, P, r) {
    const n = T.length, m = P.length;
    const shift = new Map();
    for (let j = 0; j < m - 1; j++) { r.look(-1, -1); shift.set(P[j], m - 1 - j); }
    let s = 0;
    while (s <= n - m) {
      let j = m - 1;
      for (;;) {
        r.look(s, s + j);
        if (T[s + j] !== P[j]) break;
        if (--j < 0) break;
      }
      if (j < 0) r.hit(s);
      s += shift.get(T[s + m - 1]) ?? m;
    }
  },
  raita(T, P, r) {
    const n = T.length, m = P.length;
    const shift = new Map();
    for (let j = 0; j < m - 1; j++) { r.look(-1, -1); shift.set(P[j], m - 1 - j); }
    const mid = m >> 1;
    const order = [m - 1];
    if (m > 1) order.push(0);
    if (mid !== 0 && mid !== m - 1) order.push(mid);
    for (let j = 1; j < m - 1; j++) if (j !== mid) order.push(j);
    let s = 0;
    while (s <= n - m) {
      let ok = true;
      for (const j of order) {
        r.look(s, s + j);
        if (T[s + j] !== P[j]) { ok = false; break; }
      }
      if (ok) r.hit(s);
      s += shift.get(T[s + m - 1]) ?? m;
    }
  },
  sunday(T, P, r) {
    const n = T.length, m = P.length;
    const shift = new Map();
    for (let j = 0; j < m; j++) { r.look(-1, -1); shift.set(P[j], m - j); }
    let s = 0;
    while (s <= n - m) {
      let j = 0;
      for (; j < m; j++) {
        r.look(s, s + j);
        if (T[s + j] !== P[j]) break;
      }
      if (j === m) r.hit(s);
      if (s + m >= n) break;
      s += shift.get(T[s + m]) ?? m + 1;
    }
  },
  rk(T, P, r) {
    const n = T.length, m = P.length;
    const B = 31, M = 97;
    const code = (ch) => ch.charCodeAt(0) % M;
    let hp = 0, ht = 0, top = 1;
    for (let j = 0; j < m; j++) {
      r.look(-1, -1);
      hp = (hp * B + code(P[j])) % M;
      r.look(0, j);
      ht = (ht * B + code(T[j])) % M;
      if (j) top = (top * B) % M;
    }
    for (let s = 0; s <= n - m; s++) {
      if (s) {
        r.look(s, -2);
        ht = (ht - code(T[s - 1]) * top % M + M) % M;
        ht = (ht * B + code(T[s + m - 1])) % M;
      }
      if (ht !== hp) continue;
      let j = 0;
      for (; j < m; j++) {
        r.look(s, s + j);
        if (T[s + j] !== P[j]) break;
      }
      if (j === m) r.hit(s);
    }
  },
  bitap(T, P, r) {
    const n = T.length, m = P.length;
    const masks = new Map();
    for (let j = 0; j < m; j++) {
      r.look(-1, -1);
      masks.set(P[j], (masks.get(P[j]) ?? ~0) & ~(1 << j));
    }
    let state = ~0;
    for (let i = 0; i < n; i++) {
      r.look(Math.max(0, i - m + 1), i);
      state = (state << 1) | (masks.get(T[i]) ?? ~0);
      if ((state & (1 << (m - 1))) === 0) r.hit(i - m + 1);
    }
  },
  z(T, P, r) {
    const m = P.length;
    const S = P + '\u0000' + T;
    const L = S.length;
    const z = new Array(L).fill(0);
    let l = 0, rt = 0;
    for (let i = 1; i < L; i++) {
      if (i < rt) z[i] = Math.min(rt - i, z[i - l]);
      while (i + z[i] < L) {
        if (i <= m) r.look(-1, -1);
        else r.look(i - m - 1, i + z[i] - m - 1);
        if (S[z[i]] !== S[i + z[i]]) break;
        z[i]++;
      }
      if (i + z[i] > rt) { l = i; rt = i + z[i]; }
      if (i > m && z[i] >= m) r.hit(i - m - 1);
    }
  },
};

export function run(map, horseId) {
  const r = recorder();
  searchers[horseId](map.text, map.pattern, r);
  return r.done();
}

export function progress(map, res) {
  const out = new Float32Array(res.steps + 1);
  let p = 0;
  for (let k = 0; k < res.steps; k++) {
    const idx = res.ev[2 * k + 1], win = res.ev[2 * k];
    if (idx >= 0) p = Math.max(p, (idx + 1) / map.n);
    else if (win > 0) p = Math.max(p, win / map.n);
    out[k + 1] = Math.min(p, 0.985);
  }
  out[res.steps] = 1;
  return out;
}
