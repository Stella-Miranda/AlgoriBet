import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import {
  MODES, MODE_IDS, drawCard, buildRace, winners, formBook, winChances, oddsFor,
  decimal, goingsOf, GATE_MS, RACE_MS, STARTING_POINTS,
} from './shared/race.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 3000;

const RESULT_MS = 9000;
const MAX_PLAYERS = 12;
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

// ------------------------------------------------------------ static files

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  let base = path.join(ROOT, 'public');
  if (rel.startsWith('/shared/')) {
    base = path.join(ROOT, 'shared');
    rel = rel.slice('/shared'.length);
  }
  if (rel === '/' || !path.extname(rel)) rel = '/index.html';
  const file = path.normalize(path.join(base, rel));
  if (!file.startsWith(base)) {
    res.writeHead(403).end();
    return;
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(data);
  });
}

// ------------------------------------------------------------ form books

const books = new Map();
function bookFor(card) {
  const key = `${card.mode}/${card.map}/${card.going}`;
  if (!books.has(key)) books.set(key, formBook(card.mode, card.map, card.going));
  return books.get(key);
}

function warmBooks() {
  const t = Date.now();
  for (const modeId of MODE_IDS) {
    const mode = MODES[modeId];
    for (const m of mode.maps) for (const g of goingsOf(mode)) bookFor({ mode: modeId, map: m.id, going: g.id });
  }
  console.log(`form books ready (${books.size} of them) in ${Date.now() - t}ms`);
}

// ------------------------------------------------------------ rooms

const rooms = new Map();
const sockets = new Map(); // pid -> ws
const randInt = () => crypto.randomInt(0, 2 ** 31);

function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 4; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

function cleanName(name) {
  const n = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 18);
  return n || 'Anonymous';
}

class Room {
  constructor({ isPublic, solo }) {
    this.code = newCode();
    this.isPublic = !!isPublic && !solo;
    this.solo = !!solo;
    this.hostId = null;
    this.players = new Map();
    this.settings = { mode: 'mixed', rounds: 6, betSeconds: 30 };
    this.chat = [];
    this.history = [];
    this.form = {};
    this.emptySince = Date.now();
    this.reset();
    rooms.set(this.code, this);
  }

  reset() {
    this.phase = 'lobby';
    this.round = 0;
    this.card = null;
    this.race = null;
    this.odds = null;
    this.result = null;
    this.phaseStart = Date.now();
    this.phaseEnd = null;
    this.history = [];
    this.form = {};
    this.lastModes = [];
    clearTimeout(this.timer);
    for (const p of this.players.values()) {
      p.balance = STARTING_POINTS;
      p.bets = {};
      p.locked = false;
      p.ready = false;
      p.lastDelta = null;
      p.trail = [STARTING_POINTS];
    }
  }

  add(pid, name) {
    let p = this.players.get(pid);
    if (!p) {
      if (this.players.size >= MAX_PLAYERS) throw new Error('That table is full.');
      if (this.solo && this.players.size >= 1) throw new Error('That is a private solo table.');
      p = {
        id: pid, name, balance: STARTING_POINTS, bets: {}, locked: false, ready: false,
        lastDelta: null, trail: [STARTING_POINTS], connected: true, joinedRound: this.round,
      };
      this.players.set(pid, p);
      if (this.phase !== 'lobby') this.say(null, `${name} pulled up a chair.`);
    }
    p.name = name;
    p.connected = true;
    if (!this.hostId || !this.players.get(this.hostId)?.connected) this.hostId = pid;
    this.emptySince = null;
    this.broadcast();
  }

  remove(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    this.players.delete(pid);
    if (this.phase !== 'lobby') this.say(null, `${p.name} left the table.`);
    this.fixHost();
    if (!this.connectedCount()) this.emptySince = Date.now();
    this.maybeAdvance();
    this.broadcast();
  }

  disconnect(pid) {
    const p = this.players.get(pid);
    if (!p) return;
    p.connected = false;
    this.fixHost();
    if (!this.connectedCount()) this.emptySince = Date.now();
    this.maybeAdvance();
    this.broadcast();
  }

  fixHost() {
    if (this.players.get(this.hostId)?.connected) return;
    const next = [...this.players.values()].find((p) => p.connected);
    this.hostId = next ? next.id : null;
  }

