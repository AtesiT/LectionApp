// Совместная сессия: вход, комнаты, участники, роли, лента действий,
// синхронизация состояния, режим «следовать за ведущим», AFK, уведомления.
import { $, el, escapeHtml, formatTime, throttle, debounce, loadJSON, saveJSON } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { t, getLang, toggleLang } from '../core/i18n.js';
import { state, subscribe, syncableState, replaceState, activeObject } from '../core/store.js';
import * as transport from './transport.js';
import { toast } from '../ui/toast.js';
import { renderObjectPreview } from '../scene/preview.js';
import { togglePeek, closePeek } from '../ui/peek.js';

export const session = {
  userId: null, userName: '', avatar: '🙂', room: null, hostId: null, users: [], frozen: false,
  connected: false, lanUrl: '', followHost: false, joinedAt: 0, transport: 'none',
};

export const AVATARS = ['🙂', '😎', '🤖', '🦊', '🐱', '🐼', '🦄', '🐸', '🐙', '🚀', '🎧', '🌟', '🍕', '🧙', '👾', '🐧'];

export const isHost = () => Boolean(session.userId) && session.userId === session.hostId;
export const me = () => session.users.find((u) => u.id === session.userId) ?? null;
export const userById = (id) => session.users.find((u) => u.id === id) ?? null;

let pingTimer = null;
let afkTimer = null;
let afk = false;
let lastHostSig = null;
let wasReconnecting = false;
const showcaseNodes = new Map();

// ---------------------------------------------------------------------------
// Инициализация
// ---------------------------------------------------------------------------

export function init() {
  setupEntry();
  subscribe(onLocalState);
  on('net:message', onMessage);
  on('net:error', onNetError);
  on('transport:status', onTransportStatus);
  on('feed', ({ action, vars }) => sendAction(action, vars));
  on('lang', () => { renderUsers(true); renderFeedAll(); updateSessionInfo(); });

  $('#followHostToggle')?.addEventListener('change', (e) => {
    session.followHost = e.target.checked;
    lastHostSig = null;
    transport.send({ kind: 'follow', on: session.followHost });
    if (session.followHost) followHostNow();
  });
  $('#leaveBtn')?.addEventListener('click', () => leave());
  $('#copyLinkBtn')?.addEventListener('click', copyLink);
  $('#notifyBtn')?.addEventListener('click', requestNotifications);
  $('#announceClose')?.addEventListener('click', () => { $('#announceBar').hidden = true; });

  window.addEventListener('pagehide', () => { if (session.connected) transport.sendBeaconLeave(); });
  ['pointerdown', 'keydown', 'pointermove', 'touchstart'].forEach((ev) => window.addEventListener(ev, activity, { passive: true }));
  setInterval(updateTimes, 30000);
}

// ---------------------------------------------------------------------------
// Экран входа
// ---------------------------------------------------------------------------

function setupEntry() {
  const form = $('#entryForm');
  const nameInput = $('#entryUserName');
  const roomInput = $('#entryRoom');
  const grid = $('#avatarGrid');
  const profile = loadJSON('mp2:profile', {});
  const params = new URLSearchParams(location.search);

  if (profile.name) nameInput.value = profile.name;
  session.avatar = profile.avatar || AVATARS[Math.floor(Math.random() * AVATARS.length)];
  roomInput.value = (params.get('room') || profile.room || '').toUpperCase();

  grid.textContent = '';
  for (const a of AVATARS) {
    const btn = el('button', { type: 'button', class: `avatar-btn ${a === session.avatar ? 'active' : ''}`, role: 'radio', 'aria-checked': a === session.avatar ? 'true' : 'false', text: a });
    btn.addEventListener('click', () => {
      session.avatar = a;
      grid.querySelectorAll('.avatar-btn').forEach((b) => { b.classList.toggle('active', b === btn); b.setAttribute('aria-checked', b === btn ? 'true' : 'false'); });
    });
    grid.append(btn);
  }

  let createRoom = false;
  $('#entryCreateRoom')?.addEventListener('click', () => {
    createRoom = true;
    roomInput.value = '';
    form.requestSubmit();
  });
  $('#entryLangBtn')?.addEventListener('click', () => toggleLang());
  roomInput.addEventListener('input', () => { roomInput.value = roomInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.classList.add('invalid');
      setEntryStatus(t('entry.nameRequired'), false);
      nameInput.focus();
      return;
    }
    await join({ name, room: roomInput.value.trim(), createRoom });
    createRoom = false;
  });
  nameInput.addEventListener('input', () => nameInput.classList.remove('invalid'));

  checkServer();
  nameInput.focus();
}

