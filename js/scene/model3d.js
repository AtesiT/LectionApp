// CSS 3D: сборка фигур из плоских граней, вращение мышью с инерцией,
// масштаб колёсиком, гироскоп, игральная кость и кубик Рубика.
import { $, el, clamp } from '../core/dom.js';
import { emit, on } from '../core/bus.js';
import { state, subscribe, setState, activeObject } from '../core/store.js';
import { runAnimations } from './animations.js';
import { t } from '../core/i18n.js';
import { toast } from '../ui/toast.js';

export const SHAPES_3D = ['cube', 'pyramid', 'prism', 'cylinder', 'sphere', 'dodecahedron', 'torus', 'dice', 'rubik'];
export const SHAPE3D_ICONS = { cube: '🧊', pyramid: '🔺', prism: '📐', cylinder: '🛢', sphere: '🌐', dodecahedron: '⬡', torus: '🍩', dice: '🎲', rubik: '🧩' };

const DEG = Math.PI / 180;
let wrap; let animEl; let modelEl;
let builtKey = null;
let running = [];
let spinRaf = null;
let animRotY = 0;
let drag = null;
let inertia = null;
let gyro = { on: false, base: null, handler: null };
let rubik = null;
let rolling = false;

// ---------------------------------------------------------------------------
// Сборка фигур
// ---------------------------------------------------------------------------

function face(w, h, transform, cls = '', style = {}) {
  const node = el('div', { class: `m3-face ${cls}`.trim() });
  Object.assign(node.style, {
    width: `${w}px`, height: `${h}px`, marginLeft: `${-w / 2}px`, marginTop: `${-h / 2}px`, transform,
  }, style);
  return node;
}

function buildCube(S, label) {
  const h = S / 2;
  const faces = [
    face(S, S, `translateZ(${h}px)`, 'shade-1'),
    face(S, S, `rotateY(180deg) translateZ(${h}px)`, 'shade-3'),
    face(S, S, `rotateY(90deg) translateZ(${h}px)`, 'shade-2'),
    face(S, S, `rotateY(-90deg) translateZ(${h}px)`, 'shade-2'),
    face(S, S, `rotateX(90deg) translateZ(${h}px)`, 'shade-0'),
    face(S, S, `rotateX(-90deg) translateZ(${h}px)`, 'shade-4'),
  ];
  if (label) faces[0].textContent = label;
  return faces;
}

function buildPyramid(S) {
  const H = S * 0.95;
  const L = Math.hypot(H, S / 2);
  const theta = Math.atan2(S / 2, H) / DEG;
  const faces = [face(S, S, `rotateX(90deg) translateZ(${-H / 2}px)`, 'shade-4')];
  for (let i = 0; i < 4; i++) {
    faces.push(face(S, L,
      `rotateY(${90 * i}deg) translateZ(${S / 2}px) translateY(${H / 2}px) rotateX(${theta}deg) translateY(${-L / 2}px)`,
      `tri shade-${i % 2 ? 2 : 1}`));
  }
  return faces;
}

function buildPrism(S) {
  const D = S * 1.15;
  const T = (S * Math.sqrt(3)) / 2;
  const L = Math.hypot(T, S / 2);
  const phi = Math.atan2(S / 2, T) / DEG;
  const dist = (S * T) / (4 * L);
  const off = (S * S) / (8 * L);
  return [
    face(S, T, `rotateY(90deg) translateZ(${D / 2}px)`, 'tri shade-2'),
    face(S, T, `rotateY(-90deg) translateZ(${D / 2}px)`, 'tri shade-2'),
    face(D, S, `rotateX(90deg) translateZ(${-T / 2}px)`, 'shade-4'),
    face(D, S, `rotateX(${phi}deg) translateZ(${dist}px) translateY(${off}px)`, 'shade-1'),
    face(D, S, `rotateX(${180 - phi}deg) translateZ(${dist}px) translateY(${-off}px)`, 'shade-3'),
  ];
}

