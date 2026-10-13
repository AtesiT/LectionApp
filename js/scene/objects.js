// Менеджер объектов на сцене: DOM для каждого объекта, свойства, анимации,
// перетаскивание, траектории, запись пути мышью.
import { $, el, clamp } from '../core/dom.js';
import { emit, on } from '../core/bus.js';
import { state, subscribe, updateObject, setActiveObject, activeObject, updateActiveObject } from '../core/store.js';
import { clipPathFor, isPolygonShape } from './shapes.js';
import { runAnimations, trajectoryPoint, trajectoryDuration } from './animations.js';
import { embedUrl } from '../core/media.js';
import { t } from '../core/i18n.js';
import { toast } from '../ui/toast.js';

const nodes = new Map();           // id → { root, anim, fx, stroke, shape, running: Animation[], sig, animSig }
const overrides = new Map();       // id → {x, y} — позиции от физики
let layer; let stage;
let drag = null;
let mode = 'normal';               // normal | record
let recording = null;
let pathSvg = null;
let loopId = null;
let loopStart = performance.now();
let pausedAt = null;
let stageRect = null;

export function init() {
  layer = $('#objectsLayer');
  stage = $('#stage');
  subscribe(onState);
  setupPointer();
  const ro = new ResizeObserver(() => { stageRect = null; });
  ro.observe(stage);
  loopId = requestAnimationFrame(loop);
  on('physics:position', ({ id, x, y }) => overrides.set(id, { x, y }));
  on('physics:release', () => overrides.clear());
  on('object:jump', (id) => { const n = nodes.get(id); if (n) { n.root.classList.remove('jump'); void n.root.offsetWidth; n.root.classList.add('jump'); } });
  render(true);
}

export function getStageRect() {
  if (!stageRect) stageRect = stage.getBoundingClientRect();
  return stageRect;
}

export function getObjectNode(id) {
  return nodes.get(id)?.root ?? null;
}

// --- рендер -------------------------------------------------------------------

function onState(s, patch, meta) {
  const globalChange = 'speed' in patch || 'playing' in patch || 'use3d' in patch || meta.replace;
  if (!globalChange && !('objects' in patch) && !('activeObjectId' in patch)) return;
  render(globalChange);
}

function objectSignature(obj) {
  const { x, y, animations, customPath, ...visual } = obj;
  return JSON.stringify(visual);
}

function animSignature(obj, s) {
  return JSON.stringify([obj.animations, obj.shape, obj.radius, s.speed, s.playing, s.use3d]);
}

export function render(force = false) {
  const s = state;
  layer.classList.toggle('hidden', s.use3d);
  const seen = new Set();
  s.objects.forEach((obj, index) => {
    seen.add(obj.id);
    let node = nodes.get(obj.id);
    if (!node) {
      node = createNode(obj);
      nodes.set(obj.id, node);
    }
    node.root.style.zIndex = String(index + 1);
    node.root.classList.toggle('active', obj.id === s.activeObjectId);
    const sig = objectSignature(obj);
    if (sig !== node.sig) {
      applyVisual(node, obj);
      node.sig = sig;
    }
    if (!overrides.has(obj.id) && obj.trajectory === 'none') {
      node.root.style.transform = `translate(${obj.x}px, ${obj.y}px)`;
    }
    const aSig = animSignature(obj, s);
    if (force || aSig !== node.animSig) {
      restartAnimations(node, obj);
      node.animSig = aSig;
    }
  });
  for (const [id, node] of nodes) {
    if (!seen.has(id)) {
      node.running.forEach((a) => a.cancel());
      node.root.remove();
      nodes.delete(id);
      overrides.delete(id);
    }
  }
  renderPathPreview();
}

function createNode(obj) {
  const shape = el('div', { class: 'shape' });
  const stroke = el('div', { class: 'shape-stroke' });
  const fx = el('div', { class: 'obj-fx' }, [stroke, shape]);
  const anim = el('div', { class: 'obj-anim' }, [fx]);
  const root = el('div', { class: 'obj', dataset: { id: obj.id } }, [anim]);
  layer.append(root);
  return { root, anim, fx, stroke, shape, running: [], sig: null, animSig: null };
}

