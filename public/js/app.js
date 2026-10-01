import * as net from './net.js';
import { html, render, raw, $, $$, esc, syncClock, fmtPts, signed, sparkline, fmtOdds, cloth } from './util.js';
import { MODES, horseInfo, goingsOf } from '/shared/race.js';
import { mountGame, updateGame, unmountGame } from './game.js';

const app = $('#app');
const state = { room: null, rooms: [], screen: null };

const storage = {
  get(k, d = '') { try { return localStorage.getItem(k) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

export const me = () => state.room?.players.find((p) => p.id === state.room.you);
export const isHost = () => state.room && state.room.hostId === state.room.you;
export const send = net.send;

let toastTimer;
export function toast(text) {
  const el = $('#toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 3200);
}

const MODE_LABEL = { mixed: 'Mixed card', pathfinding: 'Pathfinding', sorting: 'Sorting', strings: 'String search' };
export const modeLabel = (id) => MODE_LABEL[id] || id;

// ------------------------------------------------------------- routing

function screenFor(room) {
  if (!room) return 'home';
  if (room.phase === 'lobby') return 'lobby';
  if (room.phase === 'final') return 'final';
  return 'game';
}

function show() {
  const room = state.room;
  const screen = screenFor(room);
  if (screen !== state.screen) {
    if (state.screen === 'game') unmountGame();
    app.onclick = app.onchange = app.onsubmit = app.oninput = null;
    state.screen = screen;
    app.dataset.screen = screen;
    window.scrollTo(0, 0);
    if (screen === 'home') mountHome();
    if (screen === 'lobby') mountLobby();
    if (screen === 'final') mountFinal();
    if (screen === 'game') mountGame(app, room);
  }
  if (screen === 'home') updateHome();
  if (screen === 'lobby') updateLobby();
  if (screen === 'final') updateFinal();
  if (screen === 'game') updateGame(room);
  masthead();
}

function masthead() {
  const el = $('#masthead-room');
  const room = state.room;
  if (!room) { el.innerHTML = ''; return; }
  const p = me();
  render(el, html`
    <span class="mh-item"><span class="mh-label">${room.solo ? 'Solo' : 'Table'}</span> <b class="mono">${room.code}</b></span>
    ${p ? html`<span class="mh-item"><span class="mh-label">Points</span> <b class="mono">${fmtPts(p.balance)}</b></span>` : ''}
  `);
}

// ------------------------------------------------------------- home

function stableTable(modeId) {
  const mode = MODES[modeId];
  return html`
    <div class="stable">
      <h3>${mode.meta.name}</h3>
      <p class="stable-blurb">${mode.meta.blurb}</p>
      <ul class="stable-list">
        ${mode.horses.map((h) => html`<li><b>${h.name}</b> <span class="trainer">${h.trainer}</span></li>`)}
      </ul>
      <p class="stable-courses"><span class="label">Courses</span> ${mode.maps.map((m) => m.name).join(', ')}</p>
    </div>`;
}

function mountHome() {
  const name = storage.get('ab.name');
  render(app, html`
    <section class="home">
      <div class="home-lead">
        <p class="kicker">Six runners · one problem · ten seconds</p>
        <h1 class="headline">Put your points on A*.</h1>
        <p class="lede">
          Pathfinders, sorters and string searchers go head to head on a fresh problem every race.
          Look over the course, read the odds, back a runner or three. Everybody starts with
          <b>100 points</b>; whoever holds the most after the last race takes the table.
        </p>

        <label class="field name-field">
          <span>Name on the ticket</span>
          <input id="name" maxlength="18" autocomplete="nickname" placeholder="e.g. Dijkstra's Cousin" value="${name}">
        </label>

        <div class="tickets">
          <form class="ticket" data-form="create">
            <h2>Open a table</h2>
            <p>You get a four-letter code. Send it to your friends.</p>
            <label class="check"><input type="checkbox" id="public" checked> List it on the board</label>
            <button class="btn btn-primary" type="submit">Open table</button>
          </form>
          <form class="ticket" data-form="join">
            <h2>Join a table</h2>
            <p>Got a code from someone? Pop it in.</p>
            <input id="code" class="code-input" maxlength="4" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD" aria-label="Table code">
            <button class="btn" type="submit">Take a seat</button>
          </form>
          <form class="ticket" data-form="solo">
            <h2>Practise alone</h2>
            <p>No clock on betting. Good for learning the form.</p>
            <button class="btn" type="submit">Ride solo</button>
          </form>
        </div>
      </div>

      <aside class="home-side">
        <section class="board">
          <h2 class="side-head">On the board</h2>
          <div id="room-list"></div>
        </section>
        <section class="rules">
          <h2 class="side-head">House rules</h2>
          <ol>
            <li>Each race puts six algorithms on the same problem. You see the course before you bet.</li>
            <li>Back as many runners as you like, up to what you hold.</li>
            <li>Fewest steps wins. Every runner gets the same clock, so the order you watch is the real order.</li>
            <li>Winning stakes pay at the odds shown. A dead heat splits your stake between the winners.</li>
            <li>Odds are set from a few hundred practice runs on that kind of course, not on this exact one. Spot a mismatch and you've found an edge.</li>
          </ol>
        </section>
      </aside>

      <section class="stables">
        <h2 class="section-head"><span>The stables</span></h2>
        <div class="stables-grid">
          ${stableTable('pathfinding')}
          ${stableTable('sorting')}
          ${stableTable('strings')}
        </div>
      </section>
    </section>`);

  const nameInput = $('#name');
  const getName = () => {
    const n = nameInput.value.trim();
    if (!n) { nameInput.focus(); toast('Put a name on the ticket first.'); return null; }
    storage.set('ab.name', n);
    return n;
  };
  const codeInput = $('#code');
  codeInput.addEventListener('input', () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '');
  });
  const pending = new URLSearchParams(location.search).get('t');
  if (pending) codeInput.value = pending.toUpperCase().slice(0, 4);

  app.onsubmit = (e) => {
    const form = e.target.closest('[data-form]');
    if (!form || state.screen !== 'home') return;
    e.preventDefault();
    const name = getName();
    if (!name) return;
    const kind = form.dataset.form;
    if (kind === 'create') send('create', { name, isPublic: $('#public').checked });
    if (kind === 'solo') send('create', { name, solo: true });
    if (kind === 'join') {
      const code = codeInput.value.trim();
      if (code.length !== 4) { codeInput.focus(); toast('Table codes are four letters.'); return; }
      send('join', { name, code });
    }
  };
  app.onclick = (e) => {
    const b = e.target.closest('[data-join]');
    if (!b || state.screen !== 'home') return;
    const name = getName();
    if (name) send('join', { name, code: b.dataset.join });
  };
  send('list');
}

function updateHome() {
  const el = $('#room-list');
  if (!el) return;
  if (!state.rooms.length) {
    render(el, html`<p class="empty">Nothing running just now. Open a table and it'll show up here.</p>`);
    return;
  }
  render(el, html`
    <ul class="room-list">
      ${state.rooms.map((r) => html`
        <li>
          <span class="mono room-code">${r.code}</span>
          <span class="room-meta">
            <b>${r.host}'s table</b>
            <span>${modeLabel(r.mode)} · ${r.players} seated · ${r.phase === 'lobby' ? 'waiting to start' : `race ${r.round} of ${r.rounds}`}</span>
          </span>
          <button class="btn btn-small" data-join="${r.code}">Join</button>
        </li>`)}
    </ul>`);
}

// ------------------------------------------------------------- lobby

function radios(name, options, current, disabled) {
  return html`
    <div class="seg" role="radiogroup">
      ${options.map(([value, label]) => html`
        <label class="seg-opt">
          <input type="radio" name="${name}" value="${value}" ${raw(String(value) === String(current) ? 'checked' : '')} ${raw(disabled ? 'disabled' : '')}>
          <span>${label}</span>
        </label>`)}
    </div>`;
}

function mountLobby() {
  render(app, html`
    <section class="lobby">
      <div class="lobby-main">
        <p class="kicker" id="lobby-kicker"></p>
        <div class="lobby-code">
          <h1 class="code-big mono" id="lobby-code"></h1>
          <div class="lobby-share" id="lobby-share"></div>
        </div>
        <h2 class="section-head"><span>Seated</span></h2>
        <ul class="seats" id="seats"></ul>
        <div class="chat" id="lobby-chat"></div>
      </div>
      <aside class="lobby-side" id="lobby-side"></aside>
    </section>`);

  app.onclick = (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    const act = a.dataset.action;
    if (act === 'start') send('start');
    if (act === 'leave') leave();
    if (act === 'copy') copyInvite();
  };
  app.onchange = (e) => {
    const r = e.target;
    if (r.type !== 'radio' || !isHost()) return;
    const val = r.name === 'mode' ? r.value : Number(r.value);
    send('settings', { [r.name]: val });
  };
  bindChat($('#lobby-chat'));
}

function inviteUrl() {
  return `${location.origin}/?t=${state.room.code}`;
}

async function copyInvite() {
  try {
    await navigator.clipboard.writeText(inviteUrl());
    toast('Invite link copied.');
  } catch {
    toast(inviteUrl());
  }
}

function seatList(room) {
  return room.players.map((p) => html`
    <li class="${p.connected ? '' : 'away'}">
      <span class="seat-name">${p.name}</span>
      ${p.id === room.hostId ? html`<span class="tag">host</span>` : ''}
      ${p.id === room.you ? html`<span class="tag tag-you">you</span>` : ''}
      ${!p.connected ? html`<span class="tag">stepped out</span>` : ''}
    </li>`);
}

function updateLobby() {
  const room = state.room;
  const host = room.players.find((p) => p.id === room.hostId);
  $('#lobby-kicker').textContent = room.solo ? 'Solo practice' : room.isPublic ? 'Public table' : 'Private table';
  $('#lobby-code').textContent = room.code;
  render($('#lobby-share'), room.solo ? html`<p class="muted">Just you and the bookie.</p>` : html`
    <p class="muted">Send friends the code, or the link:</p>
    <div class="invite"><code>${inviteUrl()}</code><button class="btn btn-small" data-action="copy">Copy</button></div>`);
  render($('#seats'), html`${seatList(room)}`);

  const s = room.settings;
  const lock = !isHost();
  const side = $('#lobby-side');
  if (side.contains(document.activeElement) && document.activeElement.type === 'radio') {
    // don't yank the radio group out from under keyboard users
  }
  render(side, html`
    <h2 class="side-head">Conditions of the meeting</h2>
    <div class="setting">
      <h3>Discipline</h3>
      ${radios('mode', [['mixed', 'Mixed card'], ['pathfinding', 'Pathfinding'], ['sorting', 'Sorting'], ['strings', 'String search']], s.mode, lock)}
      <p class="hint">${s.mode === 'mixed' ? 'A different discipline most races. Keeps the specialists honest.' : MODES[s.mode].meta.blurb}</p>
    </div>
    <div class="setting">
      <h3>Races</h3>
      ${radios('rounds', [[3, '3'], [6, '6'], [9, '9'], [12, '12']], s.rounds, lock)}
    </div>
    ${room.solo ? '' : html`
      <div class="setting">
        <h3>Betting clock</h3>
        ${radios('betSeconds', [[15, '15s'], [30, '30s'], [45, '45s'], [60, '60s']], s.betSeconds, lock)}
        <p class="hint">Betting closes early once everyone has locked in.</p>
      </div>`}
    <div class="lobby-go">
      ${isHost()
        ? html`<button class="btn btn-primary btn-big" data-action="start">${room.solo ? 'Start the card' : 'Call them to post'}</button>`
        : html`<p class="waiting">Waiting for ${host ? host.name : 'the host'} to start.</p>`}
      <button class="btn btn-quiet" data-action="leave">Leave table</button>
    </div>`);
  updateChat($('#lobby-chat'), room);
}

// ------------------------------------------------------------- chat

export function bindChat(el) {
  render(el, html`
    <h2 class="side-head">Rail talk</h2>
    <ol class="chat-log"></ol>
    <form class="chat-form">
      <input maxlength="200" placeholder="Say something to the table" aria-label="Chat message">
      <button class="btn btn-small" type="submit">Send</button>
    </form>`);
  $('form', el).addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('input', el);
    const text = input.value.trim();
    if (text) send('chat', { text });
    input.value = '';
  });
}

