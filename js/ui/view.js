// Режимы отображения: полный экран, презентация, Picture-in-Picture (Document PiP API),
// случайная сцена, циклическая смена темы. Здесь же регистрируются глобальные команды.
import { $, $$, pick, randInt, randomColor } from '../core/dom.js';
import { emit, on } from '../core/bus.js';
import { t, toggleLang, getLang } from '../core/i18n.js';
import { state, setState, updateActiveObject, activeObject, addObject, undo, redo, saveLocal, replaceState, DEFAULT_STATE, makeObject } from '../core/store.js';
import { registerCommands } from './commands.js';
import { toast } from './toast.js';
import { ANIMATION_KEYS } from '../scene/animations.js';
import { POLYGON_SHAPES } from '../scene/shapes.js';
import { SHAPES_3D, rollDice, toggleGyro } from '../scene/model3d.js';
import { EFFECTS } from '../scene/effects.js';
import { BG_PRESETS } from '../scene/backgrounds.js';
import { THEMES } from './panels.js';
import { toggleSound, toggleMic } from '../features/audio.js';
import { toggleVoice } from '../features/voice.js';
import { toggleBoardMode } from '../net/whiteboard.js';
import { focusChat } from '../net/chat.js';
import { showQR } from '../net/qr.js';
import { refresh as refreshWeather } from '../features/weather.js';
import { open as openQuiz } from '../features/quiz.js';

let pipWindow = null;
let pipPlaceholder = null;
let presenting = false;

export function init() {
  $('#fullscreenBtn')?.addEventListener('click', () => toggleFullscreen());
  $('#presentBtn')?.addEventListener('click', togglePresentation);
  $('#pipBtn')?.addEventListener('click', togglePiP);
  $('#randomBtn')?.addEventListener('click', randomScene);
  $('#langToggle')?.addEventListener('click', () => { toggleLang(); toast(t('toast.langChanged')); });
  document.addEventListener('fullscreenchange', () => {
    const on = Boolean(document.fullscreenElement);
    $('#fullscreenBtn')?.classList.toggle('active', on);
    if (!on && presenting) setPresentation(false);
  });
  registerAll();
}

// ---------------------------------------------------------------------------
// Полный экран и презентация
// ---------------------------------------------------------------------------

export async function toggleFullscreen(target = document.documentElement) {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else { await target.requestFullscreen(); emit('view:fullscreen'); }
  } catch (err) {
    console.warn(err);
    toast(t('toast.fullscreenFail'), { type: 'warn' });
  }
}

export function togglePresentation() {
  setPresentation(!presenting);
}

function setPresentation(on) {
  presenting = on;
  document.body.classList.toggle('presenting', on);
  $('#presentBtn')?.classList.toggle('active', on);
  if (on) {
    toast(t('toast.presentOn'), { timeout: 3500 });
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.().catch(() => {});
    emit('view:present', true);
  } else {
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    emit('view:present', false);
  }
  window.dispatchEvent(new Event('resize'));
}

export function isPresenting() {
  return presenting;
}

// ---------------------------------------------------------------------------
// Picture-in-Picture: переносим DOM сцены в отдельное окно (Document PiP API, Chrome 116+).
// ---------------------------------------------------------------------------

export async function togglePiP() {
  if (pipWindow) { pipWindow.close(); return; }
  if (!('documentPictureInPicture' in window)) { toast(t('toast.pipFail'), { type: 'warn' }); return; }
  const stageWrap = $('#stageWrap');
  try {
    pipWindow = await window.documentPictureInPicture.requestWindow({ width: 640, height: 420 });
  } catch (err) {
    console.warn(err);
    toast(t('toast.pipFail'), { type: 'warn' });
    pipWindow = null;
    return;
  }
  // Копируем стили
  Array.from(document.styleSheets).forEach((sheet) => {
    try {
      if (sheet.href) {
        const link = pipWindow.document.createElement('link');
        link.rel = 'stylesheet';
        link.href = sheet.href;
        pipWindow.document.head.append(link);
      } else {
        const style = pipWindow.document.createElement('style');
        style.textContent = Array.from(sheet.cssRules).map((r) => r.cssText).join('\n');
        pipWindow.document.head.append(style);
      }
    } catch { /* cross-origin — пропускаем */ }
  });
  pipWindow.document.body.className = `${document.body.className} pip-window`;
  pipPlaceholder = document.createElement('div');
  pipPlaceholder.className = 'pip-placeholder';
  pipPlaceholder.textContent = t('toast.pipOn');
  stageWrap.replaceWith(pipPlaceholder);
  pipWindow.document.body.append(stageWrap);
  $('#pipBtn')?.classList.add('active');
  emit('view:pip');
  toast(t('toast.pipOn'));
  window.dispatchEvent(new Event('resize'));
  pipWindow.addEventListener('pagehide', () => {
    pipPlaceholder?.replaceWith(stageWrap);
    pipPlaceholder = null;
    pipWindow = null;
    $('#pipBtn')?.classList.remove('active');
    window.dispatchEvent(new Event('resize'));
  });
}