function applyVisual(node, obj) {
  const { root, fx, stroke, shape } = node;
  root.style.setProperty('--size', `${obj.size}px`);
  root.style.setProperty('--color', obj.color);
  fx.style.opacity = String(obj.opacity);
  const filters = [];
  if (obj.glow > 0) filters.push(`drop-shadow(0 0 ${Math.round(obj.glow * 28)}px ${obj.color})`);
  if (obj.shadow > 0) filters.push(`drop-shadow(0 ${Math.round(obj.shadow * 18)}px ${Math.round(obj.shadow * 26)}px rgba(0,0,0,${(0.25 + obj.shadow * 0.4).toFixed(2)}))`);
  fx.style.filter = filters.join(' ') || 'none';

  shape.className = `shape shape-${obj.shape}`;
  shape.textContent = '';
  shape.style.cssText = '';
  stroke.style.cssText = '';
  stroke.hidden = true;
  shape.dataset.polygon = isPolygonShape(obj.shape) ? '1' : '0';

  if (isPolygonShape(obj.shape)) {
    const clip = clipPathFor(obj.shape, obj.radius);
    shape.style.clipPath = clip;
    shape.style.background = obj.color;
    if (obj.stroke > 0) {
      stroke.hidden = false;
      stroke.style.clipPath = clip;
      stroke.style.background = obj.strokeColor;
      const k = Math.max(0.2, (obj.size - obj.stroke * 2) / obj.size);
      shape.style.transform = `scale(${k.toFixed(3)})`;
    }
  } else if (obj.shape === 'emoji') {
    shape.textContent = obj.emoji || '🙂';
    shape.style.fontSize = `${Math.round(obj.size * 0.78)}px`;
  } else if (obj.shape === 'text') {
    shape.textContent = obj.text || 'Text';
    const len = Math.max(1, (obj.text || 'Text').length);
    shape.style.fontSize = `${clamp(Math.round((obj.size * 1.6) / len), 12, obj.size * 0.7)}px`;
    shape.style.color = obj.color;
    if (obj.stroke > 0) shape.style.webkitTextStroke = `${Math.min(obj.stroke, 6)}px ${obj.strokeColor}`;
  } else if (obj.shape === 'image') {
    if (obj.image) {
      const img = el('img', { src: obj.image, alt: '', draggable: 'false' });
      shape.append(img);
    } else {
      shape.textContent = '🖼';
      shape.style.fontSize = `${Math.round(obj.size * 0.6)}px`;
    }
    if (obj.stroke > 0) shape.style.outline = `${obj.stroke}px solid ${obj.strokeColor}`;
    shape.style.borderRadius = `${obj.radius}%`;
  } else if (obj.shape === 'video') {
    renderVideoShape(shape, obj);
    if (obj.stroke > 0) shape.style.outline = `${obj.stroke}px solid ${obj.strokeColor}`;
    shape.style.borderRadius = `${obj.radius}%`;
  }
}

