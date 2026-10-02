// Голосовое управление через Web Speech API (Chrome/Edge).
import { $ } from '../core/dom.js';
import { emit } from '../core/bus.js';
import { t, getLang } from '../core/i18n.js';
import { state, setState, updateActiveObject, activeObject } from '../core/store.js';
import { runCommand } from '../ui/commands.js';
import { toast } from '../ui/toast.js';
import { ANIMATION_KEYS } from '../scene/animations.js';

let recognition = null;
let listening = false;

const COLORS = {
  'красн': '#ef4444', 'син': '#3b82f6', 'зелён': '#22c55e', 'зелен': '#22c55e', 'жёлт': '#facc15', 'желт': '#facc15',
  'розов': '#f472b6', 'фиолет': '#a855f7', 'оранж': '#f97316', 'бел': '#f8fafc', 'чёрн': '#111827', 'черн': '#111827', 'голуб': '#38bdf8', 'бирюз': '#2dd4bf',
  red: '#ef4444', blue: '#3b82f6', green: '#22c55e', yellow: '#facc15', pink: '#f472b6', purple: '#a855f7', orange: '#f97316', white: '#f8fafc', black: '#111827', cyan: '#38bdf8',
};
const SHAPES = {
  'круг': 'circle', 'квадрат': 'square', 'треуголь': 'triangle', 'звезд': 'star', 'звёзд': 'star', 'сердц': 'heart', 'шестиуголь': 'hexagon', 'кольц': 'ring',
  circle: 'circle', square: 'square', triangle: 'triangle', star: 'star', heart: 'heart', hexagon: 'hexagon', ring: 'ring',
};
const ANIMS = {
  'пульс': 'pulse', 'вращ': 'rotate', 'крут': 'rotate', 'скольж': 'slide', 'затух': 'fade', 'прыж': 'bounce', 'прыг': 'bounce', 'тряс': 'shake',
  'перевор': 'flip', 'качел': 'swing', 'шата': 'wobble', 'желе': 'jello', 'сердцеби': 'heartbeat', 'мига': 'blink', 'спирал': 'spiral', 'зигзаг': 'zigzag',
  'орбит': 'orbit', 'цвет': 'color', 'морф': 'morph', 'парен': 'float', 'резин': 'rubber',
  pulse: 'pulse', rotat: 'rotate', spin: 'rotate', slide: 'slide', fade: 'fade', bounce: 'bounce', shake: 'shake', flip: 'flip', swing: 'swing',
  wobble: 'wobble', jello: 'jello', heartbeat: 'heartbeat', blink: 'blink', spiral: 'spiral', zigzag: 'zigzag', orbit: 'orbit', color: 'color', morph: 'morph', float: 'float', rubber: 'rubber',
};
const EFFECTS = { 'снег': 'snow', 'дожд': 'rain', 'лист': 'leaves', 'лепест': 'petals', 'светляч': 'fireflies', 'туман': 'fog', 'конфетти': 'confetti', 'звездопад': 'stars', 'матриц': 'matrix',
  snow: 'snow', rain: 'rain', leaves: 'leaves', petals: 'petals', firefl: 'fireflies', fog: 'fog', confetti: 'confetti', stars: 'stars', matrix: 'matrix' };
const THEMES = ['dark', 'neon', 'pastel', 'light', 'cyberpunk', 'ocean', 'forest', 'retro'];

export function init() {
  $('#voiceBtn')?.addEventListener('click', toggleVoice);
  $('#voiceBtn2')?.addEventListener('click', toggleVoice);
}

export function isSupported() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