async function checkServer() {
  if (location.protocol === 'file:') {
    setEntryStatus(t('entry.fileProtocol'), false);
    return;
  }
  try {
    const res = await fetch('/api/room', { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data.multiplayer) throw new Error('bad');
    session.lanUrl = data.lanUrl || '';
    const users = (data.rooms || []).reduce((acc, r) => acc + r.users, 0);
    setEntryStatus(t('entry.serverOk', { rooms: (data.rooms || []).length, users }), true);
    renderRoomsList(data.rooms || []);
  } catch {
    setEntryStatus(t('entry.serverFail'), false);
  }
}

function renderRoomsList(rooms) {
  const root = $('#roomsList');
  if (!root) return;
  root.textContent = '';
  const active = rooms.filter((r) => r.users > 0);
  if (!active.length) return;
  root.append(el('span', { class: 'rooms-label', text: t('entry.rooms') }));
  for (const r of active) {
    const btn = el('button', { type: 'button', class: 'room-pill', text: `${r.code} · ${r.users}${r.host ? ` · 👑 ${r.host}` : ''}` });
    btn.addEventListener('click', () => { $('#entryRoom').value = r.code; });
    root.append(btn);
  }
}

function setEntryStatus(text, ok) {
  const node = $('#entryStatus');
  if (!node) return;
  node.textContent = text;
  node.classList.toggle('online', ok);
  node.classList.toggle('offline', !ok);
}

function setEntryBusy(busy) {
  const btn = $('#entryConnectBtn');
  if (btn) { btn.disabled = busy; btn.setAttribute('aria-busy', busy ? 'true' : 'false'); }
}

// ---------------------------------------------------------------------------
// Вход / выход
// ---------------------------------------------------------------------------

export async function join({ name, room = '', createRoom = false, rejoin = false }) {
  setEntryBusy(true);
  setEntryStatus(t('entry.connecting'), true);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  try {
    const res = await fetch('/api/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, avatar: session.avatar, tz, room, createRoom, lang: getLang(),
        userId: rejoin ? session.userId : undefined, state: syncableState(),
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    session.userId = data.userId;
    session.userName = data.userName;
    session.room = data.room;
    session.lanUrl = data.lanUrl || session.lanUrl;
    session.connected = true;
    session.joinedAt = Date.now();
    saveJSON('mp2:profile', { name, avatar: session.avatar, room: data.room === 'MAIN' ? '' : data.room });
    const url = new URL(location.href);
    url.searchParams.set('room', data.room);
    history.replaceState(null, '', url);
    applySnapshot(data);
    unlockApp();
    transport.connect({ room: data.room, userId: data.userId });
    startPing();
    emit('session:joined', session);
  } catch (err) {
    console.warn('join failed', err);
    setEntryStatus(t('entry.serverFail'), false);
  } finally {
    setEntryBusy(false);
  }
}

export function leave(reason = '') {
  if (session.connected) transport.send({ kind: 'leave' });
  lockApp(reason);
}

function unlockApp() {
  document.body.classList.add('session-active');
  const gate = $('#entryGate');
  const main = $('#mainApp');
  if (gate) gate.hidden = true;
  if (main) main.inert = false;
  updateSessionInfo();
}

function lockApp(message = '') {
  transport.disconnect();
  stopPing();
  session.connected = false;
  session.users = [];
  session.hostId = null;
  document.body.classList.remove('session-active', 'frozen', 'is-host');
  const gate = $('#entryGate');
  const main = $('#mainApp');
  if (gate) gate.hidden = false;
  if (main) main.inert = true;
  if (message) setEntryStatus(message, false);
  renderUsers(true);
  updateSessionInfo();
  emit('session:left');
  $('#entryUserName')?.focus();
}

function startPing() {
  stopPing();
  pingTimer = setInterval(async () => {
    if (!session.connected) return;
    const r = await transport.send({ kind: 'ping' }, { wait: true });
    if (r && r.ok === false && r.error === 'unknown_user') rejoin();
  }, 25000);
  activity();
}

function stopPing() {
  clearInterval(pingTimer);
  pingTimer = null;
  clearTimeout(afkTimer);
}

async function rejoin() {
  if (!session.userName) return;
  await join({ name: session.userName, room: session.room, rejoin: true });
}

function activity() {
  if (!session.connected) return;
  if (afk) {
    afk = false;
    transport.send({ kind: 'status', status: 'active' });
  }
  clearTimeout(afkTimer);
  afkTimer = setTimeout(() => {
    afk = true;
    transport.send({ kind: 'status', status: 'afk' });
  }, 90000);
}

// ---------------------------------------------------------------------------
// Входящие сообщения
// ---------------------------------------------------------------------------

function onMessage(msg) {
  if (!session.connected) return;
  switch (msg.type) {
    case 'snapshot':
      applySnapshot(msg);
      break;
    case 'users':
      updateUsers(msg.users, msg.hostId);
      break;
    case 'action':
    case 'feed':
      updateUsers(msg.users, msg.hostId);
      if (msg.entry) {
        appendFeed(msg.entry);
        if (msg.entry.type === 'join' && msg.entry.userId !== session.userId && Date.now() - session.joinedAt > 3000) {
          notify(t('notif.join', { name: msg.entry.userName, room: session.room }));
          emit('sfx', 'join');
        } else if (msg.entry.type === 'leave' && msg.entry.userId !== session.userId) {
          emit('sfx', 'leave');
        }
      }
      if (msg.like?.target === session.userId) emit('like:received', msg.like);
      break;
    case 'feed_cleared':
      $('#activityFeed').textContent = '';
      toast(t('feed.cleared'));
      break;
    case 'kicked':
      if (msg.userId === session.userId) lockApp(t('entry.kicked'));
      break;
    case 'apply_state':
      if (msg.from !== session.userId) {
        applyRemoteState(msg.state);
        toast(t('session.applied', { name: msg.fromName }), { icon: '📤' });
      }
      if (msg.entry) appendFeed(msg.entry);
      break;
    case 'frozen':
      session.frozen = Boolean(msg.frozen);
      document.body.classList.toggle('frozen', session.frozen && !isHost());
      toast(session.frozen ? t('session.frozen') : t('session.unfrozen'), { icon: session.frozen ? '🧊' : '🔥' });
      if (msg.entry) appendFeed(msg.entry);
      emit('session:frozen', session.frozen);
      break;
    case 'announce':
      showAnnouncement(msg.text, msg.by);
      break;
    default:
      break;
  }
}

function onNetError(err) {
  if (err?.error === 'frozen') toast(t('toast.frozen'), { type: 'warn', icon: '🧊' });
  else if (err?.error === 'host_only') toast(t('admin.hostOnly'), { type: 'warn' });
  else if (err?.error === 'unknown_user') rejoin();
}

function onTransportStatus({ state: st, mode }) {
  session.transport = mode;
  const chip = $('#connStatus');
  if (chip) {
    chip.classList.remove('online', 'offline', 'reconnecting');
    chip.classList.add(st);
    chip.textContent = st === 'online' ? `${t('conn.online')} · ${mode === 'ws' ? t('conn.ws') : t('conn.sse')}` : st === 'reconnecting' ? t('conn.reconnecting') : t('conn.offline');
  }
  if (st === 'reconnecting') wasReconnecting = true;
  if (st === 'online' && wasReconnecting) {
    wasReconnecting = false;
    toast(t('toast.reconnected'), { type: 'ok' });
    transport.send({ kind: 'ping' }, { wait: true }).then((r) => { if (r?.ok === false && r.error === 'unknown_user') rejoin(); });
  }
  updateSessionInfo();
}

function applySnapshot(snap) {
  session.hostId = snap.hostId ?? session.hostId;
  session.frozen = Boolean(snap.frozen);
  document.body.classList.toggle('frozen', session.frozen && !isHost());
  updateUsers(snap.users || [], snap.hostId);
  hydrateFeed(snap.feed || []);
  if (snap.announcement) showAnnouncement(snap.announcement);
  emit('session:snapshot', snap);
}

function showAnnouncement(text, by = '') {
  const bar = $('#announceBar');
  if (!bar) return;
  if (!text) { bar.hidden = true; return; }
  $('#announceText').textContent = by ? `📢 ${by}: ${text}` : `📢 ${text}`;
  bar.hidden = false;
  emit('sfx', 'message');
}

// ---------------------------------------------------------------------------
// Участники
// ---------------------------------------------------------------------------

function updateUsers(users, hostId) {
  const prevHost = session.hostId;
  session.users = Array.isArray(users) ? users : [];
  if (hostId !== undefined) session.hostId = hostId;
  if (prevHost !== session.hostId && isHost()) { toast(t('session.hostNow'), { icon: '👑' }); emit('session:host'); }
  document.body.classList.toggle('is-host', isHost());
  document.body.classList.toggle('frozen', session.frozen && !isHost());
  renderUsers();
  updateSessionInfo();
  emit('session:users', session.users);
  if (session.followHost) followHostNow();
}

function followHostNow() {
  const host = userById(session.hostId);
  if (!host || host.id === session.userId || !host.state) return;
  const sig = JSON.stringify(host.state);
  if (sig === lastHostSig) return;
  lastHostSig = sig;
  applyRemoteState(host.state);
}

export function applyRemoteState(remote) {
  if (!remote || typeof remote !== 'object') return;
  const next = { ...remote, cursorFx: state.cursorFx };
  next.objects = (remote.objects || []).map((o) => ({ ...o, image: o.image === 'has-image' ? null : o.image }));
  if (next.background && (next.background.value === 'local-media')) next.background = { type: 'preset', value: 'auto' };
  replaceState(next, { source: 'remote' });
  sendStateNow();
}

function updateSessionInfo() {
  const badge = $('#sessionBadge');
  if (badge) {
    badge.textContent = session.connected ? t('session.you', { name: session.userName }) : t('conn.offline');
    badge.classList.toggle('online', session.connected);
    badge.classList.toggle('offline', !session.connected);
  }
  $('#sessionRoom').textContent = session.room || '—';
  $('#sessionRole').textContent = session.connected ? (isHost() ? t('role.host') : t('role.member')) : '—';
  $('#sessionTransport').textContent = session.connected ? (session.transport === 'ws' ? t('conn.ws') : session.transport === 'sse' ? t('conn.sse') : '…') : '—';
  $('#roomChip').textContent = session.room || 'MAIN';
  $('#usersCount').textContent = String(session.users.length);
  $('#adminCard').hidden = !isHost();
  const pollForm = $('#pollForm');
  const pollHint = $('#pollHint');
  if (pollForm) pollForm.hidden = !isHost();
  if (pollHint) pollHint.hidden = isHost();
  const freezeBtn = $('#freezeBtn');
  if (freezeBtn) freezeBtn.textContent = session.frozen ? t('admin.unfreeze') : t('admin.freeze');
}

function userTime(user) {
  if (!user.tz) return '';
  try { return formatTime(Date.now(), false, user.tz); } catch { return ''; }
}

function updateTimes() {
  document.querySelectorAll('[data-user-time]').forEach((node) => {
    const user = userById(node.dataset.userTime);
    if (user) node.textContent = userTime(user);
  });
  emit('tick:minute');
}

function renderUsers(force = false) {
  renderOnlineList();
  renderShowcase(force);
}

function renderOnlineList() {
  const list = $('#onlineUsers');
  if (!list) return;
  list.textContent = '';
  for (const user of session.users) {
    const li = el('li', { class: `${user.status === 'afk' ? 'afk' : ''} ${user.id === session.userId ? 'self' : ''}` }, [
      el('span', { class: 'user-dot', style: { background: user.color } }),
      el('span', { class: 'user-avatar', text: user.avatar || '🙂' }),
      el('span', { class: 'user-name', text: `${user.name}${user.id === session.userId ? ` ${t('users.you')}` : ''}` }),
      user.role === 'host' ? el('span', { class: 'badge', title: t('users.host'), text: '👑' }) : null,
      user.status === 'afk' ? el('span', { class: 'badge', title: t('users.afk'), text: '💤' }) : null,
      user.follow ? el('span', { class: 'badge', title: t('users.follow'), text: '🔗' }) : null,
      user.tz ? el('span', { class: 'user-time', dataset: { userTime: user.id }, text: userTime(user) }) : null,
    ]);
    list.append(li);
  }
}

/** Подпись карточки: если она не изменилась — карточку не перерисовываем. */
function showcaseSignature(user) {
  const s = user.state || {};
  const objects = (s.objects || []).slice(0, 4).map((o) => {
    const { x, y, customPath, ...visual } = o;
    return visual;
  });
  return JSON.stringify([user.name, user.avatar, user.color, user.status, user.role, user.likes, user.follow, user.tz,
    s.use3d, s.shape3d, s.speed, s.playing, s.background, objects, getLang()]);
}

function renderShowcase(force = false) {
  const root = $('#usersShowcase');
  if (!root) return;
  const seen = new Set();
  if (!session.users.length) {
    root.textContent = '';
    showcaseNodes.clear();
    root.append(el('div', { class: 'showcase-empty', text: t('users.empty') }));
    return;
  }
  root.querySelector('.showcase-empty')?.remove();
  session.users.forEach((user, index) => {
    seen.add(user.id);
    let node = showcaseNodes.get(user.id);
    const sig = showcaseSignature(user);
    if (!node) {
      node = { card: el('article', { class: 'user-model-card', dataset: { userId: user.id } }), sig: null, running: [] };
      showcaseNodes.set(user.id, node);
      root.append(node.card);
    }
    if (force || node.sig !== sig) {
      stopCard(node);
      fillCard(node, user);
      node.sig = sig;
    } else {
      const model = node.card.querySelector('.mini-model');
      if (model) model.style.transform = `rotateX(${user.state?.modelRotX ?? -18}deg) rotateY(${user.state?.modelRotY ?? 28}deg) scale(${user.state?.modelZoom ?? 1})`;
    }
    if (root.children[index] !== node.card) root.insertBefore(node.card, root.children[index] || null);
  });
  for (const [id, node] of showcaseNodes) {
    if (!seen.has(id)) {
      stopCard(node);
      node.card.remove();
      showcaseNodes.delete(id);
    }
  }
}

function stopCard(node) {
  (node.running || []).forEach((stop) => { try { stop(); } catch { /* уже остановлено */ } });
  node.running = [];
}

function fillCard(node, user) {
  const { card } = node;
  const s = user.state || {};
  const objects = (s.objects || []).slice(0, 4);
  const obj = objects[0] || { shape: 'circle', color: user.color, size: 120, animations: ['pulse'] };
  const self = user.id === session.userId;
  card.className = `user-model-card ${self ? 'self' : ''} ${user.role === 'host' ? 'host' : ''} ${user.status === 'afk' ? 'afk' : ''}`;
  card.style.setProperty('--user-color', user.color || 'var(--accent)');
  card.textContent = '';

  const nameRow = el('div', { class: 'user-model-name' }, [
    el('span', { class: 'user-avatar', text: user.avatar || '🙂' }),
    el('span', { class: 'name', text: user.name }),
    self ? el('span', { class: 'you', text: t('users.you') }) : null,
    user.role === 'host' ? el('span', { class: 'badge', title: t('users.host'), text: '👑' }) : null,
    user.status === 'afk' ? el('span', { class: 'badge', title: t('users.afk'), text: '💤' }) : null,
    el('button', {
      type: 'button', class: 'icon-btn tiny peek-btn', title: t('users.view'), text: '👁',
      onClick: (e) => { e.stopPropagation(); togglePeek(user, { self: user.id === session.userId }); },
    }),
  ]);
  const stageBox = el('div', { class: 'user-model-stage' });
  stageBox.addEventListener('click', () => togglePeek(user, { self: user.id === session.userId }));
  const meta = el('div', { class: 'user-model-meta' }, [
    el('span', { text: s.use3d ? t(`s3.${s.shape3d || 'cube'}`) : (obj.animations?.length ? obj.animations.slice(0, 2).map((k) => t(`a.${k}`)).join(' + ') : t('feed.animNone')) }),
    el('span', { text: `x${Number(s.speed ?? 1).toFixed(1)}` }),
    objects.length > 1 ? el('span', { text: `×${objects.length}` }) : null,
  ]);
  const actions = el('div', { class: 'user-model-actions' }, [
    user.tz ? el('span', { class: 'user-time', dataset: { userTime: user.id }, text: userTime(user) }) : el('span'),
    el('button', {
      type: 'button', class: 'like-btn', disabled: self, title: t('users.like'),
      text: `❤ ${user.likes || 0}`,
      onClick: (e) => { e.stopPropagation(); if (!self) emit('like:send', user.id); },
    }),
  ]);
  const floatLayer = el('div', { class: 'reaction-float-layer' });
  card.append(nameRow, stageBox, meta, actions, floatLayer);

  // Рисуем все объекты участника: фигуры, картинки и видео, которые он поставил себе.
  const many = objects.length > 1;
  const size = many ? Math.max(26, Math.round(58 / Math.min(2, objects.length))) : 58;
  for (const item of (many ? objects : [obj])) {
    const { node: preview, stop } = renderObjectPreview(item, s, {
      size, animate: s.playing !== false, interactive: false,
    });
    if (!many && s.use3d) preview.classList.add('alone');
    stageBox.append(preview);
    node.running.push(stop);
  }
  if (!objects.length) stageBox.append(el('div', { class: 'showcase-empty small', text: '—' }));
}

// ---------------------------------------------------------------------------
// Лента действий
// ---------------------------------------------------------------------------

const feedEntries = [];

function feedText(entry) {
  if (entry.textKey) {
    const key = entry.textKey;
    const text = t(key, entry.vars || {});
    if (text !== key) return text;
  }
  return entry.text || '';
}

function feedRow(entry) {
  const user = userById(entry.userId);
  const isSelf = entry.userId === session.userId;
  return el('div', { class: `feed-item feed-${entry.type}` }, [
    el('span', { class: 'feed-time', text: formatTime(entry.ts) }),
    el('span', { class: 'feed-user', style: { color: user?.color || 'var(--accent)' }, text: `${entry.userName}${isSelf ? ` ${t('users.you')}` : ''}` }),
    el('span', { class: 'feed-text', text: feedText(entry) }),
  ]);
}

function appendFeed(entry, scroll = true) {
  const feed = $('#activityFeed');
  if (!feed || !entry) return;
  feedEntries.push(entry);
  if (feedEntries.length > 120) feedEntries.shift();
  feed.prepend(feedRow(entry));
  while (feed.children.length > 120) feed.lastChild?.remove();
  if (scroll) feed.scrollTop = 0;
}

function hydrateFeed(items) {
  const feed = $('#activityFeed');
  if (!feed) return;
  feed.textContent = '';
  feedEntries.length = 0;
  for (const entry of (items || []).slice(-60)) appendFeed(entry, false);
}

function renderFeedAll() {
  const feed = $('#activityFeed');
  if (!feed) return;
  feed.textContent = '';
  for (const entry of feedEntries) feed.prepend(feedRow(entry));
}

// ---------------------------------------------------------------------------
// Синхронизация локального состояния
// ---------------------------------------------------------------------------

const sendStateThrottled = throttle(() => sendStateNow(), 120);
const sendStateDebounced = debounce(() => sendStateNow(), 200);

export function sendStateNow() {
  if (!session.connected) return;
  transport.send({ kind: 'state', state: syncableState() });
}

function stripEmoji(text) {
  return String(text).replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

function describe(meta, patch, s) {
  const obj = activeObject();
  const a = meta.action;
  if (a === null || a === undefined) return null;
  const v = meta.vars || {};
  const map = {
    theme: ['feed.theme', { theme: s.theme }],
    speed: ['feed.speed', { speed: Number(s.speed).toFixed(1) }],
    start: ['feed.start', {}],
    stop: ['feed.stop', {}],
    anim: obj?.animations?.length ? ['feed.anim', { list: obj.animations.map((k) => t(`a.${k}`)).join(' + ') }] : ['feed.animNone', {}],
    shape: ['feed.shape', { shape: t(`shape.${obj?.shape}`) }],
    color: ['feed.color', { color: obj?.color }],
    props: ['feed.props', {}],
    addObject: ['feed.addObject', { n: s.objects.length }],
    removeObject: ['feed.removeObject', { n: s.objects.length }],
    layer: ['feed.layer', {}],
    mode3d: ['feed.mode3d', { shape: t(`s3.${s.shape3d}`) }],
    mode2d: ['feed.mode2d', {}],
    shape3d: ['feed.shape3d', { shape: t(`s3.${s.shape3d}`) }],
    rotate: ['feed.rotate', { x: Math.round(s.modelRotX), y: Math.round(s.modelRotY) }],
    zoom: ['feed.zoom', { zoom: Number(s.modelZoom).toFixed(2) }],
    webgl: [s.webgl ? 'feed.webgl' : 'feed.webglOff', {}],
    background: ['feed.background', { bg: v.bg ?? s.background?.value ?? s.background?.type }],
    effect: s.effect === 'none' ? ['feed.effectOff', {}] : ['feed.effect', { effect: stripEmoji(t(`fx.${s.effect}`)) }],
    physics: [s.physics ? 'feed.physics' : 'feed.physicsOff', {}],
    trajectory: ['feed.trajectory', { traj: v.traj ?? t(`traj.${obj?.trajectory}`) }],
    random: ['feed.random', {}],
    dice: ['feed.dice', { n: v.n }],
    undo: ['feed.undo', {}],
    redo: ['feed.redo', {}],
    weatherSync: ['feed.weatherSync', {}],
  };
  const found = map[a];
  if (!found) return { type: a, key: 'feed.update', vars: v };
  return { type: a, key: found[0], vars: { ...found[1], ...v } };
}

function onLocalState(s, patch, meta) {
  if (!session.connected) return;
  if (meta.source === 'remote' || meta.source === 'init') return;
  if (meta.source === 'system') { sendStateDebounced(); return; }
  if (meta.silent) return;
  if (meta.transient) { sendStateThrottled(); return; }
  const desc = describe(meta, patch, s);
  if (!desc) { sendStateDebounced(); return; }
  transport.send({ kind: 'action', type: desc.type, textKey: desc.key, vars: desc.vars, text: t(desc.key, desc.vars), state: syncableState() });
}

/** Действие без изменения состояния (кубик Рубика, достижения, квиз). */
export function sendAction(action, vars = {}) {
  if (!session.connected) return;
  const keyMap = {
    rubik: 'feed.rubik', rubikSolve: 'feed.rubikSolve', achievement: 'feed.achievement',
    quiz: 'feed.quiz', konami: 'feed.konami', copyScene: 'feed.copyScene',
  };
  const key = keyMap[action] || 'feed.update';
  transport.send({ kind: 'action', type: action, textKey: key, vars, text: t(key, vars), state: syncableState() });
}

// ---------------------------------------------------------------------------
// Прочее
// ---------------------------------------------------------------------------

export function shareUrl() {
  const base = session.lanUrl && !/localhost|127\.0\.0\.1/.test(location.host) ? location.origin + '/' : (session.lanUrl || location.origin + '/');
  const url = new URL(base);
  if (session.room) url.searchParams.set('room', session.room);
  return url.toString();
}

async function copyLink() {
  try {
    await navigator.clipboard.writeText(shareUrl());
    toast(t('session.copied'), { type: 'ok' });
  } catch {
    prompt('URL', shareUrl());
  }
}

export async function requestNotifications() {
  if (!('Notification' in window)) { toast(t('toast.notifyNo'), { type: 'warn' }); return false; }
  const res = await Notification.requestPermission();
  if (res === 'granted') { toast(t('toast.notifyOn'), { type: 'ok' }); $('#notifyBtn')?.classList.add('active'); return true; }
  toast(t('toast.notifyDenied'), { type: 'warn' });
  return false;
}

export function notify(text) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!document.hidden) return;
  try {
    const n = new Notification('Motion Playground', { body: text, icon: 'icons/icon-192.png', tag: 'mp2' });
    setTimeout(() => n.close(), 6000);
  } catch { /* ignore */ }
}
