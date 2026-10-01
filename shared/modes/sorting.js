import { mulberry32, mix, int, shuffle } from '../rng.js';


// op codes in the trace; each op is three numbers: [code, a, b]
export const CMP = 0;
export const SWAP = 1;
export const WRITE = 2; // a[i] = b

export const horses = [
  { id: 'bubble', name: 'Bubble Sort', short: 'Bubble', trainer: 'E. H. Friend, 1956',
    note: 'Early-exit version. Hopeless on a shuffle, sharp on a sorted list.' },
  { id: 'insertion', name: 'Insertion Sort', short: 'Insert', trainer: 'J. Mauchly, 1946',
    note: 'Card-player\'s method. Flies when the list is nearly in order.' },
  { id: 'shell', name: 'Shell Sort', short: 'Shell', trainer: 'D. L. Shell, 1959',
    note: 'Ciura gaps. Quietly consistent over any going.' },
  { id: 'merge', name: 'Merge Sort', short: 'Merge', trainer: 'J. von Neumann, 1945',
    note: 'Top-down, skips merges that are already in order. Rock steady.' },
  { id: 'quick', name: 'Quicksort', short: 'Quick', trainer: 'C. A. R. Hoare, 1961',
    note: 'Random pivot, Lomuto partition. Usually quick. Sometimes very unlucky.' },
  { id: 'heap', name: 'Heapsort', short: 'Heap', trainer: 'J. W. J. Williams, 1964',
    note: 'Guaranteed n log n, but does a lot of shuffling to get there.' },
  { id: 'selection', name: 'Selection Sort', short: 'Select', trainer: 'Folklore',
    note: 'Looks at everything, moves almost nothing. Likes heavy going.' },
  { id: 'comb', name: 'Comb Sort', short: 'Comb', trainer: 'W. Dobosiewicz, 1980',
    note: 'Bubble sort with a long stride that shrinks by 1.3 each pass.' },
];

// The going: how much a swap or write costs compared with a comparison.
export const goings = [
  { id: 'good', name: 'Good', moveCost: 1, note: 'Compares and moves cost the same.' },
  { id: 'soft', name: 'Soft', moveCost: 2, note: 'Every swap or write costs two steps.' },
  { id: 'heavy', name: 'Heavy', moveCost: 3, note: 'Every swap or write costs three steps.' },
];

export const maps = [
  { id: 'shuffled', name: 'Shuffled deck', note: 'A fair random permutation.' },
  { id: 'nearly', name: 'Nearly sorted', note: 'In order apart from a handful of local swaps.' },
  { id: 'reversed', name: 'Mostly reversed', note: 'Descending, with a couple of stragglers.' },
  { id: 'fewunique', name: 'Few unique', note: 'Only a handful of distinct heights. Lots of ties.' },
  { id: 'runs', name: 'Sorted runs', note: 'A few ascending runs glued together.' },
];

export const meta = {
  id: 'sorting',
  name: 'Sorting',
  unit: 'compares + moves',
  blurb: 'Put the bars in order. Compares cost one step; moves cost whatever the going says.',
};

export function generate(seed, mapId) {
  const rng = mulberry32(mix(seed, 'map'));
  // size matters: insertion sort is hard to beat on a dozen bars
  const N = 12 + 4 * int(rng, 12);
  let v = Array.from({ length: N }, (_, i) => i + 1);
  if (mapId === 'shuffled') {
    shuffle(rng, v);
  } else if (mapId === 'nearly') {
    const k = 2 + int(rng, 9);
    for (let s = 0; s < k; s++) {
      const i = int(rng, N - 3);
      const j = i + 1 + int(rng, 3);
      [v[i], v[j]] = [v[j], v[i]];
    }
  } else if (mapId === 'reversed') {
    v.reverse();
    const k = 1 + int(rng, 6);
    for (let s = 0; s < k; s++) {
      const i = int(rng, N), j = int(rng, N);
      [v[i], v[j]] = [v[j], v[i]];
    }
  } else if (mapId === 'fewunique') {
    const k = 3 + int(rng, 4);
    v = v.map(() => Math.round((N * (1 + int(rng, k))) / k));
  } else {
    shuffle(rng, v);
    const k = 2 + int(rng, 5);
    const runs = [];
    for (let r = 0; r < k; r++) {
      runs.push(v.slice(Math.round((r * N) / k), Math.round(((r + 1) * N) / k)).sort((a, b) => a - b));
    }
    v = runs.flat();
  }
  // make sure there is actually something to do
  if (v.every((x, i) => i === 0 || v[i - 1] <= x)) [v[0], v[N - 1]] = [v[N - 1], v[0]];
  const max = Math.max(...v);
  return { mode: 'sorting', type: mapId, n: N, values: v, max, inv0: inversions(v) };
}

export function describe(map) {
  const pairs = (map.n * (map.n - 1)) / 2;
  const distinct = new Set(map.values).size;
  const extra = distinct < map.n ? ` · ${distinct} distinct heights` : '';
  return `${map.n} bars · ${map.inv0} of ${pairs} pairs out of order${extra}`;
}