export function toggleVoice() {
  if (listening) { stop(); return false; }
  if (!isSupported()) { toast(t('voice.no'), { type: 'warn' }); log(t('voice.no')); return false; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SR();
  recognition.lang = getLang() === 'ru' ? 'ru-RU' : 'en-US';
  recognition.continuous = true;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onresult = (event) => {
    const res = event.results[event.results.length - 1];
    const text = res[0].transcript.trim().toLowerCase();
    log(t('voice.heard', { text }));
    const done = handle(text);
    if (done) {
      log(t('voice.done', { text: done }));
      emit('voice:command', done);
      emit('sfx', 'pop');
    } else {
      log(t('voice.unknown', { text }));
    }
  };
  recognition.onerror = (e) => { if (e.error === 'not-allowed') { toast(t('sound.micDenied'), { type: 'warn' }); stop(); } };
  recognition.onend = () => { if (listening) { try { recognition.start(); } catch { /* ignore */ } } };
  try {
    recognition.start();
  } catch (err) {
    console.warn(err);
    return false;
  }
  listening = true;
  setUI(true);
  return true;
}

function stop() {
  listening = false;
  try { recognition?.stop(); } catch { /* ignore */ }
  recognition = null;
  setUI(false);
}

function setUI(on) {
  $('#voiceBtn')?.classList.toggle('active', on);
  const btn2 = $('#voiceBtn2');
  if (btn2) btn2.textContent = on ? t('voice.stop') : t('voice.btn');
  const status = $('#voiceStatus');
  if (status) { status.hidden = !on; status.textContent = on ? `🎙 ${t('voice.listening')}` : ''; }
}

function log(text) {
  const node = $('#voiceLog');
  if (node) node.textContent = text;
  const status = $('#voiceStatus');
  if (status && listening) status.textContent = `🎙 ${text}`;
}

function includesAny(text, words) {
  return words.some((w) => text.includes(w));
}

/** Разбирает фразу и выполняет команду. Возвращает описание или null. */
export function handle(text) {
  const obj = activeObject();
  if (includesAny(text, ['стоп', 'останов', 'stop', 'pause'])) { runCommand('stop'); return 'stop'; }
  if (includesAny(text, ['старт', 'запус', 'start', 'play', 'go'])) { runCommand('start'); return 'start'; }
  if (includesAny(text, ['быстрее', 'faster', 'speed up'])) { setState({ speed: Math.min(3, Number((state.speed + 0.5).toFixed(1))) }, { action: 'speed' }); return `speed x${state.speed}`; }
  if (includesAny(text, ['медленнее', 'slower', 'slow down'])) { setState({ speed: Math.max(0.2, Number((state.speed - 0.5).toFixed(1))) }, { action: 'speed' }); return `speed x${state.speed}`; }
  if (includesAny(text, ['случайн', 'random', 'surprise'])) { runCommand('random'); return 'random'; }
  if (includesAny(text, ['полный экран', 'fullscreen', 'full screen'])) { runCommand('fullscreen'); return 'fullscreen'; }
  if (includesAny(text, ['презентац', 'presentation'])) { runCommand('present'); return 'presentation'; }
  if (includesAny(text, ['отмен', 'undo'])) { runCommand('undo'); return 'undo'; }
  if (includesAny(text, ['2d', '2 d', 'два де', 'плоск', 'flat'])) { setState({ use3d: false }, { action: 'mode2d' }); return '2D'; }
  if (includesAny(text, ['3d', '3 d', 'три де', 'объём', 'куб', 'cube', 'three d'])) { setState({ use3d: true }, { action: 'mode3d' }); return '3D'; }
  if (includesAny(text, ['кост', 'dice', 'die'])) { runCommand('dice'); return 'dice'; }
  if (includesAny(text, ['физик', 'гравитац', 'physics', 'gravity'])) { setState({ physics: !state.physics }, { action: 'physics' }); return 'physics'; }
  if (includesAny(text, ['добав', 'add object', 'new object'])) { runCommand('addObject'); return 'add object'; }
  const THEME_WORDS = { dark: 'тёмн', neon: 'неон', pastel: 'пастел', light: 'светл', cyberpunk: 'кибер', ocean: 'океан', forest: 'лес', retro: 'ретро' };
  for (const theme of THEMES) {
    if (text.includes(`theme ${theme}`) || text.includes(`тема ${THEME_WORDS[theme]}`) || text.includes(`тему ${THEME_WORDS[theme]}`)
      || ((text.includes(theme) || text.includes(THEME_WORDS[theme])) && includesAny(text, ['тем', 'theme', 'стил', 'style']))) {
      setState({ theme }, { action: 'theme' });
      return `theme ${theme}`;
    }
  }
  for (const [word, effect] of Object.entries(EFFECTS)) {
    if (text.includes(word)) {
      const off = includesAny(text, ['выкл', 'убер', 'off', 'remove', 'stop']);
      setState({ effect: off ? 'none' : effect }, { action: 'effect' });
      return `effect ${off ? 'off' : effect}`;
    }
  }
  if (includesAny(text, ['без эффект', 'no effect', 'effects off', 'выключи эффект'])) { setState({ effect: 'none' }, { action: 'effect' }); return 'effects off'; }
  for (const [word, shape] of Object.entries(SHAPES)) {
    if (text.includes(word) && obj) { updateActiveObject({ shape }, { action: 'shape' }); return `shape ${shape}`; }
  }
  for (const [word, color] of Object.entries(COLORS)) {
    if (text.includes(word) && obj) { updateActiveObject({ color }, { action: 'color' }); return `color ${color}`; }
  }
  for (const [word, key] of Object.entries(ANIMS)) {
    if (text.includes(word) && obj && ANIMATION_KEYS.includes(key)) {
      const off = includesAny(text, ['выкл', 'убер', 'без', 'off', 'remove']);
      const set = new Set(obj.animations);
      if (off) set.delete(key); else set.add(key);
      updateActiveObject({ animations: Array.from(set) }, { action: 'anim' });
      return `${off ? '-' : '+'} ${key}`;
    }
  }
  if (includesAny(text, ['больше', 'bigger', 'larger'])) { if (obj) updateActiveObject({ size: Math.min(360, obj.size + 40) }, { action: 'props' }); return 'bigger'; }
  if (includesAny(text, ['меньше', 'smaller'])) { if (obj) updateActiveObject({ size: Math.max(30, obj.size - 40) }, { action: 'props' }); return 'smaller'; }
  return null;
}

export function isListening() {
  return listening;
}