/** Объект-видео: ссылка на YouTube/Rutube/VK показывает плеер, файл — <video>. */
export function renderVideoShape(shape, obj, opts = {}) {
  const video = obj.video || null;
  const src = video?.src;
  if (!src || src === 'local-media') {
    shape.textContent = '🎬';
    shape.style.fontSize = `${Math.round((opts.size || obj.size) * 0.55)}px`;
    shape.title = src === 'local-media' ? t('obj.videoLocalOnly') : t('obj.videoPick');
    return;
  }
  const provider = video.provider;
  if (provider === 'file') {
    const tag = el('video', {
      src, autoplay: true, muted: true, loop: true, playsinline: true, preload: 'auto',
      style: { width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', display: 'block' },
    });
    tag.muted = true;
    tag.play?.().catch(() => {});
    shape.append(tag);
    return;
  }
  const frame = el('iframe', {
    src: video.embed || embedUrl(provider, video.id),
    title: 'video',
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
    style: { width: '100%', height: '100%', border: '0', borderRadius: 'inherit', display: 'block', pointerEvents: opts.interactive ? 'auto' : 'none' },
  });
  frame.setAttribute('allowfullscreen', 'true');
  frame.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
  frame.loading = 'lazy';
  shape.append(frame);
}

function restartAnimations(node, obj) {
  node.running.forEach((a) => a.cancel());
  node.running = [];
  if (!state.playing || state.use3d) return;
  node.running = runAnimations(obj.animations, { anim: node.anim, fx: node.fx, shape: node.shape }, {
    speed: state.speed,
    shape: obj.shape,
  });
}

/** Полный перезапуск (например, после Старт). */
export function restartAll() {
  loopStart = performance.now();
  pausedAt = null;
  for (const obj of state.objects) {
    const node = nodes.get(obj.id);
    if (node) {
      restartAnimations(node, obj);
      node.animSig = animSignature(obj, state);
    }
  }
}

// --- цикл: траектории и позиции от физики ----------------------------------

function loop(now) {
  loopId = requestAnimationFrame(loop);
  if (!state.playing) {
    if (pausedAt === null) pausedAt = now;
  } else if (pausedAt !== null) {
    loopStart += now - pausedAt;
    pausedAt = null;
  }
  const rect = getStageRect();
  const radius = Math.max(40, Math.min(rect.width, rect.height) * 0.22);
  const time = pausedAt ?? now;
  for (const obj of state.objects) {
    const node = nodes.get(obj.id);
    if (!node) continue;
    const ov = overrides.get(obj.id);
    if (ov) {
      node.root.style.transform = `translate(${ov.x.toFixed(1)}px, ${ov.y.toFixed(1)}px)`;
      continue;
    }
    if (obj.trajectory === 'none') continue;
    if (drag && drag.id === obj.id) continue;
    const duration = trajectoryDuration(obj.trajectory, state.speed, obj.customPath);
    const phase = ((time - loopStart) % duration) / duration;
    const p = trajectoryPoint(obj.trajectory, phase, obj.customPath, radius);
    const base = obj.trajectory === 'custom' ? { x: 0, y: 0 } : { x: obj.x, y: obj.y };
    node.root.style.transform = `translate(${(base.x + p.x).toFixed(1)}px, ${(base.y + p.y).toFixed(1)}px)`;
  }
}

// --- перетаскивание, выбор, запись пути ----------------------------------------

function stagePoint(e) {
  const rect = getStageRect();
  return { x: e.clientX - rect.left - rect.width / 2, y: e.clientY - rect.top - rect.height / 2 };
}

function setupPointer() {
  stage.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (mode === 'record') {
      startRecording(e);
      return;
    }
    if (state.use3d || document.body.classList.contains('board-mode')) return;
    const objEl = e.target.closest('.obj');
    if (!objEl || !layer.contains(objEl)) return;
    const id = objEl.dataset.id;
    const obj = state.objects.find((o) => o.id === id);
    if (!obj) return;
    e.preventDefault();
    const p = stagePoint(e);
    const ov = overrides.get(id);
    const startPos = ov ? { x: ov.x, y: ov.y } : { x: obj.x, y: obj.y };
    drag = {
      id, pointerId: e.pointerId, startX: p.x, startY: p.y, origin: startPos, moved: false,
      samples: [{ t: performance.now(), x: startPos.x, y: startPos.y }],
    };
    if (state.activeObjectId !== id) setActiveObject(id);
    objEl.classList.add('dragging');
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    emit('object:dragstart', { id });
  });

  stage.addEventListener('pointermove', (e) => {
    if (mode === 'record' && recording) {
      addRecordPoint(e);
      return;
    }
    if (!drag || e.pointerId !== drag.pointerId) return;
    const p = stagePoint(e);
    const dx = p.x - drag.startX;
    const dy = p.y - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    const rect = getStageRect();
    const x = clamp(drag.origin.x + dx, -rect.width / 2, rect.width / 2);
    const y = clamp(drag.origin.y + dy, -rect.height / 2, rect.height / 2);
    drag.samples.push({ t: performance.now(), x, y });
    if (drag.samples.length > 6) drag.samples.shift();
    if (overrides.has(drag.id)) {
      emit('physics:drag', { id: drag.id, x, y });
    } else {
      updateObject(drag.id, { x: Math.round(x), y: Math.round(y) }, { transient: true });
    }
  });

  const finish = (e) => {
    if (mode === 'record' && recording) {
      finishRecording();
      return;
    }
    if (!drag || (e.pointerId !== undefined && e.pointerId !== drag.pointerId)) return;
    const d = drag;
    drag = null;
    nodes.get(d.id)?.root.classList.remove('dragging');
    try { if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!d.moved) return;
    const last = d.samples[d.samples.length - 1];
    const first = d.samples[0];
    const dt = Math.max(16, last.t - first.t) / 1000;
    const velocity = { vx: (last.x - first.x) / dt, vy: (last.y - first.y) / dt };
    if (overrides.has(d.id)) {
      emit('physics:throw', { id: d.id, ...velocity });
    } else {
      updateObject(d.id, { x: Math.round(last.x), y: Math.round(last.y) }, { coalesce: `move-${d.id}` });
    }
    emit('object:dragend', { id: d.id, ...velocity });
  };
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);
  stage.addEventListener('dragstart', (e) => e.preventDefault());
}

