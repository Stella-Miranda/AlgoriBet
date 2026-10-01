import { mulberry32, mix, int, shuffle } from '../rng.js';

// Grid is W x H, odd sizes so maze corridors land on odd coordinates.
const W = 39;
const H = 23;
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

export const horses = [
  { id: 'bfs', name: 'Breadth-First', short: 'BFS', trainer: 'E. F. Moore, 1959',
    note: 'Floods outward evenly. Never lost, rarely quick.' },
  { id: 'dfs', name: 'Depth-First', short: 'DFS', trainer: 'C. P. Trémaux, 1882',
    note: 'Picks a corridor and commits. Either brilliant or hopeless.' },
  { id: 'astar', name: 'A-Star', short: 'A*', trainer: 'Hart, Nilsson & Raphael, 1968',
    note: 'Manhattan heuristic. The steady favourite in most going.' },
  { id: 'greedy', name: 'Greedy Best-First', short: 'GBF', trainer: 'Doran & Michie, 1966',
    note: 'Runs straight at the goal. Loves open ground, hates dead ends.' },
  { id: 'bidir', name: 'Bidirectional BFS', short: 'BiBFS', trainer: 'I. Pohl, 1971',
    note: 'Searches from both ends and hopes to meet in the middle.' },
  { id: 'wall', name: 'Wall Follower', short: 'Wall', trainer: 'Folklore',
    note: 'Right hand on the wall. Can circle an island forever.' },
  { id: 'wastar', name: 'Weighted A*', short: 'wA*', trainer: 'I. Pohl, 1970',
    note: 'A* with the heuristic doubled. Trades a little accuracy for pace.' },
  { id: 'beam', name: 'Beam Search', short: 'Beam', trainer: 'B. Lowerre, 1976',
    note: 'Keeps only the four most promising cells per ring. Fast, or lost.' },
];

export const maps = [
  { id: 'perfect', name: 'Backtracker maze', note: 'One true path, lots of dead ends.' },
  { id: 'braided', name: 'Braided maze', note: 'Dead ends knocked through, so there are loops.' },
  { id: 'paddock', name: 'Open paddock', note: 'Mostly open ground with scattered rocks.' },
  { id: 'halls', name: 'Divided halls', note: 'Recursive division. Big rooms, narrow doors.' },
];

export const meta = {
  id: 'pathfinding',
  name: 'Pathfinding',
  unit: 'cells expanded',
  blurb: 'Get from the gate to the post. Fewest cells expanded wins.',
};

// ---------------------------------------------------------------- maps

function carvePerfect(rng, g) {
  g.fill(1);
  const stack = [[1, 1]];
  g[1 * W + 1] = 0;
  const dirs = [0, 1, 2, 3];
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    shuffle(rng, dirs);
    let moved = false;
    for (const d of dirs) {
      const nx = x + DX[d] * 2, ny = y + DY[d] * 2;
      if (nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1 && g[ny * W + nx] === 1) {
        g[(y + DY[d]) * W + (x + DX[d])] = 0;
        g[ny * W + nx] = 0;
        stack.push([nx, ny]);
        moved = true;
        break;
      }
    }
    if (!moved) stack.pop();
  }
}

function braid(rng, g, chance) {
  for (let y = 1; y < H - 1; y += 2) {
    for (let x = 1; x < W - 1; x += 2) {
      let open = 0;
      for (let d = 0; d < 4; d++) if (g[(y + DY[d]) * W + x + DX[d]] === 0) open++;
      if (open !== 1 || rng() > chance) continue;
      const opts = [];
      for (let d = 0; d < 4; d++) {
        const wx = x + DX[d], wy = y + DY[d];
        const nx = x + DX[d] * 2, ny = y + DY[d] * 2;
        if (nx > 0 && ny > 0 && nx < W - 1 && ny < H - 1 && g[wy * W + wx] === 1) opts.push(wy * W + wx);
      }
      if (opts.length) g[opts[int(rng, opts.length)]] = 0;
    }
  }
}

function paddock(rng, g) {
  g.fill(0);
  for (let x = 0; x < W; x++) { g[x] = 1; g[(H - 1) * W + x] = 1; }
  for (let y = 0; y < H; y++) { g[y * W] = 1; g[y * W + W - 1] = 1; }
  // rocks: short random strokes rather than salt-and-pepper noise
  const strokes = 70 + int(rng, 40);
  for (let i = 0; i < strokes; i++) {
    let x = 1 + int(rng, W - 2), y = 1 + int(rng, H - 2);
    const d = int(rng, 4), len = 1 + int(rng, 5);
    for (let k = 0; k < len; k++) {
      if (x <= 0 || y <= 0 || x >= W - 1 || y >= H - 1) break;
      g[y * W + x] = 1;
      x += DX[d]; y += DY[d];
    }
  }
}

