// Панели управления: объект, анимации, 3D, сцена, верхняя панель (undo/redo), тема.
// Панели только отражают состояние (store) и отправляют изменения обратно.
import { $, $$, el, loadJSON, saveJSON, readFileAsDataURL, debounce } from '../core/dom.js';
import { compressImage, parseVideoUrl, readVideoFile, dataUrlBytes } from '../core/media.js';
import { on, emit } from '../core/bus.js';
import { t, getLang } from '../core/i18n.js';
import {
  state, subscribe, setState, updateObject, updateActiveObject, addObject, removeObject, moveObjectLayer,
  setActiveObject, activeObject, undo, redo, canUndo, canRedo, DEFAULT_OBJECT,
} from '../core/store.js';
import { SHAPES, SHAPE_ICONS } from '../scene/shapes.js';
import { ANIMATIONS, TRAJECTORIES } from '../scene/animations.js';
import { SHAPES_3D, SHAPE3D_ICONS, resetCamera, toggleGyro, rollDice, rubikMove, rubikScramble, rubikSolve } from '../scene/model3d.js';
import { BG_PRESETS } from '../scene/backgrounds.js';
import * as objects from '../scene/objects.js';
import { kick } from '../scene/physics.js';
import { toast } from '../ui/toast.js';

export const THEMES = ['dark', 'neon', 'pastel', 'light', 'cyberpunk', 'ocean', 'forest', 'retro'];
const THEME_COLORS = { dark: '#0b1020', neon: '#070711', pastel: '#fdf2f8', light: '#f8fafc', cyberpunk: '#0a0014', ocean: '#03203c', forest: '#0b1f12', retro: '#2a1b0e' };
const ANIM_ICONS = {
  pulse: '💓', rotate: '🔄', slide: '↔️', fade: '🌫', bounce: '🏀', shake: '📳', flip: '🔃', swing: '🎐', wobble: '🫨', jello: '🍮',
  heartbeat: '❤️', tada: '🎉', blink: '💡', spiral: '🌀', zigzag: '⚡', orbit: '🪐', color: '🌈', morph: '🫧', float: '🎈', rubber: '🧽',
};

let favorites = new Set(loadJSON('mp2:favAnims', []));
let animFilter = '';
let favOnly = false;
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_VIDEO = 12 * 1024 * 1024;
// Лимиты на медиа, которое уезжает другим участникам (см. MEDIA_SYNC_BUDGET в store.js).
// data URL примерно на треть длиннее исходного файла — поэтому порог файла ниже бюджета.
const MEDIA_SYNC_BYTES = 90_000;
const BG_IMAGE_SYNC_BYTES = 100_000;

export function init() {
  buildShapeGrid();
  buildShape3dGrid();
  buildBgGrid();
  buildAnimationList();
  bindObjectPanel();
  bindAnimationPanel();
  bindModelPanel();
  bindScenePanel();
  bindTopbar();
  bindStageToolbar();

  subscribe(onState);
  on('history', updateHistoryButtons);
  on('lang', () => { buildAnimationList(); renderObjectsList(); renderShapeGrid(); renderShape3dGrid(); renderBgGrid(); });
  onState(state, { ...state }, { replace: true });
  updateHistoryButtons();
}

// ---------------------------------------------------------------------------
// Реакция на изменение состояния
// ---------------------------------------------------------------------------

