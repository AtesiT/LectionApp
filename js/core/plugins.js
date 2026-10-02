// API плагинов: открытый хук window.__motion + простая «песочница».
//
// Плагин — обычный JS-код, который получает объект motion и может управлять
// сценой, объектами, эффектами и чатом. Код выполняется в отдельной функции,
// где глобальные window/document/fetch/XMLHttpRequest/eval закрыты (их имена
// перекрыты параметрами со значением undefined), поэтому плагин работает
// только через наше API.
import { $, el } from './dom.js';
import { on, emit } from './bus.js';
import { t, getLang } from './i18n.js';
import {
  state, getState, setState, activeObject, updateActiveObject, updateObject,
  addObject, removeObject, setActiveObject,
} from './store.js';
import * as transport from '../net/transport.js';
import { session } from '../net/session.js';
import { toast } from '../ui/toast.js';
import * as timeline from '../ui/timeline.js';

export const PLUGIN_VERSION = '1.1';

const timers = new Set();
const intervals = new Set();
const cleanups = [];
let plugins = [];

const api = {
  version: PLUGIN_VERSION,
  // состояние
  get state() { return getState(); },
  get active() { return activeObject(); },
  get objects() { return state.objects; },
  get me() { return { id: session.userId, name: session.userName, host: session.userId === session.hostId, room: session.room }; },
  patch(patch) { setState(patch, { action: 'plugin' }); return true; },
  updateActive(patch) { return Boolean(updateActiveObject(patch, { source: 'plugin' })); },
  update(id, patch) { return Boolean(updateObject(id, patch, { source: 'plugin' })); },
  add(patch = {}) { return addObject(patch, { source: 'plugin' })?.id ?? null; },
  remove(id) { return Boolean(removeObject(id ?? activeObject()?.id, { source: 'plugin' })); },
  select(id) { setActiveObject(id); return true; },
  // сцена
  setBackground(patch) { setState({ background: { ...state.background, ...patch } }, { action: 'plugin' }); return true; },
  setEffect(kind, intensity) {
    setState({ effect: kind, effectIntensity: intensity ?? state.effectIntensity ?? 1 }, { action: 'plugin' });
    return true;
  },
  setAnimations(keys) { return api.updateActive({ animations: keys }); },
  // таймлайн
  timeline: {
    play: () => timeline.play(),
    pause: () => timeline.pause(),
    stop: () => timeline.stop(),
    addKey: () => timeline.addKeyAtPlayhead(),
  },
  // общение
  say(text) {
    const message = String(text ?? '').slice(0, 500);
    if (!message) return false;
    transport.send({ kind: 'chat', text: message });
    return true;
  },
  react(emoji) { transport.send({ kind: 'reaction', emoji: String(emoji || '👍') }); return true; },
  toast(text, icon = '') { toast(String(text), { icon }); return true; },
  // события и таймеры
  on(event, handler) { on(event, handler); cleanups.push(() => {}); return true; },
  emit(event, data) { emit(event, data); return true; },
  every(ms, fn) {
    const id = setInterval(() => safe(fn), Math.max(16, Number(ms) || 1000));
    intervals.add(id);
    return () => clearInterval(id);
  },
  after(ms, fn) {
    const id = setTimeout(() => safe(fn), Math.max(0, Number(ms) || 0));
    timers.add(id);
    return () => clearTimeout(id);
  },
  log(...args) { logLine(args.map(stringify).join(' ')); return true; },
};

function stringify(value) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch { return String(value); }
}

function safe(fn) {
  try { return fn(); } catch (err) { logLine(`⚠ ${err?.message || err}`); return undefined; }
}

export function logLine(text) {
  const box = $('#pluginLog');
  if (!box) return;
  const time = new Date().toLocaleTimeString('ru-RU', { hour12: false });
  box.append(el('div', { class: 'plugin-log-line', text: `[${time}] ${text}` }));
  while (box.children.length > 200) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}

/** Останавливает все плагины и чистит их таймеры. */
export function stopAll() {
  for (const id of intervals) clearInterval(id);
  for (const id of timers) clearTimeout(id);
  intervals.clear();
  timers.clear();
  cleanups.length = 0;
  plugins = [];
}

/**
 * Выполняет код плагина. Возвращает {ok, error}.
 * Внутри функции нет доступа к window/document/fetch/eval — только наше API.
 */