function halls(rng, g) {
  g.fill(0);
  for (let x = 0; x < W; x++) { g[x] = 1; g[(H - 1) * W + x] = 1; }
  for (let y = 0; y < H; y++) { g[y * W] = 1; g[y * W + W - 1] = 1; }
  const divide = (x0, y0, x1, y1, depth) => {
    // chamber interior spans [x0..x1] x [y0..y1]
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (w < 5 || h < 5 || depth > 5) return;
    const horizontal = h > w ? true : w > h ? false : rng() < 0.5;
    if (horizontal) {
      const ys = [];
      for (let y = y0 + 1; y < y1; y += 2) ys.push(y);
      const wy = ys[int(rng, ys.length)];
      const xs = [];
      for (let x = x0; x <= x1; x += 2) xs.push(x);
      const door = xs[int(rng, xs.length)];
      for (let x = x0; x <= x1; x++) if (x !== door) g[wy * W + x] = 1;
      divide(x0, y0, x1, wy - 1, depth + 1);
      divide(x0, wy + 1, x1, y1, depth + 1);
    } else {
      const xs = [];
      for (let x = x0 + 1; x < x1; x += 2) xs.push(x);
      const wx = xs[int(rng, xs.length)];
      const ys = [];
      for (let y = y0; y <= y1; y += 2) ys.push(y);
      const door = ys[int(rng, ys.length)];
      for (let y = y0; y <= y1; y++) if (y !== door) g[y * W + wx] = 1;
      divide(x0, y0, wx - 1, y1, depth + 1);
      divide(wx + 1, y0, x1, y1, depth + 1);
    }
  };
  divide(1, 1, W - 2, H - 2, 0);
}

function bfsDist(g, from) {
  const dist = new Int32Array(W * H).fill(-1);
  const q = new Int32Array(W * H);
  let head = 0, tail = 0;
  q[tail++] = from;
  dist[from] = 0;
  while (head < tail) {
    const c = q[head++];
    const x = c % W, y = (c / W) | 0;
    for (let d = 0; d < 4; d++) {
      const n = (y + DY[d]) * W + x + DX[d];
      if (g[n] === 0 && dist[n] < 0) { dist[n] = dist[c] + 1; q[tail++] = n; }
    }
  }
  return dist;
}

const STYLES = {
  edges: 'gate on the left, post on the right',
  corners: 'corner to corner',
  centre: 'gate in the middle, post on the rail',
  scatter: 'gate and post anywhere',
};

const oddCell = (rng, lo, hi) => lo + 2 * int(rng, Math.floor((hi - lo) / 2) + 1);

function placeEnds(rng, g, style) {
  for (let tries = 0; tries < 200; tries++) {
    let sx, sy, gx, gy;
    if (style === 'edges') {
      sx = 1; sy = oddCell(rng, 1, H - 2);
      gx = W - 2; gy = oddCell(rng, 1, H - 2);
    } else if (style === 'corners') {
      const flip = rng() < 0.5;
      sx = 1; sy = flip ? 1 : H - 2;
      gx = W - 2; gy = flip ? H - 2 : 1;
    } else if (style === 'centre') {
      sx = oddCell(rng, 15, W - 16); sy = oddCell(rng, 9, H - 10);
      const side = int(rng, 4);
      gx = side === 0 ? 1 : side === 1 ? W - 2 : oddCell(rng, 1, W - 2);
      gy = side === 2 ? 1 : side === 3 ? H - 2 : oddCell(rng, 1, H - 2);
    } else {
      sx = oddCell(rng, 1, W - 2); sy = oddCell(rng, 1, H - 2);
      gx = oddCell(rng, 1, W - 2); gy = oddCell(rng, 1, H - 2);
      if (Math.abs(sx - gx) + Math.abs(sy - gy) < 30) continue;
    }
    if (rng() < 0.5 && style !== 'centre') { sx = W - 1 - sx; gx = W - 1 - gx; }
    const start = sy * W + sx, goal = gy * W + gx;
    if (start === goal) continue;
    g[start] = 0;
    g[goal] = 0;
    return { start, goal };
  }
  return { start: W + 1, goal: (H - 2) * W + W - 2 };
}

export function generate(seed, mapId) {
  const rng = mulberry32(mix(seed, 'map'));
  const g = new Uint8Array(W * H);
  const style = Object.keys(STYLES)[int(rng, 4)];
  for (let attempt = 0; attempt < 50; attempt++) {
    if (mapId === 'perfect') carvePerfect(rng, g);
    else if (mapId === 'braided') { carvePerfect(rng, g); braid(rng, g, 0.65); }
    else if (mapId === 'paddock') paddock(rng, g);
    else halls(rng, g);

    const { start, goal } = placeEnds(rng, g, style);
    const distGoal = bfsDist(g, goal);
    if (distGoal[start] > 0) {
      return {
        mode: 'pathfinding', type: mapId, style, w: W, h: H,
        walls: g, start, goal, distGoal, distStart: bfsDist(g, start),
      };
    }
  }
  throw new Error('could not build a connected map');
}