// ---------------------------------------------------------------------------
// Случайная сцена
// ---------------------------------------------------------------------------

export function randomScene() {
  const anims = [];
  const count = randInt(1, 3);
  while (anims.length < count) {
    const key = pick(ANIMATION_KEYS);
    if (!anims.includes(key)) anims.push(key);
  }
  const use3d = Math.random() < 0.3;
  const patch = {
    theme: pick(THEMES),
    speed: Number((0.5 + Math.random() * 1.5).toFixed(1)),
    playing: true,
    use3d,
    shape3d: pick(SHAPES_3D.filter((s) => s !== 'rubik')),
    effect: Math.random() < 0.5 ? pick(EFFECTS.filter((e) => e !== 'none' && e !== 'matrix')) : 'none',
    background: { ...state.background, type: 'preset', value: pick(Object.keys(BG_PRESETS)) },
  };
  const obj = activeObject();
  if (obj) {
    patch.objects = state.objects.map((o) => (o.id === obj.id ? {
      ...o, shape: pick(POLYGON_SHAPES), color: randomColor(), size: randInt(90, 240), animations: anims,
      glow: Math.random() < 0.4 ? Number(Math.random().toFixed(2)) : 0, trajectory: Math.random() < 0.25 ? pick(['circle', 'eight']) : 'none',
    } : o));
  }
  setState(patch, { action: 'random' });
  emit('sfx', 'whoosh');
  emit('effects:burst', { kind: 'confetti' });
}

export function nextTheme() {
  const idx = THEMES.indexOf(state.theme);
  setState({ theme: THEMES[(idx + 1) % THEMES.length] }, { action: 'theme' });
}

export function resetScene() {
  const obj = makeObject();
  replaceState({ ...DEFAULT_STATE, objects: [obj], activeObjectId: obj.id, theme: state.theme, cursorFx: state.cursorFx }, { action: 'random', source: 'user' });
  toast(t('cmd.reset'));
}

// ---------------------------------------------------------------------------
// Команды (палитра, горячие клавиши, голос)
// ---------------------------------------------------------------------------