function buildCylinder(S) {
  const R = S * 0.42;
  const H = S * 0.92;
  const N = 24;
  const w = 2 * R * Math.tan(Math.PI / N) + 0.8;
  const faces = [];
  for (let i = 0; i < N; i++) {
    faces.push(face(w, H, `rotateY(${(360 / N) * i}deg) translateZ(${R}px)`, `strip shade-${i % 4}`));
  }
  faces.push(face(2 * R, 2 * R, `rotateX(90deg) translateZ(${H / 2}px)`, 'round shade-0'));
  faces.push(face(2 * R, 2 * R, `rotateX(-90deg) translateZ(${H / 2}px)`, 'round shade-4'));
  return faces;
}

function buildSphere(S) {
  const R = S * 0.44;
  const faces = [];
  for (let i = 0; i < 6; i++) faces.push(face(2 * R, 2 * R, `rotateY(${30 * i}deg)`, 'ring'));
  for (const lat of [-60, -30, 0, 30, 60]) {
    const r = R * Math.cos(lat * DEG);
    const y = R * Math.sin(lat * DEG);
    faces.push(face(2 * r, 2 * r, `translateY(${y}px) rotateX(90deg)`, `ring ${lat === 0 ? 'ring-eq' : ''}`));
  }
  faces.push(face(R * 0.9, R * 0.9, 'translateZ(0)', 'round core'));
  return faces;
}

function pentagonClip() {
  const pts = [];
  for (let i = 0; i < 5; i++) {
    const a = -90 + 72 * i;
    pts.push(`${(50 + 50 * Math.cos(a * DEG)).toFixed(2)}% ${(50 + 50 * Math.sin(a * DEG)).toFixed(2)}%`);
  }
  return `polygon(${pts.join(', ')})`;
}

function buildDodecahedron(S) {
  const Rp = S * 0.33;
  const ri = 1.30902 * Rp;
  const theta = 26.565;
  const clip = pentagonClip();
  const style = { clipPath: clip };
  const faces = [
    face(2 * Rp, 2 * Rp, `rotateX(90deg) translateZ(${ri}px)`, 'shade-0', style),
    face(2 * Rp, 2 * Rp, `rotateX(-90deg) translateZ(${ri}px)`, 'shade-4', style),
  ];
  for (let k = 0; k < 5; k++) {
    faces.push(face(2 * Rp, 2 * Rp, `rotateY(${72 * k}deg) rotateX(${theta}deg) translateZ(${ri}px) rotateZ(180deg)`, `shade-${1 + (k % 2)}`, style));
    faces.push(face(2 * Rp, 2 * Rp, `rotateY(${36 + 72 * k}deg) rotateX(${-theta}deg) translateZ(${ri}px)`, `shade-${2 + (k % 2)}`, style));
  }
  return faces;
}

function buildTorus(S) {
  const R = S * 0.3;
  const r = S * 0.15;
  const N = 18;
  const faces = [];
  for (let i = 0; i < N; i++) {
    faces.push(face(2 * r, 2 * r, `rotateY(${(360 / N) * i}deg) translateZ(${R}px) rotateY(90deg)`, 'ring'));
  }
  faces.push(face(2 * (R + r), 2 * (R + r), 'rotateX(90deg)', 'ring ring-eq'));
  faces.push(face(2 * (R - r), 2 * (R - r), 'rotateX(90deg)', 'ring ring-eq'));
  faces.push(face(2 * R, 2 * R, `translateY(${-r}px) rotateX(90deg)`, 'ring'));
  faces.push(face(2 * R, 2 * R, `translateY(${r}px) rotateX(90deg)`, 'ring'));
  return faces;
}

