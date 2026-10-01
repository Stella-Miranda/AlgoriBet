import { html, render, raw, $, $$, cloth, CLOTHS, fmtOdds, decimal, fmtPts, signed, ordinal, now, sparkline } from './util.js';
import { MODES, horseInfo, goingsOf, GATE_MS, RACE_MS } from '/shared/race.js';
import { RaceView, makePanel } from './race-view.js';
import { me, send, toast, bindChat, updateChat, modeLabel } from './app.js';

let g = null;

export function mountGame(app, room) {
  render(app, html`
    <section class="game">
      <div class="tote" id="tote"></div>
      <div class="game-grid">
        <div class="game-main" id="game-main"></div>
        <aside class="game-side">
          <section class="slip" id="slip"></section>
          <section class="standings" id="standings"></section>
          <section class="chat" id="game-chat"></section>
          <button class="btn btn-quiet leave" data-action="leave">Leave table</button>
        </aside>
      </div>
    </section>`);
  g = { room, mainKey: null, view: null, preview: null, bets: {} };
  bindChat($('#game-chat'));

  app.onclick = (e) => {
    const t = e.target.closest('[data-step],[data-action],[data-quick]');
    if (!t) return;
    if (t.dataset.step) bump(t.closest('tr').dataset.id, Number(t.dataset.step));
    else if (t.dataset.quick) setStake(t.closest('tr').dataset.id, Number(t.dataset.quick), true);
    else if (t.dataset.action === 'lock') send('lock', { locked: !me().locked });
    else if (t.dataset.action === 'ready') send('ready');
    else if (t.dataset.action === 'clear') clearBets();
    else if (t.dataset.action === 'leave' && confirm('Leave this table? Your points stay behind.')) send('leave');
  };
  app.onchange = (e) => {
    const input = e.target.closest('input[data-stake]');
    if (input) setStake(input.closest('tr').dataset.id, parseInt(input.value, 10) || 0);
  };
  app.oninput = (e) => {
    const input = e.target.closest('input[data-stake]');
    if (!input) return;
    input.value = input.value.replace(/[^0-9]/g, '');
    showReturns(input.closest('tr'), parseInt(input.value, 10) || 0);
  };
  g.timer = setInterval(tickClock, 200);
  g.onResize = () => g.preview && sizePreview();
  window.addEventListener('resize', g.onResize);
}

export function unmountGame() {
  if (!g) return;
  clearInterval(g.timer);
  window.removeEventListener('resize', g.onResize);
  g.view?.destroy();
  g = null;
}

export function updateGame(room) {
  g.room = room;
  const roundKey = `${room.round}:${room.card?.seed}`;
  const racing = room.phase === 'racing' || room.phase === 'result';
  if (!racing) {
    if (g.mainKey !== 'bet' + roundKey) mountBetting(roundKey);
    updateBetting();
  } else {
    if (g.mainKey !== 'race' + roundKey) mountRace(roundKey);
    updateResult();
  }
  updateTote();
  updateSlip();
  updateStandings();
  updateChat($('#game-chat'), room);
  tickClock();
}

// ------------------------------------------------------------- tote board

function updateTote() {
  const { room } = g;
  const card = room.card;
  if (!card) return;
  const mode = MODES[card.mode];
  const map = mode.maps.find((m) => m.id === card.map);
  const going = goingsOf(mode).find((x) => x.id === card.going);
  const key = `${room.round}:${card.seed}`;
  const tote = $('#tote');
  if (tote.dataset.key === key) return;
  tote.dataset.key = key;
  render(tote, html`
    <div class="tote-cell"><span class="tote-label">Race</span><span class="tote-val">${room.round}<small>/${room.settings.rounds}</small></span></div>
    <div class="tote-cell"><span class="tote-label">Discipline</span><span class="tote-val">${mode.meta.name}</span></div>
    <div class="tote-cell tote-wide"><span class="tote-label">Course</span><span class="tote-val">${map.name}</span></div>
    <div class="tote-cell"><span class="tote-label">Going</span><span class="tote-val">${going.name}</span></div>
    <div class="tote-cell tote-clock"><span class="tote-label" id="tote-status"></span><span class="tote-val" id="tote-time"></span></div>`);
}

