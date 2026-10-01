// Sanity checks for the shared race engine, plus a print-out of the
// measured win chances per map so we can see the odds are interesting.
import { MODES, buildRace, formBook, winChances, drawCard, goingsOf, oddsFor, fmtOdds, decimal } from '../shared/race.js';
import { SWAP, WRITE } from '../shared/modes/sorting.js';

let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL', msg); };

for (let seed = 1; seed <= 200; seed++) {
  for (const [modeId, mode] of Object.entries(MODES)) {
    for (const m of mode.maps) {
      const card = { seed: seed * 7919, raceSeed: seed, mode: modeId, map: m.id, going: goingsOf(mode)[0].id, field: mode.horses.map((h) => h.id) };
      const { map, results } = buildRace(card);
      for (const r of results) {
        const p = mode.progress(map, r);
        if (p.length !== r.steps + 1) fail(`${modeId}/${r.id} progress length`);
        if (modeId === 'pathfinding' && r.solved && r.id !== 'wall') {
          const path = r.path;
          if (path[0] !== map.start || path[path.length - 1] !== map.goal) fail(`${r.id} path ends`);
          for (let i = 1; i < path.length; i++) {
            const a = path[i - 1], b = path[i];
            const d = Math.abs((a % map.w) - (b % map.w)) + Math.abs(((a / map.w) | 0) - ((b / map.w) | 0));
            if (d !== 1 || map.walls[b]) fail(`${r.id} path broken on ${m.id} seed ${seed}`);
          }
          if (['bfs', 'astar', 'bidir'].includes(r.id) && path.length - 1 !== map.distGoal[map.start])
            fail(`${r.id} not shortest on ${m.id} seed ${seed}: ${path.length - 1} vs ${map.distGoal[map.start]}`);
        }
        if (modeId === 'pathfinding' && ['bfs', 'astar', 'greedy', 'dfs', 'bidir', 'wastar'].includes(r.id) && !r.solved)
          fail(`${r.id} did not finish on ${m.id}`);
        if (modeId === 'sorting') {
          const a = map.values.slice();
          for (let k = 0; k < r.steps; k++) {
            const [c, x, y] = [r.ev[3 * k], r.ev[3 * k + 1], r.ev[3 * k + 2]];
            if (c === SWAP) [a[x], a[y]] = [a[y], a[x]];
            if (c === WRITE) a[x] = y;
          }
          const want = map.values.slice().sort((x, y) => x - y);
          if (a.join() !== want.join()) fail(`${r.id} did not sort ${m.id} seed ${seed}`);
        }
        if (modeId === 'strings') {
          const got = [];
          for (let k = 1; k < r.hits.length; k += 2) got.push(r.hits[k]);
          if (got.join() !== map.found.join()) fail(`${r.id} found ${got} want ${map.found} on ${m.id}`);
        }
      }
    }
  }
}
console.log(failures ? `${failures} failures` : 'engine checks passed');

if (process.argv.includes('--odds')) {
  for (const [modeId, mode] of Object.entries(MODES)) {
    for (const m of mode.maps) {
      for (const g of goingsOf(mode)) {
        const book = formBook(modeId, m.id, g.id, 300);
        const all = winChances(book, book.ids);
        const line = mode.horses.map((h) => `${h.short} ${(all[h.id] * 100).toFixed(0)}`).join(' ');
        // how often does a random field of six have an odds-on favourite?
        let heavy = 0, favs = 0;
        for (let s = 0; s < 200; s++) {
          const card = drawCard(s * 31 + 1, modeId);
          const p = winChances(book, card.field);
          const top = Math.max(...Object.values(p));
          favs += top;
          if (top > 0.8) heavy++;
        }
        console.log(`${modeId}/${m.id}/${g.id}: ${line} | avg fav ${(favs / 2).toFixed(0)}% | >80%: ${(heavy / 2).toFixed(0)}%`);
      }
    }
  }
}
process.exit(failures ? 1 : 0);