const PIPS = { 1: [4], 2: [2, 6], 3: [2, 4, 6], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const DICE_FACES = [
  { n: 1, tf: (h) => `translateZ(${h}px)` },
  { n: 6, tf: (h) => `rotateY(180deg) translateZ(${h}px)` },
  { n: 2, tf: (h) => `rotateY(90deg) translateZ(${h}px)` },
  { n: 5, tf: (h) => `rotateY(-90deg) translateZ(${h}px)` },
  { n: 3, tf: (h) => `rotateX(90deg) translateZ(${h}px)` },
  { n: 4, tf: (h) => `rotateX(-90deg) translateZ(${h}px)` },
];
// Поворот модели, при котором грань n смотрит на зрителя
const DICE_TARGET = { 1: [0, 0], 6: [0, 180], 2: [0, -90], 5: [0, 90], 3: [-90, 0], 4: [90, 0] };

function buildDice(S) {
  const h = S / 2;
  return DICE_FACES.map(({ n, tf }) => {
    const f = face(S, S, tf(h), 'dice-face');
    for (let i = 0; i < 9; i++) {
      f.append(el('span', { class: `pip ${PIPS[n].includes(i) ? 'on' : ''}` }));
    }
    return f;
  });
}

// --- Кубик Рубика -----------------------------------------------------------

const RUBIK_COLORS = { px: '#ef4444', nx: '#f97316', py: '#facc15', ny: '#f8fafc', pz: '#22c55e', nz: '#3b82f6' };

function matMul(a, b) {
  const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i][j] += a[i][k] * b[k][j];
  return r;
}
function matVec(m, v) {
  return [0, 1, 2].map((i) => Math.round(m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]));
}
function rotMatrix(axis, deg) {
  const c = Math.round(Math.cos(deg * DEG));
  const s = Math.round(Math.sin(deg * DEG));
  if (axis === 'x') return [[1, 0, 0], [0, c, -s], [0, s, c]];
  if (axis === 'y') return [[c, 0, s], [0, 1, 0], [-s, 0, c]];
  return [[c, -s, 0], [s, c, 0], [0, 0, 1]];
}
function matrix3d(m) {
  return `matrix3d(${m[0][0]},${m[1][0]},${m[2][0]},0,${m[0][1]},${m[1][1]},${m[2][1]},0,${m[0][2]},${m[1][2]},${m[2][2]},0,0,0,0,1)`;
}

function buildRubik(S) {
  const c = S / 3.4;
  const gap = c * 0.08;
  const d = c + gap;
  const cubelets = [];
  const nodes = [];
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    const node = el('div', { class: 'cubelet' });
    const h = c / 2;
    const stickers = [
      ['pz', `translateZ(${h}px)`, z === 1], ['nz', `rotateY(180deg) translateZ(${h}px)`, z === -1],
      ['px', `rotateY(90deg) translateZ(${h}px)`, x === 1], ['nx', `rotateY(-90deg) translateZ(${h}px)`, x === -1],
      ['ny', `rotateX(90deg) translateZ(${h}px)`, y === -1], ['py', `rotateX(-90deg) translateZ(${h}px)`, y === 1],
    ];
    for (const [key, tf, outer] of stickers) {
      const f = face(c, c, tf, 'sticker');
      f.style.background = outer ? RUBIK_COLORS[key] : '#111827';
      node.append(f);
    }
    const cubelet = { pos: [x, y, z], m: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], node };
    cubelets.push(cubelet);
    nodes.push(node);
  }
  const model = { cubelets, d, history: [], busy: false, queue: [] };
  for (const cb of cubelets) renderCubelet(cb, d);
  return { nodes, model };
}

function renderCubelet(cb, d) {
  cb.node.style.transform = `translate3d(${cb.pos[0] * d}px, ${cb.pos[1] * d}px, ${cb.pos[2] * d}px) ${matrix3d(cb.m)}`;
}

const RUBIK_MOVES = {
  U: ['y', -1, 90], D: ['y', 1, -90], R: ['x', 1, -90], L: ['x', -1, 90], F: ['z', 1, -90], B: ['z', -1, 90],
  "U'": ['y', -1, -90], "D'": ['y', 1, 90], "R'": ['x', 1, 90], "L'": ['x', -1, -90], "F'": ['z', 1, 90], "B'": ['z', -1, -90],
};