function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function tickClock() {
  if (!g) return;
  const { room } = g;
  const status = $('#tote-status'), time = $('#tote-time');
  if (!status) return;
  const t = now();
  let label = '', val = '';
  if (room.phase === 'betting') {
    if (room.phaseEnd) {
      label = 'Betting closes';
      val = mmss(room.phaseEnd - t);
    } else {
      label = 'Betting';
      val = 'Open';
    }
  } else if (room.phase === 'racing') {
    const since = t - room.phaseStart;
    if (since < GATE_MS) { label = 'Off in'; val = `${Math.ceil((GATE_MS - since) / 1000)}`; }
    else if (since < GATE_MS + RACE_MS) { label = 'Race'; val = 'Running'; }
    else { label = 'Race'; val = 'Weighed in'; }
  } else if (room.phase === 'result') {
    label = room.round >= room.settings.rounds ? 'Final standings in' : 'Next race in';
    val = mmss(room.phaseEnd - t);
    const btn = $('[data-action="ready"]');
    if (btn && !btn.disabled) btn.querySelector('.count').textContent = Math.max(0, Math.ceil((room.phaseEnd - t) / 1000));
  }
  status.textContent = label;
  time.textContent = val;
  status.closest('.tote-cell').classList.toggle('urgent', room.phase === 'betting' && room.phaseEnd && room.phaseEnd - t < 6000);
}

// ------------------------------------------------------------- betting

function runnerInfo() {
  const card = g.room.card;
  return card.field.map((id, i) => ({ id, n: i + 1, info: horseInfo(card.mode, id) }));
}

function mountBetting(key) {
  g.view?.destroy();
  g.view = null;
  g.mainKey = 'bet' + key;
  const { room } = g;
  const card = room.card;
  const mode = MODES[card.mode];
  const mapMeta = mode.maps.find((m) => m.id === card.map);
  const going = goingsOf(mode).find((x) => x.id === card.going);
  const map = mode.generate(card.seed, card.map);
  g.bets = { ...room.myBets };

  const main = $('#game-main');
  render(main, html`
    <div class="course">
      <header class="course-head">
        <div>
          <p class="kicker">Race ${room.round} · ${mode.meta.name} · ${mode.meta.unit}</p>
          <h2 class="course-name">${mapMeta.name}</h2>
          <p class="course-note">${mapMeta.note} ${mode.describe(map)}.</p>
        </div>
        ${mode.goings ? html`
          <div class="going going-${going.id}">
            <span class="going-label">Going</span>
            <b>${going.name}</b>
            <span>${going.note}</span>
          </div>` : ''}
      </header>
      <div class="course-preview mode-${card.mode}"><canvas></canvas></div>
    </div>
    <table class="runners">
      <thead>
        <tr><th class="col-no">No.</th><th>Runner</th><th class="col-form">Form</th><th class="num">Odds</th><th class="num col-pool">Pool</th><th class="col-stake">Your stake</th></tr>
      </thead>
      <tbody>
        ${runnerInfo().map((r) => html`
          <tr data-id="${r.id}">
            <td class="col-no">${cloth(r.n)}</td>
            <td class="runner">
              <b>${r.info.name}</b>
              <span class="trainer">${r.info.trainer}</span>
              <span class="note">${r.info.note}</span>
            </td>
            <td class="col-form mono form"></td>
            <td class="num odds mono">${fmtOdds(room.odds[r.id])}</td>
            <td class="num col-pool mono pool"></td>
            <td class="col-stake">
              <div class="stepper">
                <button type="button" data-step="-5" aria-label="Five less on ${r.info.name}">−</button>
                <input data-stake type="text" inputmode="numeric" value="0" aria-label="Stake on ${r.info.name}">
                <button type="button" data-step="5" aria-label="Five more on ${r.info.name}">+</button>
              </div>
              <div class="quick">
                <button type="button" data-quick="10">10</button>
                <button type="button" data-quick="25">25</button>
                <button type="button" data-quick="-1">all</button>
              </div>
              <span class="returns"></span>
            </td>
          </tr>`)}
      </tbody>
    </table>`);
  const canvas = $('.course-preview canvas', main);
  g.preview = makePanel(card.mode, canvas, map, { ...CLOTHS[0], head: '#1d1a15' });
  sizePreview();
}

function sizePreview() {
  const wrap = $('.course-preview');
  if (!wrap || !g.preview) return;
  g.preview.resize(wrap.clientWidth);
  g.preview.draw(0);
}

function available() {
  const p = me();
  const used = Object.values(g.bets).reduce((a, b) => a + b, 0);
  return p.balance - used;
}

