import { buildRace, makeClock, stepAt, horseInfo, GATE_MS, RACE_MS, LEAD_MS } from '/shared/race.js';
import { html, render, $, $$, CLOTHS, cloth, now, ordinal, fmtPts } from './util.js';
import { PathPanel } from './render/pathfinding.js';
import { SortPanel } from './render/sorting.js';
import { TextPanel } from './render/strings.js';

export function makePanel(modeId, canvas, map, clothColors, result = null, horseId = null) {
  if (modeId === 'pathfinding') return new PathPanel(canvas, map, clothColors, result);
  if (modeId === 'sorting') return new SortPanel(canvas, map, clothColors, result);
  return new TextPanel(canvas, map, clothColors, result, horseId);
}

const DNF_WHY = {
  wall: 'gone round in circles',
  beam: 'beam narrowed to nothing',
};

// The race as it appears on screen: the track, six replays and a caller.
export class RaceView {
  constructor(root, card) {
    this.root = root;
    this.card = card;
    const race = buildRace(card);
    this.map = race.map;
    this.mode = race.mode;
    this.order = race.order;
    this.clock = makeClock(race.results);
    this.runners = race.results.map((r, i) => ({
      ...r,
      n: i + 1,
      info: horseInfo(card.mode, r.id),
      prog: race.mode.progress(race.map, r),
      place: race.order.find((o) => o.id === r.id).place,
      finishAt: this.clock.timeAt(r.ops),
    }));
    this.offAt = null;
    this.lines = [];
    this.leader = null;
    this.lastCall = -Infinity;
    this.called = new Set();
    this.frame = this.frame.bind(this);
    this.onResize = () => this.resize();
  }

  mount() {
    const tied = this.order.filter((o) => o.place === 1).length > 1;
    render(this.root, html`
      <div class="race">
        <div class="track" aria-label="Race track">
          <div class="track-top">
            <span class="track-clock">0.0s</span>
            <span class="track-ops">0 steps</span>
            <span class="track-post">Post</span>
          </div>
          ${this.runners.map((r) => html`
            <div class="lane" data-id="${r.id}">
              <div class="lane-name">${cloth(r.n)} <span>${r.info.short}</span></div>
              <div class="lane-turf">
                <div class="lane-runner">${cloth(r.n, 'cloth-runner')}</div>
              </div>
              <div class="lane-place"></div>
            </div>`)}
          <div class="gate" hidden><span class="gate-n">3</span><span class="gate-sub">Under starter's orders</span></div>
        </div>
        <p class="caller" aria-live="polite"><span class="caller-now">They're going behind the stalls.</span></p>
        <div class="panels mode-${this.card.mode}">
          ${this.runners.map((r) => html`
            <figure class="panel" data-id="${r.id}">
              <figcaption>
                ${cloth(r.n)}
                <span class="panel-name">${r.info.name}</span>
                <span class="panel-ops">0</span>
              </figcaption>
              <canvas></canvas>
              <span class="panel-stamp" hidden></span>
            </figure>`)}
        </div>
        ${tied ? html`<p class="sr-only">Dead heat</p>` : ''}
      </div>`);
    this.track = $('.track', this.root);
    this.gate = $('.gate', this.root);
    this.caller = $('.caller-now', this.root);
    this.clockEl = $('.track-clock', this.root);
    this.opsEl = $('.track-ops', this.root);
    for (const r of this.runners) {
      r.lane = $(`.lane[data-id="${r.id}"]`, this.root);
      r.token = $('.lane-runner', r.lane);
      r.turf = $('.lane-turf', r.lane);
      r.placeEl = $('.lane-place', r.lane);
      r.fig = $(`.panel[data-id="${r.id}"]`, this.root);
      r.opsEl = $('.panel-ops', r.fig);
      r.stamp = $('.panel-stamp', r.fig);
      r.panel = makePanel(this.card.mode, $('canvas', r.fig), this.map, CLOTHS[r.n - 1], r, r.id);
      r.shown = -1;
    }
    this.resize();
    window.addEventListener('resize', this.onResize);
  }

  resize() {
    for (const r of this.runners) {
      r.panel.resize(r.fig.clientWidth);
      r.shown = -1;
      r.turfW = r.turf.clientWidth - r.token.offsetWidth;
    }
    this.paint(this.elapsed ?? -1);
  }

  start(offAtServerMs) {
    this.offAt = offAtServerMs;
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(this.frame);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('resize', this.onResize);
  }

  frame() {
    const t = now() - this.offAt;
    this.paint(t);
    if (t < RACE_MS + 200) this.raf = requestAnimationFrame(this.frame);
  }