  connectedCount() {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  say(from, text) {
    const p = from && this.players.get(from);
    this.chat.push({ name: p ? p.name : null, text: String(text).slice(0, 240), at: Date.now() });
    if (this.chat.length > 60) this.chat.shift();
  }

  // ---------------------------------------------------------- phases

  setPhase(phase, ms) {
    clearTimeout(this.timer);
    this.phase = phase;
    this.phaseStart = Date.now();
    this.phaseEnd = ms ? this.phaseStart + ms : null;
    if (ms) this.timer = setTimeout(() => this.tick(), ms);
    this.broadcast();
  }

  tick() {
    if (this.phase === 'betting') this.off();
    else if (this.phase === 'racing') this.settle();
    else if (this.phase === 'result') this.nextRound();
  }

  start() {
    this.reset();
    this.nextRound();
  }

  pickMode() {
    if (this.settings.mode !== 'mixed') return this.settings.mode;
    // don't serve the same mode three times running
    let options = MODE_IDS;
    const [a, b] = this.lastModes.slice(-2);
    if (a && a === b) options = MODE_IDS.filter((m) => m !== a);
    return options[crypto.randomInt(options.length)];
  }

  nextRound() {
    const solvent = [...this.players.values()].some((p) => p.balance > 0);
    if (this.round >= this.settings.rounds || !solvent) {
      this.finish();
      return;
    }
    this.round++;
    const modeId = this.pickMode();
    this.lastModes.push(modeId);
    this.card = drawCard(randInt(), modeId, randInt());
    const chances = winChances(bookFor(this.card), this.card.field);
    this.odds = Object.fromEntries(this.card.field.map((id) => [id, oddsFor(chances[id])]));
    this.race = null;
    this.result = null;
    for (const p of this.players.values()) {
      p.bets = {};
      p.ready = false;
      p.locked = p.balance <= 0;
    }
    const ms = this.solo || !this.settings.betSeconds ? null : this.settings.betSeconds * 1000;
    this.setPhase('betting', ms);
  }

  off() {
    if (this.phase !== 'betting') return;
    this.race = buildRace(this.card);
    for (const p of this.players.values()) {
      const staked = Object.values(p.bets).reduce((a, b) => a + b, 0);
      p.balance -= staked;
      p.locked = true;
    }
    this.setPhase('racing', GATE_MS + RACE_MS + 900);
  }

  settle() {
    const order = this.race.order;
    const won = winners(order);
    const payouts = [];
    for (const p of this.players.values()) {
      const staked = Object.values(p.bets).reduce((a, b) => a + b, 0);
      let back = 0;
      for (const id of won) {
        const stake = p.bets[id] || 0;
        // dead heat: the stake is split between the horses that tied
        back += (stake / won.length) * decimal(this.odds[id]);
      }
      back = Math.floor(back);
      p.balance += back;
      p.lastDelta = staked || back ? back - staked : null;
      p.trail.push(p.balance);
      payouts.push({ id: p.id, staked, back });
    }
    for (const r of order) {
      const f = (this.form[r.id] ||= []);
      f.push(r.place ? String(r.place) : 'P');
      if (f.length > 6) f.shift();
    }
    this.result = {
      order: order.map((r) => ({ id: r.id, ops: r.ops, solved: r.solved, place: r.place })),
      winners: won,
      payouts,
    };
    this.history.push({
      round: this.round, mode: this.card.mode, map: this.card.map, going: this.card.going,
      winners: won, odds: won.map((id) => this.odds[id]),
    });
    this.setPhase('result', RESULT_MS);
  }

  finish() {
    this.card = null;
    this.setPhase('final', null);
  }

  maybeAdvance() {
    const active = [...this.players.values()].filter((p) => p.connected);
    if (!active.length) return;
    if (this.phase === 'betting' && active.every((p) => p.locked)) this.off();
    else if (this.phase === 'result' && active.every((p) => p.ready)) this.nextRound();
  }

  // ---------------------------------------------------------- actions

  bet(p, horse, amount) {
    if (this.phase !== 'betting' || p.locked) return;
    if (!this.card.field.includes(horse)) return;
    amount = Math.max(0, Math.floor(Number(amount) || 0));
    const others = Object.entries(p.bets).reduce((a, [h, v]) => a + (h === horse ? 0 : v), 0);
    amount = Math.min(amount, p.balance - others);
    if (amount > 0) p.bets[horse] = amount;
    else delete p.bets[horse];
    this.broadcast();
  }

  // ---------------------------------------------------------- views

  view(pid) {
    const me = this.players.get(pid);
    const showBets = this.phase === 'racing' || this.phase === 'result';
    const pool = {};
    if (this.card) {
      for (const id of this.card.field) pool[id] = 0;
      for (const p of this.players.values()) for (const [h, v] of Object.entries(p.bets)) pool[h] += v;
    }
    const card = this.card && {
      ...this.card,
      raceSeed: this.phase === 'betting' ? null : this.card.raceSeed,
    };
    return {
      code: this.code,
      isPublic: this.isPublic,
      solo: this.solo,
      hostId: this.hostId,
      you: pid,
      phase: this.phase,
      phaseStart: this.phaseStart,
      phaseEnd: this.phaseEnd,
      serverNow: Date.now(),
      settings: this.settings,
      round: this.round,
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        balance: p.balance,
        connected: p.connected,
        locked: p.locked,
        ready: p.ready,
        lastDelta: p.lastDelta,
        trail: p.trail,
        staked: Object.values(p.bets).reduce((a, b) => a + b, 0),
        bets: showBets || p.id === pid ? p.bets : null,
      })),
      card,
      odds: this.odds,
      pool,
      form: this.form,
      result: this.phase === 'result' || this.phase === 'final' ? this.result : null,
      history: this.history,
      chat: this.chat,
      myBets: me ? me.bets : {},
    };
  }

  broadcast() {
    for (const pid of this.players.keys()) send(pid, { type: 'room', room: this.view(pid) });
  }

  listing() {
    const host = this.players.get(this.hostId);
    return {
      code: this.code,
      host: host ? host.name : '—',
      players: this.connectedCount(),
      phase: this.phase,
      round: this.round,
      rounds: this.settings.rounds,
      mode: this.settings.mode,
    };
  }
}