export function updateChat(el, room) {
  const log = $('.chat-log', el);
  if (!log) return;
  const key = room.chat.length + ':' + (room.chat.at(-1)?.at || 0);
  if (log.dataset.key === key) return;
  log.dataset.key = key;
  const stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
  render(log, html`${room.chat.length ? room.chat.map((c) => c.name
    ? html`<li><b>${c.name}</b> ${c.text}</li>`
    : html`<li class="chat-note">${c.text}</li>`) : html`<li class="chat-note">Quiet on the rail.</li>`}`);
  if (stick) log.scrollTop = log.scrollHeight;
}

// ------------------------------------------------------------- final

function mountFinal() {
  render(app, html`<section class="final" id="final"></section>`);
  app.onclick = (e) => {
    const a = e.target.closest('[data-action]');
    if (!a) return;
    if (a.dataset.action === 'again') send('again');
    if (a.dataset.action === 'leave') leave();
  };
}

function updateFinal() {
  const room = state.room;
  const players = [...room.players].sort((a, b) => b.balance - a.balance);
  const top = players[0];
  const tie = players.filter((p) => p.balance === top.balance);
  const youWon = tie.some((p) => p.id === room.you);
  let headline;
  if (room.solo) {
    headline = top.balance > 100 ? `You walk away with ${fmtPts(top.balance)} points.`
      : top.balance === 100 ? 'All square. The bookie nods politely.'
      : top.balance > 0 ? `${fmtPts(top.balance)} points left. The bookie thanks you for your custom.`
      : 'Skint. Happens to the best of us.';
  } else if (tie.length > 1) {
    headline = `Dead heat at the top: ${tie.map((p) => p.name).join(' and ')}.`;
  } else {
    headline = youWon ? 'You take the table.' : `${top.name} takes the table.`;
  }
  render($('#final'), html`
    <p class="kicker">Result of the meeting · ${room.history.length} ${room.history.length === 1 ? 'race' : 'races'}</p>
    <h1 class="headline">${headline}</h1>
    <div class="final-grid">
      <section>
        <h2 class="section-head"><span>Final standings</span></h2>
        <table class="table standings-final">
          <thead><tr><th></th><th>Player</th><th class="num">Points</th><th class="num">Net</th><th>Run</th></tr></thead>
          <tbody>
            ${players.map((p, i) => html`
              <tr class="${p.id === room.you ? 'is-you' : ''}">
                <td class="pos">${i + 1}</td>
                <td>${p.name}</td>
                <td class="num mono">${fmtPts(p.balance)}</td>
                <td class="num mono ${p.balance - 100 >= 0 ? 'up' : 'down'}">${signed(p.balance - 100)}</td>
                <td>${raw(sparkline(p.trail, 90, 22))}</td>
              </tr>`)}
          </tbody>
        </table>
      </section>
      <section>
        <h2 class="section-head"><span>The card</span></h2>
        <table class="table history">
          <thead><tr><th>Race</th><th>Discipline</th><th>Course</th><th>Winner</th><th class="num">SP</th></tr></thead>
          <tbody>
            ${room.history.map((h) => html`
              <tr>
                <td class="mono">${h.round}</td>
                <td>${MODES[h.mode].meta.name}</td>
                <td>${MODES[h.mode].maps.find((m) => m.id === h.map).name}</td>
                <td>${h.winners.map((id) => horseInfo(h.mode, id).name).join(' / ')}</td>
                <td class="num mono">${h.odds.map(fmtOdds).join(', ')}</td>
              </tr>`)}
          </tbody>
        </table>
      </section>
    </div>
    <div class="final-actions">
      ${isHost() ? html`<button class="btn btn-primary btn-big" data-action="again">Run it back</button>`
        : html`<p class="waiting">The host can start another card.</p>`}
      <button class="btn btn-quiet" data-action="leave">Leave table</button>
    </div>`);
}