export function describe(map) {
  let open = 0;
  for (let i = 0; i < map.walls.length; i++) if (!map.walls[i]) open++;
  return `${map.w} × ${map.h}, ${STYLES[map.style]} · ${open} open cells · shortest route ${map.distGoal[map.start]}`;
}

// ---------------------------------------------------------------- horses

// Binary heap keyed on (a, b, c), smallest first.
class Heap {
  constructor() { this.v = []; this.k = []; }
  get size() { return this.v.length; }
  less(i, j) {
    const a = this.k[i], b = this.k[j];
    return a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];
  }
  swap(i, j) {
    [this.v[i], this.v[j]] = [this.v[j], this.v[i]];
    [this.k[i], this.k[j]] = [this.k[j], this.k[i]];
  }
  push(val, key) {
    this.v.push(val); this.k.push(key);
    let i = this.v.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(i, p)) break;
      this.swap(i, p); i = p;
    }
  }
  pop() {
    const top = this.v[0];
    const last = this.v.length - 1;
    this.swap(0, last);
    this.v.pop(); this.k.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1, r = l + 1;
      let m = i;
      if (l < this.v.length && this.less(l, m)) m = l;
      if (r < this.v.length && this.less(r, m)) m = r;
      if (m === i) break;
      this.swap(i, m); i = m;
    }
    return top;
  }
}

function tracePath(parent, end) {
  const path = [];
  for (let c = end; c >= 0; c = parent[c]) path.push(c);
  return path.reverse();
}

function bestFirst(map, order, score) {
  const { walls, start, goal } = map;
  const parent = new Int32Array(W * H).fill(-1);
  const g = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const heap = new Heap();
  const gx = goal % W, gy = (goal / W) | 0;
  const h = (c) => Math.abs((c % W) - gx) + Math.abs(((c / W) | 0) - gy);
  let n = 0;
  g[start] = 0;
  heap.push(start, score(0, h(start), n++));
  const ev = [];
  while (heap.size) {
    const c = heap.pop();
    if (closed[c]) continue;
    closed[c] = 1;
    ev.push(c);
    if (c === goal) return { steps: ev.length, solved: true, ev, path: tracePath(parent, goal) };
    const x = c % W, y = (c / W) | 0;
    for (const d of order) {
      const nb = (y + DY[d]) * W + x + DX[d];
      if (walls[nb] || closed[nb]) continue;
      const ng = g[c] + 1;
      if (g[nb] < 0 || ng < g[nb]) {
        g[nb] = ng;
        parent[nb] = c;
        heap.push(nb, score(ng, h(nb), n++));
      }
    }
  }
  return { steps: ev.length, solved: false, ev, path: [] };
}

function beam(map, order, width) {
  const { walls, start, goal } = map;
  const parent = new Int32Array(W * H).fill(-1);
  const seen = new Uint8Array(W * H);
  const gx = goal % W, gy = (goal / W) | 0;
  const h = (c) => Math.abs((c % W) - gx) + Math.abs(((c / W) | 0) - gy);
  let ring = [start];
  seen[start] = 1;
  const ev = [];
  while (ring.length) {
    const next = [];
    for (const c of ring) {
      ev.push(c);
      if (c === goal) return { steps: ev.length, solved: true, ev, path: tracePath(parent, goal) };
      const x = c % W, y = (c / W) | 0;
      for (const d of order) {
        const nb = (y + DY[d]) * W + x + DX[d];
        if (walls[nb] || seen[nb]) continue;
        seen[nb] = 1;
        parent[nb] = c;
        next.push(nb);
      }
    }
    // stable sort keeps the shuffled neighbour order as the tie-break
    ring = next.map((c, i) => [h(c), i, c]).sort((a, b) => a[0] - b[0] || a[1] - b[1])
      .slice(0, width).map((t) => t[2]);
  }
  return { steps: ev.length, solved: false, ev, path: [] };
}

function bfs(map, order) {
  const { walls, start, goal } = map;
  const parent = new Int32Array(W * H).fill(-1);
  const seen = new Uint8Array(W * H);
  const q = [start];
  seen[start] = 1;
  const ev = [];
  for (let head = 0; head < q.length; head++) {
    const c = q[head];
    ev.push(c);
    if (c === goal) return { steps: ev.length, solved: true, ev, path: tracePath(parent, goal) };
    const x = c % W, y = (c / W) | 0;
    for (const d of order) {
      const nb = (y + DY[d]) * W + x + DX[d];
      if (walls[nb] || seen[nb]) continue;
      seen[nb] = 1;
      parent[nb] = c;
      q.push(nb);
    }
  }
  return { steps: ev.length, solved: false, ev, path: [] };
}