function setStake(id, amount, quick = false) {
  const p = me();
  if (!p || p.locked || g.room.phase !== 'betting') return;
  const others = Object.entries(g.bets).reduce((a, [h, v]) => a + (h === id ? 0 : v), 0);
  const room = p.balance - others;
  if (quick) amount = amount < 0 ? room : (g.bets[id] || 0) + amount;
  if (amount > room && !(quick && amount === room)) toast(`You've only got ${fmtPts(room)} to play with.`);
  amount = Math.max(0, Math.min(Math.floor(amount), room));
  if (amount > 0) g.bets[id] = amount;
  else delete g.bets[id];
  send('bet', { horse: id, amount });
  updateBetting();
  updateSlip();
}

function bump(id, by) {
  setStake(id, (g.bets[id] || 0) + by);
}

function clearBets() {
  for (const id of Object.keys(g.bets)) setStake(id, 0);
}

function showReturns(tr, stake) {
  const el = $('.returns', tr);
  const odds = g.room.odds[tr.dataset.id];
  el.textContent = stake > 0 ? `returns ${fmtPts(Math.floor(stake * decimal(odds)))}` : '';
}

function updateBetting() {
  const { room } = g;
  const p = me();
  if (!p) return;
  // the server is the source of truth once we're not mid-edit
  const focused = document.activeElement?.matches?.('input[data-stake]') ? document.activeElement : null;
  if (!focused) g.bets = { ...room.myBets };
  const locked = p.locked || room.phase !== 'betting';
  for (const tr of $$('.runners tbody tr')) {
    const id = tr.dataset.id;
    const stake = g.bets[id] || 0;
    const input = $('input', tr);
    if (input !== focused) input.value = stake;
    input.disabled = locked;
    for (const b of $$('button', tr)) b.disabled = locked;
    tr.classList.toggle('backed', stake > 0);
    showReturns(tr, stake);
    $('.pool', tr).textContent = fmtPts(room.pool[id] || 0);
    const form = room.form[id];
    $('.form', tr).textContent = form && form.length ? form.join('-') : '—';
  }
}

// ------------------------------------------------------------- race

function mountRace(key) {
  g.mainKey = 'race' + key;
  g.preview = null;
  g.view?.destroy();
  const main = $('#game-main');
  render(main, html`<div id="race-root"></div>`);
  g.view = new RaceView($('#race-root'), g.room.card);
  g.view.mount();
  g.view.start(g.room.phaseStart + GATE_MS);
  // joined during the result? jump straight to the finish
  if (g.room.phase === 'result') g.view.start(now() - RACE_MS - 1000);
}

function updateResult() {
  const { room } = g;
  const track = $('.track');
  if (!track) return;
  let board = $('.official', track);
  if (room.phase !== 'result' || !room.result) {
    board?.remove();
    return;
  }
  const p = me();
  const payout = room.result.payouts.find((x) => x.id === room.you);
  const nums = Object.fromEntries(room.card.field.map((id, i) => [id, i + 1]));
  const ready = room.players.filter((x) => x.connected && x.ready).length;
  const total = room.players.filter((x) => x.connected).length;
  let line;
  if (!payout || !payout.staked) line = html`No bet this race.`;
  else if (payout.back > 0) line = html`Your ticket returns <b>${fmtPts(payout.back)}</b> <span class="up">(${signed(payout.back - payout.staked)})</span>`;
  else line = html`Your ticket is torn up <span class="down">(${signed(-payout.staked)})</span>`;
  if (!board) {
    board = document.createElement('div');
    board.className = 'official';
    track.appendChild(board);
  }
  const key = `${room.round}:${p?.ready}:${ready}`;
  if (board.dataset.key === key) return;
  board.dataset.key = key;
  render(board, html`
    <div class="official-head"><span>Result · Race ${room.round}</span><span class="stamp">Official</span></div>
    <ol class="official-list">
      ${room.result.order.map((r) => html`
        <li class="${r.place === 1 ? 'first' : ''}">
          <span class="o-place">${r.place ? ordinal(r.place) : 'PU'}</span>
          ${cloth(nums[r.id])}
          <span class="o-name">${horseInfo(room.card.mode, r.id).name}</span>
          <span class="o-ops">${r.solved ? `${fmtPts(r.ops)} steps` : 'pulled up'}</span>
          <span class="o-odds">${fmtOdds(room.odds[r.id])}</span>
        </li>`)}
    </ol>
    <div class="official-foot">
      <span>${line}</span>
      ${p?.ready
        ? html`<span class="waiting-small">Waiting on ${total - ready} more…</span>`
        : html`<button class="btn btn-small btn-amber" data-action="ready">${room.round >= room.settings.rounds ? 'Final standings' : 'Next race'} <span class="count"></span></button>`}
    </div>`);
}

// ------------------------------------------------------------- side

