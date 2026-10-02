// Простая 2D-физика: гравитация, отскоки от стенок сцены, столкновения кругов.
// Позиции передаются менеджеру объектов через события physics:position.
import { on, emit } from '../core/bus.js';
import { state, subscribe, setState } from '../core/store.js';
import { getStageRect } from './objects.js';
import { rand } from '../core/dom.js';

const bodies = new Map(); // id → { x, y, vx, vy, r }
let enabled = false;
let raf = null;
let last = 0;
let draggedId = null;
const RESTITUTION = 0.78;

export function init() {
  subscribe((s, patch, meta) => {
    if ('physics' in patch || meta.replace) setEnabled(Boolean(s.physics));
    else if ('objects' in patch && enabled) syncBodies();
  });
  if (state.physics) setEnabled(true);
  on('physics:drag', ({ id, x, y }) => {
    const b = bodies.get(id);
    if (!b) return;
    draggedId = id;
    b.x = x; b.y = y; b.vx = 0; b.vy = 0;
    emit('physics:position', { id, x, y });
  });
  on('physics:throw', ({ id, vx, vy }) => {
    const b = bodies.get(id);
    draggedId = null;
    if (!b) return;
    b.vx = Math.max(-2500, Math.min(2500, vx));
    b.vy = Math.max(-2500, Math.min(2500, vy));
  });
  on('object:dragstart', ({ id }) => { if (bodies.has(id)) draggedId = id; });
  on('object:dragend', () => { draggedId = null; });
}

export function isEnabled() {
  return enabled;
}

function syncBodies() {
  const ids = new Set();
  for (const obj of state.objects) {
    ids.add(obj.id);
    let b = bodies.get(obj.id);
    if (!b) {
      b = { x: obj.x, y: obj.y, vx: rand(-120, 120), vy: rand(-200, 0), r: obj.size / 2 };
      bodies.set(obj.id, b);
    }
    b.r = obj.size / 2;
  }
  for (const id of bodies.keys()) if (!ids.has(id)) bodies.delete(id);
}

export function setEnabled(value) {
  if (value === enabled) return;
  enabled = value;
  if (enabled) {
    bodies.clear();
    syncBodies();
    last = performance.now();
    raf = requestAnimationFrame(step);
  } else {
    cancelAnimationFrame(raf);
    raf = null;
    // Фиксируем финальные позиции в состоянии
    const objects = state.objects.map((o) => {
      const b = bodies.get(o.id);
      return b ? { ...o, x: Math.round(b.x), y: Math.round(b.y) } : o;
    });
    bodies.clear();
    emit('physics:release');
    setState({ objects }, { source: 'system' });
  }
}

export function kick() {
  for (const b of bodies.values()) {
    b.vx += rand(-500, 500);
    b.vy -= rand(500, 1100);
  }
  emit('physics:kick');
}

function step(now) {
  raf = requestAnimationFrame(step);
  const dt = Math.min(0.033, (now - last) / 1000);
  last = now;
  if (!state.playing && !draggedId) return;
  const rect = getStageRect();
  const halfW = rect.width / 2;
  const halfH = rect.height / 2;
  const g = state.gravity * 1400;

  for (const [id, b] of bodies) {
    if (id === draggedId) continue;
    b.vy += g * dt;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const maxX = halfW - b.r;
    const maxY = halfH - b.r;
    if (b.x > maxX) { b.x = maxX; b.vx = -Math.abs(b.vx) * RESTITUTION; }
    if (b.x < -maxX) { b.x = -maxX; b.vx = Math.abs(b.vx) * RESTITUTION; }
    if (b.y > maxY) {
      b.y = maxY;
      b.vy = -Math.abs(b.vy) * RESTITUTION;
      if (Math.abs(b.vy) < 40) b.vy = 0;
      b.vx *= 0.985;
    }
    if (b.y < -maxY) { b.y = -maxY; b.vy = Math.abs(b.vy) * RESTITUTION; }
  }

  // Столкновения (упругие, равные массы)
  const list = Array.from(bodies.entries());
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const [idA, a] = list[i];
      const [idB, b] = list[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 0.001;
      const minDist = (a.r + b.r) * 0.92;
      if (dist >= minDist) continue;
      const nx = dx / dist;
      const ny = dy / dist;
      const overlap = minDist - dist;
      const aFixed = idA === draggedId;
      const bFixed = idB === draggedId;
      if (!aFixed) { a.x -= nx * overlap * (bFixed ? 1 : 0.5); a.y -= ny * overlap * (bFixed ? 1 : 0.5); }
      if (!bFixed) { b.x += nx * overlap * (aFixed ? 1 : 0.5); b.y += ny * overlap * (aFixed ? 1 : 0.5); }
      const rvx = b.vx - a.vx;
      const rvy = b.vy - a.vy;
      const vn = rvx * nx + rvy * ny;
      if (vn > 0) continue;
      const impulse = -(1 + RESTITUTION) * vn / 2;
      if (!aFixed) { a.vx -= impulse * nx; a.vy -= impulse * ny; }
      if (!bFixed) { b.vx += impulse * nx; b.vy += impulse * ny; }
      emit('physics:collision', { a: idA, b: idB, force: Math.abs(vn) });
    }
  }

  for (const [id, b] of bodies) emit('physics:position', { id, x: b.x, y: b.y });
}
