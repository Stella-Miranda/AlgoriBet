// One WebSocket, reconnecting quietly when it drops.

const listeners = new Map();
let ws = null;
let queue = [];
let retry = 0;

function pid() {
  let id = null;
  try { id = localStorage.getItem('ab.pid'); } catch {}
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, '0')).join('');
    try { localStorage.setItem('ab.pid', id); } catch {}
  }
  return id;
}

export function on(type, fn) {
  if (!listeners.has(type)) listeners.set(type, []);
  listeners.get(type).push(fn);
}

function emit(type, data) {
  for (const fn of listeners.get(type) || []) fn(data);
}

export function send(type, data = {}) {
  const msg = JSON.stringify({ type, ...data });
  if (ws && ws.readyState === 1) ws.send(msg);
  else queue.push(msg);
}

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}/ws`);
  ws.addEventListener('open', () => {
    retry = 0;
    ws.send(JSON.stringify({ type: 'hello', pid: pid() }));
    const pending = queue;
    queue = [];
    pending.forEach((m) => ws.send(m));
    emit('status', 'online');
  });
  ws.addEventListener('message', (e) => {
    let msg;
    try { msg = JSON.parse(e.data); } catch { return; }
    emit(msg.type, msg);
  });
  ws.addEventListener('close', (e) => {
    emit('status', 'offline');
    if (e.code === 4000) { emit('status', 'elsewhere'); return; }
    retry = Math.min(retry + 1, 6);
    setTimeout(connect, 300 * 2 ** retry);
  });
}