export function inversions(a) {
  let c = 0;
  for (let i = 0; i < a.length; i++) for (let j = i + 1; j < a.length; j++) if (a[i] > a[j]) c++;
  return c;
}

// A tiny instrumented array: every touch is logged as one op.
function tracker(values) {
  const a = values.slice();
  const ev = [];
  return {
    a, ev,
    gt(i, j) { ev.push(CMP, i, j); return a[i] > a[j]; },
    swap(i, j) { ev.push(SWAP, i, j); const t = a[i]; a[i] = a[j]; a[j] = t; },
    write(i, val) { ev.push(WRITE, i, val); a[i] = val; },
  };
}

const sorters = {
  bubble(t) {
    let end = t.a.length - 1;
    for (;;) {
      let last = 0;
      for (let i = 0; i < end; i++) if (t.gt(i, i + 1)) { t.swap(i, i + 1); last = i; }
      if (last === 0) break;
      end = last;
    }
  },
  insertion(t) {
    for (let i = 1; i < t.a.length; i++) {
      for (let j = i; j > 0 && t.gt(j - 1, j); j--) t.swap(j - 1, j);
    }
  },
  shell(t) {
    for (const gap of [23, 10, 4, 1]) {
      for (let i = gap; i < t.a.length; i++) {
        for (let j = i; j >= gap && t.gt(j - gap, j); j -= gap) t.swap(j - gap, j);
      }
    }
  },
  merge(t) {
    const aux = new Array(t.a.length);
    const rec = (lo, hi) => {
      if (hi - lo < 1) return;
      const mid = (lo + hi) >> 1;
      rec(lo, mid);
      rec(mid + 1, hi);
      // halves already in order? one look and we're done
      if (!t.gt(mid, mid + 1)) return;
      for (let k = lo; k <= hi; k++) aux[k] = t.a[k];
      let i = lo, j = mid + 1;
      for (let k = lo; k <= hi; k++) {
        if (i > mid) t.write(k, aux[j++]);
        else if (j > hi) t.write(k, aux[i++]);
        else {
          // log the compare against the bars' original slots
          t.ev.push(CMP, i, j);
          if (aux[j] < aux[i]) t.write(k, aux[j++]);
          else t.write(k, aux[i++]);
        }
      }
    };
    rec(0, t.a.length - 1);
  },
  quick(t, rng) {
    const rec = (lo, hi) => {
      if (lo >= hi) return;
      const p = lo + int(rng, hi - lo + 1);
      if (p !== hi) t.swap(p, hi);
      let i = lo;
      for (let j = lo; j < hi; j++) {
        if (!t.gt(j, hi)) { if (i !== j) t.swap(i, j); i++; }
      }
      if (i !== hi) t.swap(i, hi);
      rec(lo, i - 1);
      rec(i + 1, hi);
    };
    rec(0, t.a.length - 1);
  },
  selection(t) {
    const n = t.a.length;
    for (let i = 0; i < n - 1; i++) {
      let m = i;
      for (let j = i + 1; j < n; j++) if (t.gt(m, j)) m = j;
      if (m !== i) t.swap(i, m);
    }
  },
  comb(t) {
    const n = t.a.length;
    let gap = n, sorted = false;
    while (!sorted) {
      gap = Math.max(1, Math.floor(gap / 1.3));
      sorted = gap === 1;
      for (let i = 0; i + gap < n; i++) {
        if (t.gt(i, i + gap)) { t.swap(i, i + gap); sorted = false; }
      }
    }
  },
  heap(t) {
    const n = t.a.length;
    const sift = (i, size) => {
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < size && t.gt(l, m)) m = l;
        if (r < size && t.gt(r, m)) m = r;
        if (m === i) return;
        t.swap(i, m);
        i = m;
      }
    };
    for (let i = (n >> 1) - 1; i >= 0; i--) sift(i, n);
    for (let end = n - 1; end > 0; end--) { t.swap(0, end); sift(0, end); }
  },
};

export function run(map, horseId, seed) {
  const t = tracker(map.values);
  sorters[horseId](t, mulberry32(mix(seed, horseId)));
  return { steps: t.ev.length / 3, solved: true, ev: t.ev };
}

// Running cost after k ops under the given going.
export function cumulative(res, going) {
  const move = (goings.find((g) => g.id === going) || goings[0]).moveCost;
  const cum = new Int32Array(res.steps + 1);
  for (let k = 0; k < res.steps; k++) cum[k + 1] = cum[k] + (res.ev[3 * k] === CMP ? 1 : move);
  return cum;
}

export function progress(map, res) {
  const out = new Float32Array(res.steps + 1);
  const a = map.values.slice();
  let p = 0;
  for (let k = 0; k < res.steps; k++) {
    const code = res.ev[3 * k], x = res.ev[3 * k + 1], y = res.ev[3 * k + 2];
    if (code === SWAP) { const tmp = a[x]; a[x] = a[y]; a[y] = tmp; }
    else if (code === WRITE) a[x] = y;
    if (code !== CMP) p = Math.max(p, 1 - inversions(a) / map.inv0);
    out[k + 1] = Math.min(p, 0.985);
  }
  out[res.steps] = 1;
  return out;
}
