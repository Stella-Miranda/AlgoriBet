import * as pathfinding from './modes/pathfinding.js';
import * as sorting from './modes/sorting.js';
import * as strings from './modes/strings.js';
import { mulberry32, mix, int, shuffle } from './rng.js';

export const MODES = { pathfinding, sorting, strings };
export const MODE_IDS = Object.keys(MODES);
export const FIELD_SIZE = 6;

// Timing of the race itself (after the gates open).
// Same clock for every horse: they all spend steps at one shared rate, so the
// finish order on screen is always the true order by step count.
export const LEAD_MS = 6500; // the winner crosses the line here
export const RACE_MS = 10000; // the last horse is in by here
export const GATE_MS = 3000; // countdown before the off

export const STARTING_POINTS = 100;

const DEFAULT_GOING = [{ id: 'good', name: 'Good', note: 'Every step costs one.' }];
export const goingsOf = (mode) => mode.goings || DEFAULT_GOING;

export function horseInfo(modeId, horseId) {
  return MODES[modeId].horses.find((h) => h.id === horseId);
}

// Everything a race needs, decided up front from one seed.
// { seed, raceSeed, mode, map, going, field: [horseId x6] }
// `seed` builds the map and is public while betting is open. `raceSeed` drives
// the horses' own coin flips (tie-breaks, random pivots) and is only handed
// out when the gates open, so it must not be derivable from `seed`.
export function drawCard(seed, modeId, raceSeed) {
  const rng = mulberry32(mix(seed, 'card'));
  const mode = MODES[modeId];
  const goings = goingsOf(mode);
  return {
    seed,
    raceSeed,
    mode: modeId,
    map: mode.maps[int(rng, mode.maps.length)].id,
    going: goings[int(rng, goings.length)].id,
    field: shuffle(rng, mode.horses.map((h) => h.id)).slice(0, FIELD_SIZE),
  };
}

// Runs every horse in the field.
// Each result: { id, steps, ops, cum, solved, ...trace } where `steps` counts
// trace events and `ops` is what they cost under the going (the race score).
export function buildRace(card) {
  const mode = MODES[card.mode];
  const map = mode.generate(card.seed, card.map);
  const results = card.field.map((id) => {
    const r = mode.run(map, id, card.raceSeed);
    const cum = mode.cumulative ? mode.cumulative(r, card.going) : null;
    return { id, ...r, ops: cum ? cum[r.steps] : r.steps, cum };
  });
  return { mode, map, results, order: finishOrder(results) };
}

// Positions with dead heats: [{ id, ops, solved, place }], place starts at 1.
export function finishOrder(results) {
  const sorted = results
    .map((r) => ({ id: r.id, ops: r.ops, solved: r.solved }))
    .sort((a, b) => (a.solved !== b.solved ? (a.solved ? -1 : 1) : a.ops - b.ops));
  let place = 0;
  sorted.forEach((r, i) => {
    const prev = sorted[i - 1];
    if (!prev || prev.ops !== r.ops || prev.solved !== r.solved) place = i + 1;
    r.place = r.solved ? place : null;
  });
  return sorted;
}

export function winners(order) {
  return order.filter((r) => r.place === 1).map((r) => r.id);
}

export function makeClock(results) {
  const solved = results.filter((r) => r.solved).map((r) => r.ops);
  const lead = Math.max(1, solved.length ? Math.min(...solved) : 1);
  const last = Math.max(lead, ...results.map((r) => r.ops));
  const ratio = last / lead;
  const tail = RACE_MS - LEAD_MS;
  return {
    lead, last,
    opsAt(t) {
      if (t <= 0) return 0;
      if (t <= LEAD_MS) return (lead * t) / LEAD_MS;
      if (ratio <= 1) return lead;
      return Math.min(last, lead * Math.pow(ratio, Math.min(1, (t - LEAD_MS) / tail)));
    },
    timeAt(ops) {
      if (ops <= lead) return (ops / lead) * LEAD_MS;
      if (ratio <= 1) return LEAD_MS;
      return LEAD_MS + (Math.log(ops / lead) / Math.log(ratio)) * tail;
    },
  };
}

// Index of the last trace event affordable with `budget` ops.
export function stepAt(res, budget) {
  if (budget >= res.ops) return res.steps;
  if (!res.cum) return Math.floor(budget);
  let lo = 0, hi = res.steps;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (res.cum[mid] <= budget) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

// ------------------------------------------------------------------ odds

// Fractional ladder, the way a bookmaker would chalk it up.
export const LADDER = [
  [1, 10], [1, 8], [1, 6], [1, 5], [1, 4], [2, 7], [1, 3], [2, 5], [1, 2], [4, 7],
  [4, 6], [4, 5], [10, 11], [1, 1], [6, 5], [11, 8], [6, 4], [13, 8], [7, 4], [2, 1],
  [9, 4], [5, 2], [11, 4], [3, 1], [7, 2], [4, 1], [9, 2], [5, 1], [6, 1], [7, 1],
  [8, 1], [10, 1], [12, 1], [14, 1], [16, 1], [20, 1], [25, 1], [33, 1], [40, 1], [50, 1],
];

export const MARGIN = 0.12;

export function oddsFor(p) {
  const offered = (1 - MARGIN) / Math.max(p, 1e-3) - 1;
  let best = LADDER[0];
  for (const o of LADDER) if (o[0] / o[1] <= offered) best = o;
  return best;
}

export const decimal = ([n, d]) => 1 + n / d;
export const fmtOdds = ([n, d]) => (n === d ? 'Evens' : `${n}-${d}`);

// Form book for one map type + going: run the whole stable over a few hundred
// random cards and keep every horse's score, so the odds for any field of six
// can be read off afterwards without re-running anything.
export function formBook(modeId, mapId, goingId, samples = 300, baseSeed = 7) {
  const mode = MODES[modeId];
  const ids = mode.horses.map((h) => h.id);
  const rng = mulberry32(mix(baseSeed, modeId + mapId + goingId));
  const rows = [];
  for (let s = 0; s < samples; s++) {
    const seed = int(rng, 2 ** 31);
    const card = { seed, raceSeed: mix(seed, 'race'), mode: modeId, map: mapId, going: goingId, field: ids };
    const { results } = buildRace(card);
    rows.push(results.map((r) => (r.solved ? r.ops : Infinity)));
  }
  return { ids, rows };
}

export function winChances(book, field) {
  const cols = field.map((id) => book.ids.indexOf(id));
  const wins = new Array(field.length).fill(0);
  for (const row of book.rows) {
    let best = Infinity;
    for (const c of cols) best = Math.min(best, row[c]);
    const tied = cols.map((c, i) => (row[c] === best ? i : -1)).filter((i) => i >= 0);
    for (const i of tied) wins[i] += 1 / tied.length;
  }
  const n = book.rows.length, k = field.length;
  return Object.fromEntries(field.map((id, i) => [id, (wins[i] + 0.5) / (n + 0.5 * k)]));
}