function onState(s, patch, meta) {
  const keys = new Set(Object.keys(patch));
  const all = meta.replace;
  if (all || keys.has('theme')) applyTheme(s.theme);
  if (all || keys.has('objects') || keys.has('activeObjectId')) {
    renderObjectControls();
    renderObjectsList();
    renderShapeGrid();
    renderAnimationSelection();
  }
  if (all || keys.has('speed')) {
    $('#speed').value = s.speed;
    $('#speedValue').textContent = `x${Number(s.speed).toFixed(1)}`;
  }
  if (all || keys.has('playing')) {
    $('#startBtn')?.classList.toggle('active', s.playing);
    $('#stopBtn')?.classList.toggle('active', !s.playing);
  }
  if (all || keys.has('use3d')) { $('#use3d').checked = s.use3d; document.body.classList.toggle('mode-3d', s.use3d); }
  if (all || keys.has('webgl')) $('#webglToggle').checked = s.webgl;
  if (all || keys.has('shape3d')) renderShape3dGrid();
  if (all || keys.has('modelZoom')) {
    $('#modelZoom').value = s.modelZoom;
    $('#modelZoomVal').textContent = Number(s.modelZoom).toFixed(1);
  }
  if (all || keys.has('cursorFx')) $('#cursorFxSelect').value = s.cursorFx;
  if (all || keys.has('background')) {
    renderBgGrid();
    $('#parallaxToggle').checked = Boolean(s.background?.parallax);
    if (s.background?.type === 'color') $('#bgColor').value = s.background.value;
  }
  if (all || keys.has('effect')) $('#effectSelect').value = s.effect;
  if (all || keys.has('effectIntensity')) $('#effectIntensity').value = s.effectIntensity;
  if (all || keys.has('weatherSync')) $('#weatherSyncToggle').checked = s.weatherSync;
  if (all || keys.has('physics')) $('#physicsToggle').checked = s.physics;
  if (all || keys.has('gravity')) $('#gravity').value = s.gravity;
}

export function applyTheme(theme) {
  const cls = Array.from(document.body.classList).filter((c) => c.startsWith('theme-'));
  cls.forEach((c) => document.body.classList.remove(c));
  document.body.classList.add(`theme-${theme}`);
  const sel = $('#themeSelect');
  if (sel && sel.value !== theme) sel.value = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme] || '#070711');
}

// ---------------------------------------------------------------------------
// Панель «Объект»
// ---------------------------------------------------------------------------

function buildShapeGrid() {
  const grid = $('#shapeGrid');
  grid.replaceChildren(...SHAPES.map((shape) => el('button', {
    class: 'shape-btn', type: 'button', dataset: { shape }, title: t(`shape.${shape}`),
    onClick: () => updateActiveObject({ shape }, { action: 'shape' }),
  }, [el('span', { class: 'shape-btn-icon', text: SHAPE_ICONS[shape] || '⬤' }), el('span', { class: 'shape-btn-label', text: t(`shape.${shape}`) })])));
}

function renderShapeGrid() {
  const obj = activeObject();
  $$('#shapeGrid .shape-btn').forEach((btn) => {
    btn.classList.toggle('active', obj?.shape === btn.dataset.shape);
    btn.title = t(`shape.${btn.dataset.shape}`);
    btn.querySelector('.shape-btn-label').textContent = t(`shape.${btn.dataset.shape}`);
  });
}