export function run(code, { name = 'plugin' } = {}) {
  try {
    // Имена параметров перекрывают глобальные объекты: внутри плагина их нет.
    // (strict-режим здесь не включаем: в нём нельзя объявить параметр eval.)
    const fn = new Function(
      'motion', 'window', 'document', 'fetch', 'XMLHttpRequest', 'eval',
      'localStorage', 'sessionStorage', 'indexedDB', 'globalThis',
      `${code}\n//# sourceURL=${name}.js`,
    );
    const result = fn(api, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined);
    plugins.push({ name, code, result });
    if (typeof result === 'function') cleanups.push(result);
    return { ok: true, result };
  } catch (err) {
    logLine(`✖ ${err?.message || err}`);
    return { ok: false, error: String(err?.message || err) };
  }
}

export function list() {
  return plugins.slice();
}

// --- готовые примеры --------------------------------------------------------------------

export const EXAMPLES = [
  {
    id: 'pulse',
    ru: 'Пульсация по кругу',
    en: 'Circle pulse',
    code: `// Объект пульсирует и меняет цвет каждые 800 мс
let on = false;
motion.every(800, () => {
  on = !on;
  motion.updateActive({ size: on ? 220 : 140, color: on ? '#F472B6' : '#38BDF8' });
});
motion.log('Плагин запущен');`,
  },
  {
    id: 'orbit',
    ru: 'Вращение по орбите',
    en: 'Orbit',
    code: `// Активный объект движется по кругу
let a = 0;
motion.every(40, () => {
  a += 0.05;
  motion.updateActive({ x: Math.round(Math.cos(a) * 180), y: Math.round(Math.sin(a) * 120) });
});`,
  },
  {
    id: 'rain',
    ru: 'Дождь из объектов',
    en: 'Object rain',
    code: `// Раз в 300 мс добавляем новый объект и удаляем лишние
const shapes = ['circle', 'square', 'star', 'heart', 'hexagon'];
motion.every(300, () => {
  motion.add({
    shape: shapes[Math.floor(Math.random() * shapes.length)],
    x: Math.round((Math.random() - 0.5) * 520),
    y: -240,
    size: 40 + Math.round(Math.random() * 60),
    color: ['#38BDF8', '#A78BFA', '#34D399', '#FBBF24'][Math.floor(Math.random() * 4)],
    animations: ['pulse'],
  });
  if (motion.objects.length > 14) motion.remove(motion.objects[0].id);
});`,
  },
  {
    id: 'greet',
    ru: 'Приветствие в чат',
    en: 'Greet in chat',
    code: `// Плагин пишет в чат комнаты и показывает подсказку
motion.say('Привет! Я плагин Motion Playground 👋');
motion.toast('Плагин приветствует всех', '🤖');
motion.on('chat', (text) => motion.log('Сообщение: ' + text));`,
  },
];

// --- интерфейс --------------------------------------------------------------------------

export function init() {
  window.__motion = api;

  const select = $('#pluginExample');
  if (select) {
    select.replaceChildren(...EXAMPLES.map((ex) => el('option', {
      value: ex.id,
      text: getLang() === 'en' ? ex.en : ex.ru,
    })));
    select.addEventListener('change', () => {
      const ex = EXAMPLES.find((e) => e.id === select.value);
      const area = $('#pluginCode');
      if (ex && area && !area.value.trim()) area.value = ex.code;
    });
  }
  $('#pluginRunBtn')?.addEventListener('click', runFromUi);
  $('#pluginStopBtn')?.addEventListener('click', () => {
    stopAll();
    logLine('Плагины остановлены');
    toast(t('plugins.stopped'), { icon: '🛑' });
  });
  $('#pluginClearBtn')?.addEventListener('click', () => { const box = $('#pluginLog'); if (box) box.textContent = ''; });
  on('lang', () => {
    if (!select) return;
    select.replaceChildren(...EXAMPLES.map((ex) => el('option', {
      value: ex.id,
      text: getLang() === 'en' ? ex.en : ex.ru,
    })));
  });
  try {
    const saved = localStorage.getItem('mp2:plugin');
    const area = $('#pluginCode');
    if (saved && area) area.value = saved;
  } catch { /* ignore */ }
}

function runFromUi() {
  const area = $('#pluginCode');
  const code = (area?.value || '').trim();
  if (!code) { toast(t('plugins.empty'), { type: 'warn' }); return false; }
  try { localStorage.setItem('mp2:plugin', code); } catch { /* ignore */ }
  const res = run(code, { name: 'user-plugin' });
  if (res.ok) toast(t('plugins.ok'), { icon: '🧩' });
  else toast(`${t('plugins.bad')}: ${res.error}`, { type: 'warn' });
  return res.ok;
}

export { api };
