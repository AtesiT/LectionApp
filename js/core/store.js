// Центральное хранилище состояния сцены + история для Undo/Redo.
// Любое изменение проходит через setState(patch, meta); подписчики получают
// (state, patch, meta) и сами решают, что перерисовать.
import { emit } from './bus.js';
import { deepClone, uid, loadJSON, saveJSON } from './dom.js';

export const DEFAULT_OBJECT = Object.freeze({
  shape: 'circle',      // circle | square | triangle | star | heart | hexagon | ring | emoji | text | image
  color: '#38BDF8',
  size: 160,
  opacity: 1,
  shadow: 0.5,          // 0..1 — тень
  glow: 0,              // 0..1 — свечение
  stroke: 0,            // px — обводка
  strokeColor: '#ffffff',
  radius: 14,           // % — скругление углов квадрата
  emoji: '🚀',
  text: 'Motion',
  image: null,          // data URL (не синхронизируется — слишком большой)
  x: 0,                 // смещение от центра сцены, px
  y: 0,
  animations: ['pulse'],
  trajectory: 'none',   // none | circle | eight | custom
  customPath: [],
});

export const DEFAULT_STATE = Object.freeze({
  theme: 'neon',
  speed: 1,
  playing: true,
  use3d: false,
  shape3d: 'cube',      // cube | pyramid | prism | cylinder | sphere | dodecahedron | dice | rubik
  webgl: false,
  modelRotX: -18,
  modelRotY: 28,
  modelZoom: 1,
  activeObjectId: null,
  objects: [],
  background: { type: 'preset', value: 'auto', parallax: false },
  effect: 'none',
  effectIntensity: 1,
  physics: false,
  gravity: 1,
  weatherSync: false,
  cursorFx: 'trail',
});

// Ключи, которые не отправляются другим участникам.
const LOCAL_ONLY_KEYS = new Set(['cursorFx']);

export const state = deepClone(DEFAULT_STATE);

const subscribers = new Set();
const history = { undo: [], redo: [], lastCoalesceKey: null, lastCoalesceAt: 0 };
const HISTORY_LIMIT = 60;

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function getState() {
  return state;
}

export function makeObject(overrides = {}) {
  return { ...deepClone(DEFAULT_OBJECT), id: uid('obj'), ...overrides };
}

export function activeObject() {
  return state.objects.find((o) => o.id === state.activeObjectId) ?? state.objects[0] ?? null;
}

export function primaryObject() {
  return state.objects[0] ?? null;
}

function snapshotForHistory() {
  return deepClone(state);
}

function pushHistory(meta) {
  if (meta.source !== 'user') return;
  if (meta.transient) return;
  const now = performance.now();
  if (meta.coalesce && meta.coalesce === history.lastCoalesceKey && now - history.lastCoalesceAt < 900) {
    history.lastCoalesceAt = now;
    return;
  }
  history.lastCoalesceKey = meta.coalesce ?? null;
  history.lastCoalesceAt = now;
  history.undo.push(meta.previous);
  if (history.undo.length > HISTORY_LIMIT) history.undo.shift();
  history.redo.length = 0;
  emit('history', { canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 });
}

/**
 * Применяет изменение состояния.
 * meta.source: 'user' | 'remote' | 'undo' | 'system' | 'init'
 * meta.transient: промежуточное значение (ползунок тянут) — без истории, тихая синхронизация
 * meta.action: тип действия для ленты (например 'theme', 'anim', 'speed')
 * meta.vars: переменные для текста ленты
 * meta.coalesce: ключ склейки соседних изменений в истории
 * meta.silent: не рассылать другим участникам
 */
export function setState(patch, meta = {}) {
  const fullMeta = { source: 'user', ...meta, previous: null };
  if (fullMeta.source === 'user' && !fullMeta.transient) fullMeta.previous = snapshotForHistory();
  const applied = {};
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in DEFAULT_STATE) && key !== 'objects') continue;
    if (JSON.stringify(state[key]) === JSON.stringify(value)) continue;
    state[key] = value;
    applied[key] = value;
  }
  if (Object.keys(applied).length === 0 && !meta.force) return false;
  if (fullMeta.previous) pushHistory(fullMeta);
  notify(applied, fullMeta);
  return true;
}

function notify(patch, meta) {
  for (const fn of subscribers) {
    try {
      fn(state, patch, meta);
    } catch (err) {
      console.error('store subscriber error', err);
    }
  }
  emit('state', { state, patch, meta });
}