function rubikTurn(axis, slice, deg, record = true) {
  if (!rubik || !modelEl.contains(rubik.cubelets[0].node)) return Promise.resolve();
  if (rubik.busy) {
    return new Promise((resolve) => rubik.queue.push(() => rubikTurn(axis, slice, deg, record).then(resolve)));
  }
  rubik.busy = true;
  const idx = axis === 'x' ? 0 : axis === 'y' ? 1 : 2;
  const layer = el('div', { class: 'rubik-layer' });
  const moving = rubik.cubelets.filter((cb) => cb.pos[idx] === slice);
  const root = rubik.cubelets[0].node.parentElement;
  root.append(layer);
  moving.forEach((cb) => layer.append(cb.node));
  const rotFn = (a) => (axis === 'x' ? `rotateX(${a}deg)` : axis === 'y' ? `rotateY(${a}deg)` : `rotateZ(${a}deg)`);
  const anim = layer.animate([{ transform: rotFn(0) }, { transform: rotFn(deg) }], { duration: 320, easing: 'ease-in-out', fill: 'forwards' });
  return anim.finished.then(() => {
    const R = rotMatrix(axis, deg);
    for (const cb of moving) {
      cb.pos = matVec(R, cb.pos);
      cb.m = matMul(R, cb.m);
      renderCubelet(cb, rubik.d);
      root.append(cb.node);
    }
    layer.remove();
    if (record) rubik.history.push([axis, slice, deg]);
    rubik.busy = false;
    const next = rubik.queue.shift();
    if (next) next();
  }).catch(() => { rubik.busy = false; });
}

export function rubikMove(name) {
  const mv = RUBIK_MOVES[name];
  if (!mv) return;
  rubikTurn(...mv);
  emit('rubik:move', name);
}

export function rubikScramble(count = 14) {
  const names = ['U', 'D', 'R', 'L', 'F', 'B'];
  for (let i = 0; i < count; i++) rubikTurn(...RUBIK_MOVES[names[Math.floor(Math.random() * names.length)]]);
  emit('rubik:scramble');
  emit('feed', { action: 'rubik' });
}

export function rubikSolve() {
  if (!rubik) return;
  const moves = rubik.history.slice().reverse();
  rubik.history = [];
  for (const [axis, slice, deg] of moves) rubikTurn(axis, slice, -deg, false);
  emit('feed', { action: 'rubikSolve' });
}

/** Собирает DOM фигуры. Используется и для главной сцены, и для мини-карточек. */
export function buildModel(shape, size, color, label = '3D') {
  const root = el('div', { class: `m3 m3-${shape}` });
  root.style.width = `${size}px`;
  root.style.height = `${size}px`;
  root.style.setProperty('--m-color', color);
  let faces;
  let rubikModel = null;
  switch (shape) {
    case 'pyramid': faces = buildPyramid(size); break;
    case 'prism': faces = buildPrism(size); break;
    case 'cylinder': faces = buildCylinder(size); break;
    case 'sphere': faces = buildSphere(size); break;
    case 'dodecahedron': faces = buildDodecahedron(size); break;
    case 'torus': faces = buildTorus(size); break;
    case 'dice': faces = buildDice(size); break;
    case 'rubik': { const r = buildRubik(size); faces = r.nodes; rubikModel = r.model; break; }
    default: faces = buildCube(size, label);
  }
  root.append(...faces);
  return { root, rubikModel };
}

// ---------------------------------------------------------------------------
// Главная сцена
// ---------------------------------------------------------------------------

export function init() {
  wrap = $('#model3dWrap');
  animEl = $('#model3dAnim');
  modelEl = $('#model3d');
  subscribe(onState);
  setupDrag();
  setupWheel();
  on('gesture:pinch', ({ scale }) => {
    if (!state.use3d) return;
    setState({ modelZoom: clamp(state.modelZoom * scale, 0.4, 2.4) }, { transient: true });
  });
  on('gesture:pinchend', () => {
    if (state.use3d) setState({ modelZoom: Number(state.modelZoom.toFixed(2)) }, { coalesce: 'zoom' });
  });
  render(true);
}

function onState(s, patch, meta) {
  const keys = Object.keys(patch);
  const rebuild = keys.some((k) => ['use3d', 'shape3d', 'webgl'].includes(k)) || meta.replace
    || ('objects' in patch && activeObject()?.color !== builtColor());
  if (rebuild) render(true);
  if (keys.some((k) => ['modelRotX', 'modelRotY', 'modelZoom'].includes(k))) applyTransform();
  if (keys.some((k) => ['speed', 'playing', 'objects', 'use3d', 'shape3d', 'webgl'].includes(k)) || meta.replace) restartAnimations();
}

function builtColor() {
  return builtKey?.split('|')[1];
}