function dfs(map, rng) {
  const { walls, start, goal } = map;
  const parent = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const stack = [start];
  const ev = [];
  const dirs = [0, 1, 2, 3];
  while (stack.length) {
    const c = stack.pop();
    if (closed[c]) continue;
    closed[c] = 1;
    ev.push(c);
    if (c === goal) return { steps: ev.length, solved: true, ev, path: tracePath(parent, goal) };
    const x = c % W, y = (c / W) | 0;
    shuffle(rng, dirs);
    for (const d of dirs) {
      const nb = (y + DY[d]) * W + x + DX[d];
      if (walls[nb] || closed[nb]) continue;
      parent[nb] = c;
      stack.push(nb);
    }
  }
  return { steps: ev.length, solved: false, ev, path: [] };
}

function bidir(map, order) {
  const { walls, start, goal } = map;
  const side = new Int8Array(W * H); // 1 = from start, 2 = from goal
  const parent = new Int32Array(W * H).fill(-1);
  const qa = [start], qb = [goal];
  let ha = 0, hb = 0;
  side[start] = 1;
  side[goal] = 2;
  const ev = [];
  const sides = [];
  const join = (a, b) => {
    // a belongs to the start tree, b to the goal tree
    const left = tracePath(parent, a);
    const right = [];
    for (let c = b; c >= 0; c = parent[c]) right.push(c);
    return left.concat(right);
  };
  while (ha < qa.length || hb < qb.length) {
    const useA = hb >= qb.length || (ha < qa.length && qa.length - ha <= qb.length - hb);
    const c = useA ? qa[ha++] : qb[hb++];
    const mine = useA ? 1 : 2;
    ev.push(c);
    sides.push(mine);
    const x = c % W, y = (c / W) | 0;
    for (const d of order) {
      const nb = (y + DY[d]) * W + x + DX[d];
      if (walls[nb]) continue;
      if (side[nb] && side[nb] !== mine) {
        const path = useA ? join(c, nb) : join(nb, c);
        return { steps: ev.length, solved: true, ev, sides, path };
      }
      if (side[nb]) continue;
      side[nb] = mine;
      parent[nb] = c;
      (useA ? qa : qb).push(nb);
    }
  }
  return { steps: ev.length, solved: false, ev, sides, path: [] };
}

function wallFollower(map) {
  const { walls, start, goal } = map;
  const seen = new Uint8Array(W * H * 4);
  // face east, toward the post
  let c = start, dir = 0;
  const ev = [];
  const cap = W * H * 4;
  const open = (cell, d) => !walls[(((cell / W) | 0) + DY[d]) * W + (cell % W) + DX[d]];
  while (ev.length < cap) {
    ev.push(c);
    if (c === goal) return { steps: ev.length, solved: true, ev, path: ev.slice() };
    const key = c * 4 + dir;
    if (seen[key]) break; // same square, same heading: we're going round in circles
    seen[key] = 1;
    const tries = [(dir + 1) & 3, dir, (dir + 3) & 3, (dir + 2) & 3];
    for (const d of tries) {
      if (open(c, d)) {
        dir = d;
        c = (((c / W) | 0) + DY[d]) * W + (c % W) + DX[d];
        break;
      }
    }
  }
  return { steps: ev.length, solved: false, ev, path: [] };
}

export function run(map, horseId, seed) {
  const rng = mulberry32(mix(seed, horseId));
  const order = shuffle(rng, [0, 1, 2, 3]);
  switch (horseId) {
    case 'bfs': return bfs(map, order);
    case 'dfs': return dfs(map, rng);
    case 'astar': return bestFirst(map, order, (g, h, n) => [g + h, h, n]);
    case 'greedy': return bestFirst(map, order, (g, h, n) => [h, n, 0]);
    case 'bidir': return bidir(map, order);
    case 'wall': return wallFollower(map);
    case 'wastar': return bestFirst(map, order, (g, h, n) => [g + 2 * h, h, n]);
    case 'beam': return beam(map, order, 4);
  }
  throw new Error('unknown horse ' + horseId);
}

// How far along does this horse look after k operations? 0..1, never goes back.
export function progress(map, res) {
  const out = new Float32Array(res.steps + 1);
  const D = map.distGoal[map.start];
  let fwd = 0, bwd = 0;
  for (let k = 0; k < res.steps; k++) {
    const c = res.ev[k];
    if (res.sides && res.sides[k] === 2) {
      bwd = Math.max(bwd, 1 - Math.min(map.distStart[c], D) / D);
    } else {
      fwd = Math.max(fwd, 1 - Math.min(map.distGoal[c], D) / D);
    }
    out[k + 1] = Math.min(0.985, fwd + bwd);
  }
  if (res.solved) out[res.steps] = 1;
  return out;
}