function bindObjectPanel() {
  const bindRange = (id, prop, action = 'props', parse = Number, coalesce = null) => {
    const input = $(`#${id}`);
    input.addEventListener('input', () => updateActiveObject({ [prop]: parse(input.value) }, { transient: true }));
    input.addEventListener('change', () => updateActiveObject({ [prop]: parse(input.value) }, { action, coalesce: coalesce || `prop-${prop}` }));
  };
  bindRange('objSize', 'size');
  bindRange('objOpacity', 'opacity');
  bindRange('objShadow', 'shadow');
  bindRange('objGlow', 'glow');
  bindRange('objStroke', 'stroke');
  bindRange('objRadius', 'radius');
  $('#objSize').addEventListener('input', (e) => { $('#objSizeVal').textContent = e.target.value; });

  const color = $('#objColor');
  color.addEventListener('input', () => updateActiveObject({ color: color.value }, { transient: true }));
  color.addEventListener('change', () => updateActiveObject({ color: color.value }, { action: 'color', coalesce: 'color' }));
  const strokeColor = $('#objStrokeColor');
  strokeColor.addEventListener('input', () => updateActiveObject({ strokeColor: strokeColor.value }, { transient: true }));
  strokeColor.addEventListener('change', () => updateActiveObject({ strokeColor: strokeColor.value }, { action: 'props', coalesce: 'strokeColor' }));

  const emojiInput = $('#objEmoji');
  emojiInput.addEventListener('input', debounce(() => {
    const value = emojiInput.value.trim() || '🚀';
    updateActiveObject({ emoji: value, shape: 'emoji' }, { action: 'shape', coalesce: 'emoji' });
  }, 250));
  const textInput = $('#objText');
  textInput.addEventListener('input', debounce(() => {
    updateActiveObject({ text: textInput.value.slice(0, 24) || 'Motion', shape: 'text' }, { action: 'shape', coalesce: 'text' });
  }, 250));
  $('#objImage').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE) { toast(t('obj.imageTooBig'), { type: 'warn' }); e.target.value = ''; return; }
    try {
      // Сжимаем картинку: тогда она уезжает другим участникам и видят её все.
      const url = await compressImage(file, { maxSide: 256, quality: 0.72, maxBytes: 32_000 });
      if (!url) throw new Error('compress_failed');
      updateActiveObject({ image: url, shape: 'image' }, { action: 'shape' });
      const kb = Math.round(dataUrlBytes(url) / 1024);
      toast(t('obj.imageAdded', { kb }), { icon: '🖼' });
    } catch (err) {
      console.warn(err);
      toast(t('obj.imageFail'), { type: 'warn' });
    }
    e.target.value = '';
  });
  $('#objVideoFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_VIDEO) { toast(t('obj.videoTooBig'), { type: 'warn' }); e.target.value = ''; return; }
    try {
      const { dataUrl, syncable } = await readVideoFile(file, MEDIA_SYNC_BYTES);
      updateActiveObject({ video: { provider: 'file', id: file.name, src: dataUrl }, shape: 'video' }, { action: 'shape' });
      toast(syncable ? t('obj.videoAdded') : t('obj.videoLocal'), { icon: '🎬' });
    } catch (err) {
      console.warn(err);
      toast(t('obj.videoFail'), { type: 'warn' });
    }
    e.target.value = '';
  });
  const applyVideoUrl = () => {
    const url = $('#objVideoUrl').value.trim();
    if (!url) return;
    const parsed = parseVideoUrl(url);
    if (!parsed) { toast(t('obj.videoBadUrl'), { type: 'warn' }); return; }
    updateActiveObject({ video: { provider: parsed.provider, id: parsed.id, src: url, embed: parsed.embed }, shape: 'video' }, { action: 'shape' });
    toast(t('obj.videoLinked', { provider: parsed.label }), { icon: '🎬' });
    $('#objVideoUrl').value = '';
  };
  $('#objVideoUrlBtn').addEventListener('click', applyVideoUrl);
  $('#objVideoUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyVideoUrl(); } });

  $('#addObjectBtn').addEventListener('click', () => {
    if (state.objects.length >= 12) { toast(t('obj.limit'), { type: 'warn' }); return; }
    addObject({ x: Math.round((Math.random() - 0.5) * 240), y: Math.round((Math.random() - 0.5) * 160), animations: [] }, { action: 'addObject' });
  });
  $('#duplicateObjectBtn').addEventListener('click', () => {
    const obj = activeObject();
    if (!obj) return;
    if (state.objects.length >= 12) { toast(t('obj.limit'), { type: 'warn' }); return; }
    const { id, ...rest } = obj;
    addObject({ ...rest, x: obj.x + 40, y: obj.y + 30 }, { action: 'addObject' });
  });
  $('#removeObjectBtn').addEventListener('click', () => {
    const obj = activeObject();
    if (obj) removeObject(obj.id, { action: 'removeObject' });
  });
  $('#layerUpBtn').addEventListener('click', () => { const o = activeObject(); if (o) moveObjectLayer(o.id, 1, { action: 'layer' }); });
  $('#layerDownBtn').addEventListener('click', () => { const o = activeObject(); if (o) moveObjectLayer(o.id, -1, { action: 'layer' }); });
  $('#resetPosBtn').addEventListener('click', () => updateActiveObject({ x: 0, y: 0 }, { action: 'props' }));
}