/** Обновляет свойства одного объекта. */
export function updateObject(id, patch, meta = {}) {
  const objects = state.objects.map((o) => (o.id === id ? { ...o, ...patch } : o));
  return setState({ objects }, { ...meta, objectId: id, objectPatch: patch });
}

export function updateActiveObject(patch, meta = {}) {
  const obj = activeObject();
  if (!obj) return false;
  return updateObject(obj.id, patch, meta);
}

export function addObject(overrides = {}, meta = {}) {
  const obj = makeObject(overrides);
  if (state.objects.length >= 12) return null;
  setState({ objects: [...state.objects, obj], activeObjectId: obj.id }, { action: 'addObject', ...meta });
  return obj;
}

export function removeObject(id, meta = {}) {
  if (state.objects.length <= 1) return false;
  const objects = state.objects.filter((o) => o.id !== id);
  const activeObjectId = state.activeObjectId === id ? objects[objects.length - 1].id : state.activeObjectId;
  return setState({ objects, activeObjectId }, { action: 'removeObject', ...meta });
}

export function moveObjectLayer(id, direction, meta = {}) {
  const idx = state.objects.findIndex((o) => o.id === id);
  const target = idx + direction;
  if (idx < 0 || target < 0 || target >= state.objects.length) return false;
  const objects = [...state.objects];
  [objects[idx], objects[target]] = [objects[target], objects[idx]];
  return setState({ objects }, { action: 'layer', ...meta });
}

export function setActiveObject(id) {
  return setState({ activeObjectId: id }, { source: 'system', silent: true });
}

/** Полная замена состояния (удалённая сцена, Undo, загрузка). */
export function replaceState(next, meta = {}) {
  const merged = { ...deepClone(DEFAULT_STATE), ...deepClone(next) };
  merged.objects = (merged.objects || []).map((o) => ({ ...deepClone(DEFAULT_OBJECT), ...o, id: o.id || uid('obj') }));
  if (!merged.objects.length) merged.objects = [makeObject()];
  if (!merged.objects.some((o) => o.id === merged.activeObjectId)) merged.activeObjectId = merged.objects[0].id;
  const fullMeta = { source: 'system', ...meta, previous: null };
  if (fullMeta.source === 'user' && !fullMeta.transient) fullMeta.previous = snapshotForHistory();
  const patch = {};
  for (const key of Object.keys(merged)) {
    if (JSON.stringify(state[key]) !== JSON.stringify(merged[key])) patch[key] = merged[key];
    state[key] = merged[key];
  }
  if (fullMeta.previous) pushHistory(fullMeta);
  notify(patch, { ...fullMeta, replace: true });
}

export function undo() {
  const prev = history.undo.pop();
  if (!prev) return false;
  history.redo.push(snapshotForHistory());
  replaceState(prev, { source: 'undo', action: 'undo' });
  emit('history', { canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 });
  return true;
}

export function redo() {
  const next = history.redo.pop();
  if (!next) return false;
  history.undo.push(snapshotForHistory());
  replaceState(next, { source: 'undo', action: 'redo' });
  emit('history', { canUndo: history.undo.length > 0, canRedo: history.redo.length > 0 });
  return true;
}

export function canUndo() { return history.undo.length > 0; }
export function canRedo() { return history.redo.length > 0; }

/** Состояние для отправки другим участникам (без локальных и тяжёлых полей). */
export function syncableState(source = state) {
  const out = {};
  for (const [key, value] of Object.entries(source)) {
    if (LOCAL_ONLY_KEYS.has(key)) continue;
    out[key] = value;
  }
  out.objects = (source.objects || []).map((o) => ({
    ...o,
    image: o.image ? 'has-image' : null,
    customPath: (o.customPath || []).slice(0, 200),
  }));
  if (out.background?.type === 'image' || out.background?.type === 'video') {
    const isData = String(out.background.value || '').startsWith('data:') || String(out.background.value || '').startsWith('blob:');
    out.background = { ...out.background, value: isData ? 'local-media' : out.background.value };
  }
  return out;
}

const SAVE_KEY = 'mp2:scene';

export function saveLocal() {
  const copy = syncableState();
  saveJSON(SAVE_KEY, copy);
}

export function loadLocal() {
  return loadJSON(SAVE_KEY, null);
}

export function initState() {
  const saved = loadLocal();
  if (saved && Array.isArray(saved.objects) && saved.objects.length) {
    saved.playing = true;
    replaceState(saved, { source: 'init' });
  } else {
    replaceState({ objects: [makeObject()] }, { source: 'init' });
  }
}