function registerAll() {
  const tabs = ['object', 'animations', 'model', 'scene', 'sound', 'session', 'widgets', 'achievements', 'help'];
  registerCommands([
    { id: 'start', title: 'cmd.start', category: 'scene', run: () => setState({ playing: true }, { action: 'start' }) },
    { id: 'stop', title: 'cmd.stop', category: 'scene', run: () => setState({ playing: false }, { action: 'stop' }) },
    { id: 'toggle', title: 'cmd.toggle', category: 'scene', keys: 'Space', run: () => setState({ playing: !state.playing }, { action: state.playing ? 'stop' : 'start' }) },
    { id: 'random', title: 'cmd.random', category: 'scene', keys: 'R', run: randomScene },
    { id: 'theme', title: 'cmd.theme', category: 'scene', keys: 'T', run: nextTheme },
    { id: '3d', title: 'cmd.3d', category: 'scene', keys: 'D', run: () => setState({ use3d: !state.use3d }, { action: state.use3d ? 'mode2d' : 'mode3d' }) },
    { id: 'physics', title: 'cmd.physics', category: 'scene', run: () => setState({ physics: !state.physics }, { action: state.physics ? 'physicsOff' : 'physics' }) },
    { id: 'addObject', title: 'cmd.addObject', category: 'scene', keys: 'N', run: () => { if (state.objects.length < 12) addObject({ x: randInt(-150, 150), y: randInt(-100, 100), animations: [] }, { action: 'addObject' }); else toast(t('obj.limit'), { type: 'warn' }); } },
    { id: 'snow', title: 'cmd.snow', category: 'scene', run: () => setState({ effect: 'snow' }, { action: 'effect' }) },
    { id: 'rain', title: 'cmd.rain', category: 'scene', run: () => setState({ effect: 'rain' }, { action: 'effect' }) },
    { id: 'fxOff', title: 'cmd.fxOff', category: 'scene', run: () => setState({ effect: 'none' }, { action: 'effectOff' }) },
    { id: 'dice', title: 'cmd.dice', category: 'scene', run: () => { if (!state.use3d || state.shape3d !== 'dice') setState({ use3d: true, shape3d: 'dice' }, { action: 'shape3d' }); setTimeout(rollDice, 150); } },
    { id: 'gyro', title: 'cmd.gyro', category: 'scene', run: toggleGyro },
    { id: 'save', title: 'cmd.save', category: 'scene', keys: 'Ctrl+S', run: () => { saveLocal(); toast(t('toast.saved'), { type: 'success' }); } },
    { id: 'reset', title: 'cmd.reset', category: 'scene', run: resetScene },
    { id: 'undo', title: 'cmd.undo', category: 'misc', keys: 'Ctrl+Z', run: () => undo() },
    { id: 'redo', title: 'cmd.redo', category: 'misc', keys: 'Ctrl+Y', run: () => redo() },
    { id: 'fullscreen', title: 'cmd.fullscreen', category: 'view', keys: 'F', run: () => toggleFullscreen() },
    { id: 'present', title: 'cmd.present', category: 'view', keys: 'P', run: togglePresentation },
    { id: 'pip', title: 'cmd.pip', category: 'view', run: togglePiP },
    { id: 'mute', title: 'cmd.mute', category: 'view', keys: 'M', run: toggleSound },
    { id: 'mic', title: 'cmd.mic', category: 'view', run: toggleMic },
    { id: 'voice', title: 'cmd.voice', category: 'view', keys: 'V', run: toggleVoice },
    { id: 'lang', title: 'cmd.lang', category: 'view', keys: 'L', run: () => { toggleLang(); toast(t('toast.langChanged')); } },
    { id: 'help', title: 'cmd.help', category: 'nav', keys: '?', run: () => emit('help:toggle') },
    { id: 'palette', title: 'cmd.palette', category: 'nav', keys: 'Ctrl+K', run: () => emit('palette:toggle'), hidden: true },
    { id: 'chat', title: 'cmd.chat', category: 'session', keys: 'C', run: () => { openTab('session'); focusChat(); } },
    { id: 'board', title: 'cmd.board', category: 'session', keys: 'B', run: () => toggleBoardMode() },
    { id: 'qr', title: 'cmd.qr', category: 'session', run: showQR },
    { id: 'weather', title: 'cmd.weather', category: 'misc', run: refreshWeather },
    { id: 'quiz', title: 'cmd.quiz', category: 'misc', run: openQuiz },
    ...tabs.map((tab) => ({ id: `tab:${tab}`, title: () => t('cmd.tab', { tab: t(`tab.${tab}`) }), category: 'nav', run: () => openTab(tab) })),
    ...ANIMATION_KEYS.map((key, i) => ({
      id: `anim:${key}`, title: () => t('cmd.anim', { name: t(`a.${key}`) }), category: 'anim', keys: i < 9 ? String(i + 1) : '',
      run: () => {
        const obj = activeObject();
        if (!obj) return;
        const set = new Set(obj.animations);
        if (set.has(key)) set.delete(key); else set.add(key);
        updateActiveObject({ animations: ANIMATION_KEYS.filter((k) => set.has(k)) }, { action: set.size ? 'anim' : 'animNone' });
      },
    })),
  ]);
}

export function openTab(name) {
  const tab = document.querySelector(`.tab[data-tab="${name}"]`);
  if (!tab) return;
  tab.click();
  tab.scrollIntoView({ inline: 'center', block: 'nearest' });
  if (window.innerWidth < 900) document.querySelector('.tabs')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

export function currentLangLabel() {
  return getLang() === 'ru' ? 'EN' : 'RU';
}