function renderObjectControls() {
  const obj = activeObject();
  if (!obj) return;
  const set = (id, value) => { const node = $(`#${id}`); if (node && document.activeElement !== node) node.value = value; };
  set('objColor', obj.color);
  set('objStrokeColor', obj.strokeColor);
  set('objSize', obj.size);
  $('#objSizeVal').textContent = obj.size;
  set('objOpacity', obj.opacity);
  set('objShadow', obj.shadow);
  set('objGlow', obj.glow);
  set('objStroke', obj.stroke);
  set('objRadius', obj.radius);
  set('objEmoji', obj.emoji);
  set('objText', obj.text);
  $('#trajectorySelect').value = obj.trajectory || 'none';
  $('#clearPathBtn').disabled = !(obj.customPath?.length);
  $('#removeObjectBtn').disabled = state.objects.length <= 1;
  $('#addObjectBtn').disabled = state.objects.length >= 12;
  $('#duplicateObjectBtn').disabled = state.objects.length >= 12;
}

function renderObjectsList() {
  const list = $('#objectsList');
  if (!list) return;
  const items = state.objects.slice().reverse(); // верхний слой — первым
  list.replaceChildren(...items.map((obj, revIdx) => {
    const idx = state.objects.length - 1 - revIdx;
    const active = obj.id === state.activeObjectId;
    const label = obj.shape === 'emoji' ? obj.emoji : obj.shape === 'text' ? `“${obj.text}”` : t(`shape.${obj.shape}`);
    return el('button', {
      class: `object-item${active ? ' active' : ''}`, type: 'button', dataset: { id: obj.id },
      onClick: () => setActiveObject(obj.id),
    }, [
      el('span', { class: 'object-swatch', style: { background: obj.color, opacity: String(obj.opacity) }, text: obj.shape === 'emoji' ? obj.emoji : '' }),
      el('span', { class: 'object-label', text: `${idx + 1}. ${label}` }),
      el('span', { class: 'object-anims', text: obj.animations.map((k) => ANIM_ICONS[k] || '•').join('') || '—' }),
    ]);
  }));
}

// ---------------------------------------------------------------------------
// Панель «Анимации»
// ---------------------------------------------------------------------------

function buildAnimationList() {
  const list = $('#animationList');
  const obj = activeObject();
  const filter = animFilter.trim().toLowerCase();
  const visible = ANIMATIONS.filter((a) => {
    if (favOnly && !favorites.has(a.key)) return false;
    if (!filter) return true;
    return a.key.includes(filter) || t(`a.${a.key}`).toLowerCase().includes(filter);
  });
  if (!visible.length) {
    list.replaceChildren(el('div', { class: 'hint', text: t('palette.empty') }));
    return;
  }
  list.replaceChildren(...visible.map((a) => {
    const index = ANIMATIONS.indexOf(a);
    const active = obj?.animations.includes(a.key);
    return el('div', {
      class: `anim-card${active ? ' active' : ''}${favorites.has(a.key) ? ' fav' : ''}`, dataset: { key: a.key }, role: 'option',
      'aria-selected': active ? 'true' : 'false', tabindex: '0', style: { '--anim-color': a.color },
      onClick: () => toggleAnimation(a.key),
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleAnimation(a.key); } },
    }, [
      el('span', { class: 'anim-icon', text: ANIM_ICONS[a.key] || '✨' }),
      el('span', { class: 'anim-name', text: t(`a.${a.key}`) }),
      index < 9 ? el('kbd', { class: 'anim-key', text: String(index + 1) }) : null,
      el('button', {
        class: 'anim-fav', type: 'button', title: t('anim.fav'), 'aria-label': t('anim.fav'), text: favorites.has(a.key) ? '★' : '☆',
        onClick: (e) => { e.stopPropagation(); toggleFavorite(a.key); },
      }),
    ]);
  }));
}