export function render(force = false) {
  const visible = state.use3d && !state.webgl;
  wrap.classList.toggle('hidden', !state.use3d);
  modelEl.classList.toggle('hidden', !visible);
  const color = activeObject()?.color ?? '#38BDF8';
  const key = `${state.shape3d}|${color}`;
  if (visible && (force || key !== builtKey)) {
    modelEl.textContent = '';
    const { root, rubikModel } = buildModel(state.shape3d, 150, color);
    rubik = rubikModel;
    modelEl.append(root);
    builtKey = key;
  }
  applyTransform();
}

export function applyTransform() {
  if (!modelEl) return;
  modelEl.style.transform = `rotateX(${state.modelRotX}deg) rotateY(${state.modelRotY + animRotY}deg) scale(${state.modelZoom})`;
}

function restartAnimations() {
  running.forEach((a) => a.cancel());
  running = [];
  if (spinRaf) { cancelAnimationFrame(spinRaf); spinRaf = null; }
  animRotY = 0;
  applyTransform();
  if (!state.use3d || !state.playing) return;
  const obj = activeObject();
  const keys = (obj?.animations ?? []).filter((k) => k !== 'rotate' && k !== 'morph');
  running = runAnimations(keys, { anim: animEl, fx: animEl }, { speed: state.speed, shape: 'circle' });
  if (obj?.animations?.includes('rotate') && state.shape3d !== 'dice') startSpin();
}

function startSpin() {
  const started = performance.now();
  const duration = 3000 / Math.max(0.1, state.speed);
  const tick = (now) => {
    animRotY = (((now - started) % duration) / duration) * 360;
    if (!drag && !rolling) applyTransform();
    spinRaf = requestAnimationFrame(tick);
  };
  spinRaf = requestAnimationFrame(tick);
}

// --- вращение мышью с инерцией --------------------------------------------------