// ------------------------------------------------------------- plumbing

function leave() {
  send('leave');
}

net.on('hello', () => {
  const code = new URLSearchParams(location.search).get('t');
  const name = storage.get('ab.name');
  if (code && name && !state.room) send('join', { code, name });
});
net.on('room', ({ room }) => {
  syncClock(room.serverNow);
  state.room = room;
  if (new URLSearchParams(location.search).get('t') !== room.code) {
    history.replaceState(null, '', `/?t=${room.code}`);
  }
  show();
});
net.on('rooms', ({ rooms }) => {
  state.rooms = rooms;
  if (state.screen === 'home') updateHome();
});
net.on('left', () => {
  state.room = null;
  history.replaceState(null, '', '/');
  show();
});
net.on('error', ({ message }) => {
  toast(message);
  if (!state.room && new URLSearchParams(location.search).get('t')) history.replaceState(null, '', '/');
});
net.on('status', (s) => {
  $('#conn').hidden = s === 'online';
  if (s === 'elsewhere') $('#conn').textContent = 'This table is open in another tab. Close this one.';
});

$('.wordmark').addEventListener('click', (e) => {
  e.preventDefault();
  if (!state.room) return;
  if (confirm('Leave this table? Your points stay behind.')) leave();
});

setInterval(() => { if (state.screen === 'home') send('list'); }, 5000);

show();
net.connect();