function renderAnimationSelection() {
  const obj = activeObject();
  $$('#animationList .anim-card').forEach((card) => {
    const active = Boolean(obj?.animations.includes(card.dataset.key));
    card.classList.toggle('active', active);
    card.setAttribute('aria-selected', active ? 'true' : 'false');
  });
}

export function toggleAnimation(key) {
  const obj = activeObject();
  if (!obj) return;
  const set = new Set(obj.animations);
  if (set.has(key)) set.delete(key); else set.add(key);
  const animations = ANIMATIONS.map((a) => a.key).filter((k) => set.has(k));
  updateActiveObject({ animations }, { action: animations.length ? 'anim' : 'animNone' });
  emit('sfx', set.has(key) ? 'pop' : 'tick');
}

function toggleFavorite(key) {
  if (favorites.has(key)) favorites.delete(key); else favorites.add(key);
  saveJSON('mp2:favAnims', Array.from(favorites));
  buildAnimationList();
}

function bindAnimationPanel() {
  $('#animSearch').addEventListener('input', (e) => { animFilter = e.target.value; buildAnimationList(); });
  $('#favOnly').addEventListener('change', (e) => { favOnly = e.target.checked; buildAnimationList(); });
  $('#clearAnimsBtn').addEventListener('click', () => updateActiveObject({ animations: [] }, { action: 'animNone' }));
  const speed = $('#speed');
  speed.addEventListener('input', () => { $('#speedValue').textContent = `x${Number(speed.value).toFixed(1)}`; setState({ speed: Number(speed.value) }, { transient: true }); });
  speed.addEventListener('change', () => setState({ speed: Number(speed.value) }, { action: 'speed', coalesce: 'speed' }));
  $('#trajectorySelect').addEventListener('change', (e) => {
    const value = e.target.value;
    if (!TRAJECTORIES.includes(value)) return;
    const obj = activeObject();
    if (value === 'custom' && !(obj?.customPath?.length)) { objects.startPathRecording(); return; }
    updateActiveObject({ trajectory: value }, { action: 'trajectory', vars: { traj: t(`traj.${value}`) } });
  });
  $('#recordPathBtn').addEventListener('click', () => {
    if (objects.isRecording()) objects.cancelPathRecording();
    else objects.startPathRecording();
    $('#recordPathBtn').classList.toggle('active', objects.isRecording());
  });
  on('path:recorded', () => { $('#recordPathBtn').classList.remove('active'); });
  $('#clearPathBtn').addEventListener('click', () => {
    const obj = activeObject();
    if (!obj) return;
    updateActiveObject({ customPath: [], trajectory: obj.trajectory === 'custom' ? 'none' : obj.trajectory }, { action: 'trajectory', vars: { traj: t('traj.none') } });
  });
}

// ---------------------------------------------------------------------------
// Панель «3D»
// ---------------------------------------------------------------------------

function buildShape3dGrid() {
  const grid = $('#shape3dGrid');
  grid.replaceChildren(...SHAPES_3D.map((shape) => el('button', {
    class: 'shape-btn', type: 'button', dataset: { shape3d: shape }, title: t(`s3.${shape}`),
    onClick: () => setState({ shape3d: shape, use3d: true }, { action: 'shape3d' }),
  }, [el('span', { class: 'shape-btn-icon', text: SHAPE3D_ICONS[shape] }), el('span', { class: 'shape-btn-label', text: t(`s3.${shape}`) })])));
}

