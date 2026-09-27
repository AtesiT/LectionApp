// Транспорт: WebSocket с автопереподключением и запасной вариант SSE + REST.
import { emit } from '../core/bus.js';

const tr = {
  mode: 'none',        // ws | sse | none
  ws: null,
  es: null,
  room: null,
  userId: null,
  connected: false,
  closedByUser: true,
  attempts: 0,
  timer: null,
  pending: new Map(),
  reqCounter: 0,
};

export function transportInfo() {
  return { mode: tr.mode, connected: tr.connected, attempts: tr.attempts };
}

export function connect({ room, userId }) {
  tr.room = room;
  tr.userId = userId;
  tr.closedByUser = false;
  clearTimeout(tr.timer);
  tryWebSocket();
}

export function disconnect() {
  tr.closedByUser = true;
  clearTimeout(tr.timer);
  closeSockets();
  setConnected(false, 'closed');
}

function closeSockets() {
  if (tr.ws) {
    try { tr.ws.onclose = null; tr.ws.close(); } catch { /* ignore */ }
    tr.ws = null;
  }
  if (tr.es) {
    try { tr.es.close(); } catch { /* ignore */ }
    tr.es = null;
  }
}

function setConnected(value, reason = '') {
  if (tr.connected === value && reason !== 'closed') return;
  tr.connected = value;
  emit('transport:status', { state: value ? 'online' : (reason === 'closed' ? 'offline' : 'reconnecting'), mode: tr.mode, attempts: tr.attempts });
}

function tryWebSocket() {
  closeSockets();
  if (typeof WebSocket === 'undefined') { trySSE(); return; }
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  const url = `${proto}://${location.host}/ws?room=${encodeURIComponent(tr.room)}&userId=${encodeURIComponent(tr.userId)}`;
  let opened = false;
  let ws;
  try {
    ws = new WebSocket(url);
  } catch {
    trySSE();
    return;
  }
  tr.ws = ws;
  const failTimer = setTimeout(() => { if (!opened) { try { ws.close(); } catch { /* ignore */ } } }, 6000);
  ws.onopen = () => {
    opened = true;
    clearTimeout(failTimer);
    tr.mode = 'ws';
    tr.attempts = 0;
    setConnected(true);
  };
  ws.onmessage = (event) => dispatch(event.data);
  ws.onclose = () => {
    clearTimeout(failTimer);
    if (tr.ws !== ws) return;
    tr.ws = null;
    if (tr.closedByUser) return;
    if (!opened) {
      // WebSocket недоступен (например, прокси) — переходим на SSE
      trySSE();
      return;
    }
    setConnected(false);
    scheduleReconnect();
  };
  ws.onerror = () => { /* onclose последует */ };
}

function trySSE() {
  closeSockets();
  if (typeof EventSource === 'undefined') { scheduleReconnect(); return; }
  const es = new EventSource(`/api/events?room=${encodeURIComponent(tr.room)}&userId=${encodeURIComponent(tr.userId)}`);
  tr.es = es;
  let opened = false;
  es.onopen = () => {
    opened = true;
    tr.mode = 'sse';
    tr.attempts = 0;
    setConnected(true);
  };
  es.onmessage = (event) => dispatch(event.data);
  es.onerror = () => {
    if (tr.es !== es) return;
    es.close();
    tr.es = null;
    if (tr.closedByUser) return;
    setConnected(false);
    scheduleReconnect(opened ? 0 : 1);
  };
}

function scheduleReconnect(extra = 0) {
  clearTimeout(tr.timer);
  tr.attempts += 1 + extra;
  const delay = Math.min(15000, 800 * 2 ** Math.min(5, tr.attempts));
  emit('transport:status', { state: 'reconnecting', mode: tr.mode, attempts: tr.attempts, delay });
  tr.timer = setTimeout(() => {
    if (tr.closedByUser) return;
    emit('transport:reconnect', { attempts: tr.attempts });
    tryWebSocket();
  }, delay);
}

function dispatch(raw) {
  let msg;
  try {
    msg = JSON.parse(raw);
  } catch {
    return;
  }
  if (msg.type === 'reply') {
    const pending = tr.pending.get(msg.reqId);
    if (pending) {
      clearTimeout(pending.timer);
      tr.pending.delete(msg.reqId);
      pending.resolve(msg);
    } else if (msg.ok === false) {
      emit('net:error', msg);
    }
    return;
  }
  emit('net:message', msg);
}

/** Отправляет сообщение серверу. Возвращает Promise с ответом {ok, ...}. */
export function send(msg, { wait = false } = {}) {
  const payload = { ...msg, room: tr.room, userId: tr.userId };
  if (tr.ws && tr.ws.readyState === WebSocket.OPEN) {
    if (!wait) {
      tr.ws.send(JSON.stringify(payload));
      return Promise.resolve({ ok: true });
    }
    const reqId = ++tr.reqCounter;
    payload.reqId = reqId;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { tr.pending.delete(reqId); resolve({ ok: false, error: 'timeout' }); }, 6000);
      tr.pending.set(reqId, { resolve, timer });
      tr.ws.send(JSON.stringify(payload));
    });
  }
  return fetch('/api/message', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: msg.kind === 'leave',
  }).then(async (res) => {
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok) {
      const err = data || { ok: false, error: `HTTP ${res.status}` };
      if (err.error) emit('net:error', err);
      return err;
    }
    return data ?? { ok: true };
  }).catch(() => ({ ok: false, error: 'network' }));
}

export function sendBeaconLeave() {
  if (!tr.room || !tr.userId) return;
  const body = JSON.stringify({ kind: 'leave', room: tr.room, userId: tr.userId });
  try {
    if (navigator.sendBeacon) navigator.sendBeacon('/api/message', new Blob([body], { type: 'application/json' }));
  } catch { /* ignore */ }
}