function setupDrag() {
  const stage = $('#stage');
  stage.addEventListener('pointerdown', (e) => {
    if (!state.use3d || rolling) return;
    if (e.button !== undefined && e.button !== 0) return;
    if (document.body.classList.contains('board-mode')) return;
    if (e.target.closest('.stage-toolbar')) return;
    e.preventDefault();
    stopInertia();
    drag = {
      pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, rotX: state.modelRotX, rotY: state.modelRotY,
      moved: false, samples: [{ t: performance.now(), x: e.clientX, y: e.clientY }],
    };
    stage.classList.add('dragging-3d');
    try { stage.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    drag.samples.push({ t: performance.now(), x: e.clientX, y: e.clientY });
    if (drag.samples.length > 5) drag.samples.shift();
    setState({
      modelRotY: drag.rotY + dx * 0.5,
      modelRotX: clamp(drag.rotX - dy * 0.5, -85, 85),
    }, { transient: true });
  });
  const finish = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = drag;
    drag = null;
    stage.classList.remove('dragging-3d');
    try { if (stage.hasPointerCapture(e.pointerId)) stage.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    if (!d.moved) return;
    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const dt = Math.max(16, last.t - first.t);
    const vx = ((last.x - first.x) / dt) * 16 * 0.5; // градусов за кадр
    const vy = ((last.y - first.y) / dt) * 16 * 0.5;
    if (Math.abs(vx) > 0.3 || Math.abs(vy) > 0.3) startInertia(vx, -vy);
    else commitRotation(true);
  };
  stage.addEventListener('pointerup', finish);
  stage.addEventListener('pointercancel', finish);
}

function startInertia(vy, vx) {
  stopInertia();
  let velY = vy; let velX = vx;
  const tick = () => {
    velY *= 0.95; velX *= 0.95;
    setState({
      modelRotY: state.modelRotY + velY,
      modelRotX: clamp(state.modelRotX + velX, -85, 85),
    }, { transient: true });
    if (Math.abs(velY) < 0.05 && Math.abs(velX) < 0.05) {
      inertia = null;
      commitRotation(true);
      return;
    }
    inertia = requestAnimationFrame(tick);
  };
  inertia = requestAnimationFrame(tick);
}

function stopInertia() {
  if (inertia) cancelAnimationFrame(inertia);
  inertia = null;
}

function commitRotation(withFeed) {
  const x = Math.round(state.modelRotX);
  const y = Math.round(state.modelRotY) % 360;
  setState({ modelRotX: x, modelRotY: y }, withFeed
    ? { action: 'rotate', vars: { x, y }, coalesce: 'rotate', force: true }
    : { coalesce: 'rotate', force: true });
}

function setupWheel() {
  const stage = $('#stage');
  stage.addEventListener('wheel', (e) => {
    if (!state.use3d) return;
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.92 : 1.08;
    setState({ modelZoom: Number(clamp(state.modelZoom * factor, 0.4, 2.4).toFixed(2)) }, { coalesce: 'zoom', action: null });
  }, { passive: false });
}

export function resetCamera() {
  stopInertia();
  setState({ modelRotX: -18, modelRotY: 28, modelZoom: 1 }, { action: 'rotate', vars: { x: -18, y: 28 } });
}

// --- гироскоп --------------------------------------------------------------------

export async function toggleGyro() {
  const status = $('#gyroStatus');
  if (gyro.on) {
    window.removeEventListener('deviceorientation', gyro.handler);
    gyro = { on: false, base: null, handler: null };
    if (status) status.textContent = t('m3.gyroOff');
    return false;
  }
  if (typeof DeviceOrientationEvent === 'undefined') {
    if (status) status.textContent = t('m3.gyroNo');
    toast(t('m3.gyroNo'), { type: 'warn' });
    return false;
  }
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      if (res !== 'granted') {
        if (status) status.textContent = t('m3.gyroDenied');
        return false;
      }
    } catch {
      if (status) status.textContent = t('m3.gyroDenied');
      return false;
    }
  }
  gyro.handler = (e) => {
    if (e.beta === null || e.gamma === null) return;
    if (!gyro.base) gyro.base = { beta: e.beta, gamma: e.gamma };
    setState({
      modelRotX: clamp(-18 - (e.beta - gyro.base.beta) * 1.2, -85, 85),
      modelRotY: 28 + (e.gamma - gyro.base.gamma) * 1.5,
    }, { transient: true });
  };
  window.addEventListener('deviceorientation', gyro.handler);
  gyro.on = true;
  if (!state.use3d) setState({ use3d: true }, { action: 'mode3d', vars: { shape: t(`s3.${state.shape3d}`) } });
  if (status) status.textContent = t('m3.gyroOn');
  emit('gyro:on');
  return true;
}

export function isGyroOn() {
  return gyro.on;
}

// --- игральная кость -------------------------------------------------------------

export function rollDice() {
  if (rolling) return null;
  if (!state.use3d || state.shape3d !== 'dice') {
    setState({ use3d: true, shape3d: 'dice', webgl: false }, { action: 'shape3d', vars: { shape: t('s3.dice') } });
  }
  const n = 1 + Math.floor(Math.random() * 6);
  const [tx, ty] = DICE_TARGET[n];
  rolling = true;
  stopInertia();
  const turnsX = 360 * (2 + Math.floor(Math.random() * 2));
  const turnsY = 360 * (2 + Math.floor(Math.random() * 2));
  const startX = state.modelRotX % 360;
  const startY = state.modelRotY % 360;
  const targetX = tx + turnsX * (Math.random() > 0.5 ? 1 : -1);
  const targetY = ty + turnsY * (Math.random() > 0.5 ? 1 : -1);
  const duration = 1500;
  const t0 = performance.now();
  emit('dice:rolling');
  const ease = (x) => 1 - Math.pow(1 - x, 3);
  const tick = (now) => {
    const p = Math.min(1, (now - t0) / duration);
    const k = ease(p);
    setState({ modelRotX: startX + (targetX - startX) * k, modelRotY: startY + (targetY - startY) * k }, { transient: true });
    if (p < 1) { requestAnimationFrame(tick); return; }
    rolling = false;
    setState({ modelRotX: tx, modelRotY: ty }, { action: 'dice', vars: { n }, force: true });
    const res = $('#diceResult');
    if (res) res.textContent = t('m3.diceResult', { n });
    emit('dice:rolled', n);
  };
  requestAnimationFrame(tick);
  return n;
}