function renderShape3dGrid() {
  $$('#shape3dGrid .shape-btn').forEach((btn) => {
    btn.classList.toggle('active', state.shape3d === btn.dataset.shape3d);
    btn.querySelector('.shape-btn-label').textContent = t(`s3.${btn.dataset.shape3d}`);
  });
}

function bindModelPanel() {
  $('#use3d').addEventListener('change', (e) => setState({ use3d: e.target.checked }, { action: e.target.checked ? 'mode3d' : 'mode2d' }));
  $('#webglToggle').addEventListener('change', (e) => setState({ webgl: e.target.checked, ...(e.target.checked ? { use3d: true } : {}) }, { action: e.target.checked ? 'webgl' : 'webglOff' }));
  const zoom = $('#modelZoom');
  zoom.addEventListener('input', () => { $('#modelZoomVal').textContent = Number(zoom.value).toFixed(1); setState({ modelZoom: Number(zoom.value) }, { transient: true }); });
  zoom.addEventListener('change', () => setState({ modelZoom: Number(zoom.value) }, { action: 'zoom', coalesce: 'zoom' }));
  $('#resetCameraBtn').addEventListener('click', resetCamera);
  $('#gyroBtn').addEventListener('click', toggleGyro);
  $('#diceRollBtn').addEventListener('click', rollDice);
  $('#rubikScrambleBtn').addEventListener('click', () => rubikScramble());
  $('#rubikSolveBtn').addEventListener('click', () => rubikSolve());
  $('#rubikMoves').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-move]');
    if (!btn) return;
    rubikMove(e.shiftKey ? `${btn.dataset.move}'` : btn.dataset.move);
  });
}

// ---------------------------------------------------------------------------
// Панель «Сцена»
// ---------------------------------------------------------------------------

function buildBgGrid() {
  const grid = $('#bgPresetGrid');
  grid.replaceChildren(...Object.keys(BG_PRESETS).map((key) => el('button', {
    class: 'bg-btn', type: 'button', dataset: { bg: key }, title: t(`bg.${key}`),
    style: { background: BG_PRESETS[key] || 'linear-gradient(135deg, #0EA5E9, #7C3AED)' },
    onClick: () => setBackground({ type: 'preset', value: key }),
  }, [el('span', { text: t(`bg.${key}`) })])));
}

function renderBgGrid() {
  const bg = state.background || {};
  $$('#bgPresetGrid .bg-btn').forEach((btn) => {
    btn.classList.toggle('active', bg.type === 'preset' && bg.value === btn.dataset.bg);
    btn.querySelector('span').textContent = t(`bg.${btn.dataset.bg}`);
  });
}

function setBackground(patch, action = 'background') {
  const next = { ...state.background, ...patch };
  const label = next.type === 'preset' ? t(`bg.${next.value}`) : next.type;
  setState({ background: next }, { action, vars: { bg: label } });
}

let bgObjectUrl = null;

function revokeBgVideo() {
  if (bgObjectUrl) { URL.revokeObjectURL(bgObjectUrl); bgObjectUrl = null; }
}

/** Фон по ссылке: YouTube / Rutube / VK → плеер, прямая ссылка → картинка или файл. */
function applyBgUrl() {
  const url = $('#bgUrl').value.trim();
  if (!url) return;
  const video = parseVideoUrl(url);
  if (video) {
    setBackground({ type: 'video', value: url, provider: video.provider, videoId: video.id, embed: video.embed });
    toast(t('scene.videoLinked', { provider: video.label }), { icon: '🎬' });
    return;
  }
  if (/^https?:\/\//i.test(url) || url.startsWith('/')) {
    setBackground({ type: 'image', value: url });
    return;
  }
  toast(t('scene.badUrl'), { type: 'warn' });
}