// ------------------------------------------------------------ sockets

const where = new Map(); // pid -> room code

function send(pid, msg) {
  const ws = sockets.get(pid);
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg));
}

function publicRooms() {
  return [...rooms.values()]
    .filter((r) => r.isPublic && r.connectedCount() > 0)
    .map((r) => r.listing())
    .slice(0, 20);
}

function leaveRoom(pid) {
  const code = where.get(pid);
  where.delete(pid);
  const room = code && rooms.get(code);
  if (room) room.remove(pid);
}

function joinRoom(pid, name, room) {
  const prev = where.get(pid);
  if (prev && prev !== room.code) leaveRoom(pid);
  room.add(pid, name);
  where.set(pid, room.code);
}

const handlers = {
  list(pid) {
    send(pid, { type: 'rooms', rooms: publicRooms() });
  },
  create(pid, msg) {
    const room = new Room({ isPublic: msg.isPublic, solo: msg.solo });
    if (room.solo) room.settings.betSeconds = 0;
    joinRoom(pid, cleanName(msg.name), room);
  },
  join(pid, msg) {
    const room = rooms.get(String(msg.code || '').toUpperCase().trim());
    if (!room) throw new Error('No table with that code. Check the letters?');
    joinRoom(pid, cleanName(msg.name), room);
  },
  leave(pid) {
    leaveRoom(pid);
    send(pid, { type: 'left' });
  },
  settings(pid, msg, room) {
    if (!room || room.hostId !== pid || room.phase !== 'lobby') return;
    const s = room.settings;
    if (msg.mode === 'mixed' || MODE_IDS.includes(msg.mode)) s.mode = msg.mode;
    if ([3, 6, 9, 12].includes(msg.rounds)) s.rounds = msg.rounds;
    if (!room.solo && [15, 30, 45, 60].includes(msg.betSeconds)) s.betSeconds = msg.betSeconds;
    room.broadcast();
  },
  start(pid, msg, room) {
    if (!room || room.hostId !== pid || room.phase !== 'lobby') return;
    room.start();
  },
  again(pid, msg, room) {
    if (!room || room.hostId !== pid || room.phase !== 'final') return;
    room.reset();
    room.broadcast();
  },
  bet(pid, msg, room) {
    const p = room && room.players.get(pid);
    if (p) room.bet(p, String(msg.horse), msg.amount);
  },
  lock(pid, msg, room) {
    const p = room && room.players.get(pid);
    if (!p || room.phase !== 'betting' || p.balance <= 0) return;
    p.locked = !!msg.locked;
    room.broadcast();
    room.maybeAdvance();
  },
  ready(pid, msg, room) {
    const p = room && room.players.get(pid);
    if (!p || room.phase !== 'result') return;
    p.ready = true;
    room.broadcast();
    room.maybeAdvance();
  },
  chat(pid, msg, room) {
    const text = String(msg.text || '').trim();
    if (!room || !text) return;
    room.say(pid, text);
    room.broadcast();
  },
};

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 4096 });

wss.on('connection', (ws) => {
  let pid = null;
  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (msg.type === 'hello') {
      pid = /^[a-z0-9]{8,32}$/i.test(msg.pid) ? msg.pid : crypto.randomBytes(8).toString('hex');
      const old = sockets.get(pid);
      if (old && old !== ws) old.close(4000, 'opened elsewhere');
      sockets.set(pid, ws);
      send(pid, { type: 'hello', pid });
      // back from a dropped connection? put them straight back at their table
      const room = rooms.get(where.get(pid));
      if (room && room.players.has(pid)) room.add(pid, room.players.get(pid).name);
      else where.delete(pid);
      return;
    }
    if (!pid || !handlers[msg.type]) return;
    const room = rooms.get(where.get(pid));
    try {
      handlers[msg.type](pid, msg, room);
    } catch (err) {
      send(pid, { type: 'error', message: err.message });
    }
  });
  ws.on('close', () => {
    if (!pid || sockets.get(pid) !== ws) return;
    sockets.delete(pid);
    const room = rooms.get(where.get(pid));
    if (room) room.disconnect(pid);
  });
});

// Tidy up: drop players who walked away from a lobby, and dead rooms.
setInterval(() => {
  const now = Date.now();
  for (const room of rooms.values()) {
    if (room.emptySince && now - room.emptySince > 10 * 60 * 1000) {
      clearTimeout(room.timer);
      for (const pid of room.players.keys()) where.delete(pid);
      rooms.delete(room.code);
    }
  }
}, 30 * 1000);

warmBooks();
server.listen(PORT, () => {
  console.log(`AlgoriBet is taking bets on http://localhost:${PORT}`);
});