// --- запись пользовательской траектории ---------------------------------------

export function startPathRecording() {
  if (!activeObject()) return;
  mode = 'record';
  stage.classList.add('recording-path');
  showHint(t('anim.recording'));
}

export function cancelPathRecording() {
  mode = 'normal';
  recording = null;
  stage.classList.remove('recording-path');
  hideHint();
}

export function isRecording() {
  return mode === 'record';
}

function startRecording(e) {
  const p = stagePoint(e);
  recording = { points: [[Math.round(p.x), Math.round(p.y)]], pointerId: e.pointerId };
  try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  ensurePathSvg();
  drawPolyline(recording.points, true);
}

function addRecordPoint(e) {
  const p = stagePoint(e);
  const last = recording.points[recording.points.length - 1];
  if (Math.hypot(p.x - last[0], p.y - last[1]) < 5) return;
  recording.points.push([Math.round(p.x), Math.round(p.y)]);
  if (recording.points.length > 600) recording.points.shift();
  drawPolyline(recording.points, true);
}

function finishRecording() {
  const pts = recording.points;
  recording = null;
  mode = 'normal';
  stage.classList.remove('recording-path');
  hideHint();
  if (pts.length < 4) {
    toast(t('toast.pathShort'), { type: 'warn' });
    renderPathPreview();
    return;
  }
  updateActiveObject({ customPath: pts, trajectory: 'custom' }, { action: 'trajectory', vars: { traj: t('traj.custom') } });
  toast(t('toast.pathSaved', { n: pts.length }), { type: 'ok' });
  emit('path:recorded', pts.length);
}

function ensurePathSvg() {
  if (pathSvg) return pathSvg;
  pathSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  pathSvg.setAttribute('class', 'path-preview');
  const poly = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  pathSvg.append(poly);
  stage.append(pathSvg);
  return pathSvg;
}

function drawPolyline(points, live = false) {
  const svg = ensurePathSvg();
  const rect = getStageRect();
  svg.setAttribute('viewBox', `0 0 ${rect.width} ${rect.height}`);
  const poly = svg.querySelector('polyline');
  poly.setAttribute('points', points.map(([x, y]) => `${x + rect.width / 2},${y + rect.height / 2}`).join(' '));
  svg.classList.toggle('live', live);
  svg.style.display = points.length ? 'block' : 'none';
}

function renderPathPreview() {
  const obj = activeObject();
  if (recording) return;
  if (obj && obj.trajectory === 'custom' && obj.customPath?.length >= 2 && !state.use3d) {
    drawPolyline(obj.customPath, false);
  } else if (pathSvg) {
    pathSvg.style.display = 'none';
  }
}

function showHint(text) {
  const hint = $('#stageHint');
  if (!hint) return;
  hint.textContent = text;
  hint.hidden = false;
}

function hideHint() {
  const hint = $('#stageHint');
  if (hint) hint.hidden = true;
}

export { showHint, hideHint };