function bindScenePanel() {
  $('#themeSelect').addEventListener('change', (e) => setState({ theme: e.target.value }, { action: 'theme' }));
  $('#cursorFxSelect').addEventListener('change', (e) => setState({ cursorFx: e.target.value }, { source: 'system' }));
  const bgColor = $('#bgColor');
  bgColor.addEventListener('input', () => setState({ background: { ...state.background, type: 'color', value: bgColor.value } }, { transient: true }));
  bgColor.addEventListener('change', () => setBackground({ type: 'color', value: bgColor.value }));
  $('#bgImageFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_IMAGE) { toast(t('obj.imageTooBig'), { type: 'warn' }); e.target.value = ''; return; }
    try {
      const raw = await readFileAsDataURL(file);
      const url = dataUrlBytes(raw) <= BG_IMAGE_SYNC_BYTES ? raw : await compressImage(file, { maxSide: 1280, quality: 0.8, maxBytes: BG_IMAGE_SYNC_BYTES });
      setBackground({ type: 'image', value: url || raw });
    } catch (err) {
      console.warn(err);
      toast(t('obj.imageFail'), { type: 'warn' });
    }
    e.target.value = '';
  });
  $('#bgVideoFile').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_VIDEO) { toast(t('obj.videoTooBig'), { type: 'warn' }); e.target.value = ''; return; }
    // Небольшой ролик читаем целиком — тогда фон увидят и другие участники.
    if (file.size <= MEDIA_SYNC_BYTES) {
      const { dataUrl } = await readVideoFile(file, MEDIA_SYNC_BYTES);
      setBackground({ type: 'video', value: dataUrl, provider: 'file' });
    } else {
      revokeBgVideo();
      const url = URL.createObjectURL(file);
      bgObjectUrl = url;
      setBackground({ type: 'video', value: url, provider: 'file' });
      toast(t('scene.videoLocalBg'), { icon: '🎬' });
    }
    e.target.value = '';
  });
  $('#bgUrlBtn').addEventListener('click', applyBgUrl);
  $('#bgUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyBgUrl(); } });
  $('#parallaxToggle').addEventListener('change', (e) => setBackground({ parallax: e.target.checked }));
  $('#effectSelect').addEventListener('change', (e) => setState({ effect: e.target.value }, { action: e.target.value === 'none' ? 'effectOff' : 'effect' }));
  const intensity = $('#effectIntensity');
  intensity.addEventListener('input', () => setState({ effectIntensity: Number(intensity.value) }, { transient: true }));
  intensity.addEventListener('change', () => setState({ effectIntensity: Number(intensity.value) }, { source: 'system' }));
  $('#weatherSyncToggle').addEventListener('change', (e) => setState({ weatherSync: e.target.checked }, { action: e.target.checked ? 'weatherSync' : null, source: e.target.checked ? 'user' : 'system' }));
  $('#physicsToggle').addEventListener('change', (e) => setState({ physics: e.target.checked }, { action: e.target.checked ? 'physics' : 'physicsOff' }));
  const gravity = $('#gravity');
  gravity.addEventListener('input', () => setState({ gravity: Number(gravity.value) }, { transient: true }));
  gravity.addEventListener('change', () => setState({ gravity: Number(gravity.value) }, { source: 'system' }));
  $('#kickBtn').addEventListener('click', () => {
    if (!state.physics) setState({ physics: true }, { action: 'physics' });
    kick();
  });
}

// ---------------------------------------------------------------------------
// Верхняя панель и тулбар сцены
// ---------------------------------------------------------------------------

function bindTopbar() {
  $('#undoBtn').addEventListener('click', () => undo());
  $('#redoBtn').addEventListener('click', () => redo());
}

function updateHistoryButtons() {
  $('#undoBtn').disabled = !canUndo();
  $('#redoBtn').disabled = !canRedo();
}

function bindStageToolbar() {
  $('#startBtn').addEventListener('click', () => setState({ playing: true }, { action: 'start' }));
  $('#stopBtn').addEventListener('click', () => setState({ playing: false }, { action: 'stop' }));
}

export function getFavorites() {
  return Array.from(favorites);
}