function updateSlip() {
  const { room } = g;
  const p = me();
  const el = $('#slip');
  if (!p || !room.card) return;
  const bets = room.phase === 'betting' ? g.bets : room.myBets;
  const runners = runnerInfo().filter((r) => bets[r.id]);
  const staked = runners.reduce((a, r) => a + bets[r.id], 0);
  const others = room.players.filter((x) => x.id !== p.id && x.connected);
  const waitingOn = others.filter((x) => !x.locked);
  // the lock button lives across updates so a click never lands on a node
  // that a broadcast has just replaced
  if (!$('.slip-body', el)) {
    el.innerHTML = `<div class="slip-body"></div>
      <button class="btn btn-block" data-action="lock" hidden></button>
      <p class="slip-note" hidden></p>`;
  }
  const lockBtn = $('[data-action="lock"]', el);
  const note = $('.slip-note', el);
  let btnText = null, noteText = null;
  if (room.phase === 'betting') {
    if (p.balance <= 0) {
      noteText = "You're skint. Sit back and enjoy the racing.";
    } else {
      btnText = p.locked ? 'Locked in — change' : room.solo ? 'Lock in and race' : staked ? 'Lock in' : 'Lock in (no bet)';
      if (!room.solo) {
        noteText = waitingOn.length ? `Waiting on ${waitingOn.map((x) => x.name).join(', ')}.`
          : others.length ? 'Everyone else is in.' : 'Nobody else at the table yet.';
      }
    }
  } else if (room.phase === 'racing') {
    noteText = staked ? 'Bets are closed. Good luck.' : 'Watching this one from the rail.';
  }
  lockBtn.hidden = btnText === null;
  if (btnText !== null && lockBtn.textContent !== btnText) lockBtn.textContent = btnText;
  lockBtn.classList.toggle('btn-primary', !p.locked);
  note.hidden = noteText === null;
  if (noteText !== null) note.textContent = noteText;
  render($('.slip-body', el), html`
    <h2 class="side-head">Your ticket ${staked && room.phase === 'betting' && !p.locked ? html`<button class="link" data-action="clear">clear</button>` : ''}</h2>
    ${runners.length ? html`
      <ul class="slip-lines">
        ${runners.map((r) => html`
          <li>
            ${cloth(r.n)}
            <span class="slip-name">${r.info.short}</span>
            <span class="slip-at mono">${fmtPts(bets[r.id])} @ ${fmtOdds(room.odds[r.id])}</span>
            <span class="slip-ret mono">${fmtPts(Math.floor(bets[r.id] * decimal(room.odds[r.id])))}</span>
          </li>`)}
      </ul>` : html`<p class="slip-empty">${room.phase === 'betting' ? 'Nothing on yet. Pick a runner from the card.' : 'No bet this race.'}</p>`}
    <dl class="slip-sum">
      <div><dt>Staked</dt><dd class="mono">${fmtPts(staked)}</dd></div>
      <div><dt>${room.phase === 'betting' ? 'Left over' : 'In hand'}</dt><dd class="mono">${fmtPts(room.phase === 'betting' ? p.balance - staked : p.balance)}</dd></div>
    </dl>`);
}

function updateStandings() {
  const { room } = g;
  const nums = room.card ? Object.fromEntries(room.card.field.map((id, i) => [id, i + 1])) : {};
  const players = [...room.players].sort((a, b) => b.balance - a.balance);
  const showBets = room.phase === 'racing' || room.phase === 'result';
  render($('#standings'), html`
    <h2 class="side-head">Standings</h2>
    <ol class="standings-list">
      ${players.map((p, i) => html`
        <li class="${p.id === room.you ? 'is-you' : ''} ${p.connected ? '' : 'away'}">
          <span class="s-pos">${i + 1}</span>
          <span class="s-name">${p.name}${p.id === room.you ? html` <small>(you)</small>` : ''}</span>
          <span class="s-bets">${showBets && p.bets
            ? Object.keys(p.bets).map((id) => cloth(nums[id], 'cloth-mini'))
            : room.phase === 'betting' ? html`<span class="s-state">${p.locked ? 'in' : '…'}</span>` : ''}</span>
          <span class="s-pts mono">${fmtPts(p.balance)}</span>
          ${room.phase === 'result' && p.lastDelta !== null
            ? html`<span class="s-delta mono ${p.lastDelta >= 0 ? 'up' : 'down'}">${signed(p.lastDelta)}</span>`
            : html`<span class="s-spark">${raw(sparkline(p.trail, 44, 14))}</span>`}
        </li>`)}
    </ol>`);
}