  paint(t) {
    this.elapsed = t;
    // the stalls
    if (t < 0) {
      this.gate.hidden = false;
      $('.gate-n', this.gate).textContent = Math.max(1, Math.ceil(-t / 1000));
    } else {
      this.gate.hidden = true;
    }
    const tt = Math.max(0, Math.min(t, RACE_MS));
    const budget = this.clock.opsAt(tt);
    this.clockEl.textContent = `${(tt / 1000).toFixed(1)}s`;
    this.opsEl.textContent = `${fmtPts(Math.floor(budget))} steps`;

    for (const r of this.runners) {
      const step = stepAt(r, budget);
      const finished = step >= r.steps;
      const p = r.prog[step];
      r.token.style.transform = `translateX(${(p * r.turfW).toFixed(1)}px)`;
      if (step !== r.shown) {
        r.panel.draw(step);
        r.shown = step;
        r.opsEl.textContent = fmtPts(Math.min(r.ops, Math.floor(budget)));
      }
      const state = finished ? (r.solved ? 'in' : 'out') : 'running';
      if (r.state !== state) {
        r.state = state;
        r.lane.dataset.state = state;
        r.fig.dataset.state = state;
        if (state === 'in') {
          r.placeEl.textContent = ordinal(r.place);
          r.stamp.textContent = r.place === 1 ? 'Winner' : ordinal(r.place);
          r.stamp.hidden = false;
          r.fig.classList.toggle('won', r.place === 1);
        } else if (state === 'out') {
          r.placeEl.textContent = 'PU';
          r.stamp.textContent = 'Pulled up';
          r.stamp.hidden = false;
        } else {
          r.placeEl.textContent = '';
          r.stamp.hidden = true;
          r.fig.classList.remove('won');
        }
      }
    }
    this.commentate(t);
  }

  say(line, t, force = false) {
    if (!force && t - this.lastCall < 1100) return;
    this.lastCall = t;
    this.caller.textContent = line;
  }

  commentate(t) {
    if (t < 0) return;
    const name = (r) => r.info.short;
    const once = (key, fn) => {
      if (this.called.has(key)) return;
      this.called.add(key);
      fn();
    };
    // finishes trump everything else
    const firsts = this.runners.filter((r) => r.place === 1);
    if (t >= LEAD_MS) {
      once('winner', () => {
        if (firsts.length > 1) this.say(`Dead heat! ${firsts.map(name).join(' and ')} can't be split.`, t, true);
        else this.say(`${name(firsts[0])} wins it in ${fmtPts(firsts[0].ops)} steps!`, t, true);
      });
      const second = this.runners.find((r) => r.place === 2);
      const third = this.runners.find((r) => r.place === 3);
      if (second && t >= second.finishAt + 250 && t - this.lastCall > 900) {
        once('placed', () => this.say(
          third ? `${name(second)} second, ${name(third)} third.` : `${name(second)} comes home second.`, t, true));
      }
      for (const r of this.runners) {
        if (!r.solved && t >= r.finishAt) {
          once('pu' + r.id, () => this.say(`${name(r)} is pulled up${DNF_WHY[r.id] ? ` — ${DNF_WHY[r.id]}` : ''}.`, t, true));
        }
      }
      return;
    }
    once('off', () => this.say("And they're off.", t, true));
    if (t < 900) return;
    const budget = this.clock.opsAt(t);
    let best = null, bestP = -1;
    for (const r of this.runners) {
      const p = r.prog[stepAt(r, budget)];
      if (p > bestP + 0.005) { best = r; bestP = p; }
    }
    for (const r of this.runners) {
      if (!r.solved && t >= r.finishAt) {
        once('pu' + r.id, () => this.say(`${name(r)} is pulled up${DNF_WHY[r.id] ? ` — ${DNF_WHY[r.id]}` : ''}.`, t, true));
      }
    }
    if (best && best !== this.leader) {
      const prev = this.leader;
      if (t - this.lastCall < 1100) return;
      this.leader = best;
      const lines = prev
        ? [`${name(best)} goes past ${name(prev)}.`, `${name(best)} hits the front.`, `Now it's ${name(best)} in front.`]
        : [`${name(best)} breaks well and leads.`, `${name(best)} shows early pace.`];
      this.say(lines[Math.floor(t / 997) % lines.length], t);
    } else if (bestP > 0.75) {
      once('closing', () => this.say(`${name(best)} is closing in on the post…`, t));
    } else if (t > 3200) {
      once('half', () => {
        const chasers = this.runners
          .filter((r) => r !== best)
          .sort((a, b) => b.prog[stepAt(b, budget)] - a.prog[stepAt(a, budget)]);
        if (chasers[0]) this.say(`${name(best)} from ${name(chasers[0])}, the rest strung out behind.`, t);
      });
    }
  }
}

export { GATE_MS };
