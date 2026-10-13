// Каталог анимаций (Web Animations API) и траекторий движения.
import { clipPathFor } from './shapes.js';

/**
 * target: 'anim' — обёртка объекта (transform), 'fx' — слой с фильтрами (opacity/filter),
 *         'shape' — сама фигура (clip-path для морфинга).
 * composite: 'add' позволяет складывать несколько transform-анимаций.
 */
export const ANIMATIONS = [
  { key: 'pulse', color: '#38BDF8', stage: '#0EA5E9', duration: 1200, target: 'anim', composite: 'add',
    keyframes: () => [{ transform: 'scale(1)' }, { transform: 'scale(1.15)' }, { transform: 'scale(1)' }] },
  { key: 'rotate', color: '#A78BFA', stage: '#7C3AED', duration: 3000, easing: 'linear', target: 'anim', composite: 'add',
    keyframes: () => [{ transform: 'rotate(0deg)' }, { transform: 'rotate(360deg)' }] },
  { key: 'slide', color: '#34D399', stage: '#10B981', duration: 2000, target: 'anim', composite: 'add',
    keyframes: () => [
      { transform: 'translateX(0)' }, { transform: 'translateX(70px)' }, { transform: 'translateX(0)' },
      { transform: 'translateX(-70px)' }, { transform: 'translateX(0)' },
    ] },
  { key: 'fade', color: '#FBBF24', stage: '#F59E0B', duration: 1500, target: 'fx', composite: 'replace',
    keyframes: () => [{ opacity: 1 }, { opacity: 0.25 }, { opacity: 1 }] },
  { key: 'bounce', color: '#F472B6', stage: '#DB2777', duration: 1500, target: 'anim', composite: 'add',
    keyframes: () => [
      { transform: 'translateY(0)', easing: 'cubic-bezier(.2,.8,.2,1)' },
      { transform: 'translateY(-50px)', easing: 'cubic-bezier(.2,.8,.2,1)' },
      { transform: 'translateY(0)', easing: 'cubic-bezier(.34,1.56,.64,1)' },
    ] },
  { key: 'shake', color: '#F87171', stage: '#DC2626', duration: 800, target: 'anim', composite: 'add',
    keyframes: () => [
      { transform: 'translateX(0)' }, { transform: 'translateX(-12px)' }, { transform: 'translateX(12px)' },
      { transform: 'translateX(-10px)' }, { transform: 'translateX(10px)' }, { transform: 'translateX(-6px)' },
      { transform: 'translateX(6px)' }, { transform: 'translateX(0)' },
    ] },
  { key: 'flip', color: '#60A5FA', stage: '#2563EB', duration: 2400, target: 'anim', composite: 'add',
    keyframes: () => [{ transform: 'rotateY(0deg)' }, { transform: 'rotateY(180deg)' }, { transform: 'rotateY(360deg)' }] },
  { key: 'swing', color: '#FB923C', stage: '#EA580C', duration: 2000, target: 'anim', composite: 'add',
    keyframes: () => [
      { transform: 'translateY(-40%) rotate(0deg) translateY(40%)' },
      { transform: 'translateY(-40%) rotate(16deg) translateY(40%)' },
      { transform: 'translateY(-40%) rotate(-12deg) translateY(40%)' },
      { transform: 'translateY(-40%) rotate(8deg) translateY(40%)' },
      { transform: 'translateY(-40%) rotate(-4deg) translateY(40%)' },
      { transform: 'translateY(-40%) rotate(0deg) translateY(40%)' },
    ] },
  { key: 'wobble', color: '#C084FC', stage: '#9333EA', duration: 1600, target: 'anim', composite: 'add',
    keyframes: () => [
      { transform: 'translateX(0) rotate(0deg)' }, { transform: 'translateX(-25px) rotate(-5deg)' },
      { transform: 'translateX(20px) rotate(3deg)' }, { transform: 'translateX(-15px) rotate(-3deg)' },
      { transform: 'translateX(10px) rotate(2deg)' }, { transform: 'translateX(-5px) rotate(-1deg)' },
      { transform: 'translateX(0) rotate(0deg)' },
    ] },
  { key: 'jello', color: '#2DD4BF', stage: '#0D9488', duration: 1600, target: 'anim', composite: 'add',
    keyframes: () => [
      { transform: 'skewX(0deg) skewY(0deg)', offset: 0 }, { transform: 'skewX(0deg) skewY(0deg)', offset: 0.11 },
      { transform: 'skewX(-12.5deg) skewY(-12.5deg)', offset: 0.22 }, { transform: 'skewX(6.25deg) skewY(6.25deg)', offset: 0.33 },
      { transform: 'skewX(-3.125deg) skewY(-3.125deg)', offset: 0.44 }, { transform: 'skewX(1.56deg) skewY(1.56deg)', offset: 0.55 },
      { transform: 'skewX(-0.78deg) skewY(-0.78deg)', offset: 0.66 }, { transform: 'skewX(0.39deg) skewY(0.39deg)', offset: 0.77 },
      { transform: 'skewX(0deg) skewY(0deg)', offset: 1 },
    ] },
  { key: 'heartbeat', color: '#FB7185', stage: '#E11D48', duration: 1400, target: 'anim', composite: 'add',
    keyframes: () => [
      { transform: 'scale(1)', offset: 0 }, { transform: 'scale(1.3)', offset: 0.14 }, { transform: 'scale(1)', offset: 0.28 },
      { transform: 'scale(1.3)', offset: 0.42 }, { transform: 'scale(1)', offset: 0.7 }, { transform: 'scale(1)', offset: 1 },
    ] },
  { key: 'tada', color: '#FACC15', stage: '#CA8A04', duration: 1600, target: 'anim', composite: 'add',
    keyframes: () => [
      { transform: 'scale(1) rotate(0deg)', offset: 0 }, { transform: 'scale(0.9) rotate(-3deg)', offset: 0.1 },
      { transform: 'scale(0.9) rotate(-3deg)', offset: 0.2 }, { transform: 'scale(1.1) rotate(3deg)', offset: 0.3 },
      { transform: 'scale(1.1) rotate(-3deg)', offset: 0.4 }, { transform: 'scale(1.1) rotate(3deg)', offset: 0.5 },
      { transform: 'scale(1.1) rotate(-3deg)', offset: 0.6 }, { transform: 'scale(1.1) rotate(3deg)', offset: 0.7 },
      { transform: 'scale(1.1) rotate(-3deg)', offset: 0.8 }, { transform: 'scale(1.1) rotate(3deg)', offset: 0.9 },
      { transform: 'scale(1) rotate(0deg)', offset: 1 },
    ] },
  { key: 'blink', color: '#E5E7EB', stage: '#6B7280', duration: 1000, easing: 'steps(1, end)', target: 'fx', composite: 'replace',
    keyframes: () => [{ opacity: 1, offset: 0 }, { opacity: 0, offset: 0.5 }, { opacity: 1, offset: 1 }] },
  { key: 'spiral', color: '#818CF8', stage: '#4F46E5', duration: 3000, target: 'anim', composite: 'add',
    keyframes: () => [
      { transform: 'rotate(0deg) scale(1)' }, { transform: 'rotate(360deg) scale(0.3)' }, { transform: 'rotate(720deg) scale(1)' },
    ] },
  { key: 'zigzag', color: '#4ADE80', stage: '#16A34A', duration: 2400, easing: 'linear', target: 'anim', composite: 'add',
    keyframes: () => [
      { transform: 'translate(0, 0)' }, { transform: 'translate(60px, -40px)' }, { transform: 'translate(0, -80px)' },
      { transform: 'translate(-60px, -40px)' }, { transform: 'translate(0, 0)' },
    ] },
  { key: 'orbit', color: '#F59E0B', stage: '#B45309', duration: 3000, easing: 'linear', target: 'anim', composite: 'add',
    keyframes: () => [
      { transform: 'rotate(0deg) translateX(70px) rotate(0deg)' },
      { transform: 'rotate(360deg) translateX(70px) rotate(-360deg)' },
    ] },
  { key: 'color', color: '#F472B6', stage: '#BE185D', duration: 4000, easing: 'linear', target: 'fx', composite: 'add',
    keyframes: () => [{ filter: 'hue-rotate(0deg)' }, { filter: 'hue-rotate(360deg)' }] },
  { key: 'morph', color: '#67E8F9', stage: '#0891B2', duration: 5000, target: 'shape', composite: 'replace',
    keyframes: (shape) => [
      { clipPath: clipPathFor(shape) }, { clipPath: clipPathFor('star') }, { clipPath: clipPathFor('square') },
      { clipPath: clipPathFor('heart') }, { clipPath: clipPathFor('circle') }, { clipPath: clipPathFor(shape) },
    ] },
  { key: 'float', color: '#A3E635', stage: '#4D7C0F', duration: 3200, target: 'anim', composite: 'add',
    keyframes: () => [
      { transform: 'translateY(0) rotate(0deg)' }, { transform: 'translateY(-18px) rotate(2deg)' },
      { transform: 'translateY(0) rotate(0deg)' }, { transform: 'translateY(18px) rotate(-2deg)' }, { transform: 'translateY(0) rotate(0deg)' },
    ] },
  { key: 'rubber', color: '#FDBA74', stage: '#C2410C', duration: 1600, target: 'anim', composite: 'add',
    keyframes: () => [
      { transform: 'scale(1, 1)', offset: 0 }, { transform: 'scale(1.25, 0.75)', offset: 0.3 }, { transform: 'scale(0.75, 1.25)', offset: 0.4 },
      { transform: 'scale(1.15, 0.85)', offset: 0.5 }, { transform: 'scale(0.95, 1.05)', offset: 0.65 }, { transform: 'scale(1.05, 0.95)', offset: 0.75 },
      { transform: 'scale(1, 1)', offset: 1 },
    ] },
];

export const ANIMATION_KEYS = ANIMATIONS.map((a) => a.key);

export function animationByKey(key) {
  return ANIMATIONS.find((a) => a.key === key) ?? null;
}

/**
 * Запускает набор анимаций на элементах объекта.
 * targets = { anim: HTMLElement, fx: HTMLElement, shape: HTMLElement }
 * Возвращает массив Animation для последующего cancel().
 */
export function runAnimations(keys, targets, { speed = 1, shape = 'circle', scale = 1 } = {}) {
  const running = [];
  const list = Array.isArray(keys) ? keys : [];
  for (const key of list) {
    const def = animationByKey(key);
    if (!def) continue;
    const target = targets[def.target] ?? targets.anim;
    if (!target) continue;
    if (def.target === 'shape' && (!targets.shape || targets.shape.dataset.polygon !== '1')) continue;
    let frames = def.keyframes(shape);
    if (scale !== 1 && def.target === 'anim') frames = scaleTranslations(frames, scale);
    try {
      const animation = target.animate(frames, {
        duration: def.duration / Math.max(0.1, speed),
        iterations: Infinity,
        easing: def.easing ?? 'ease-in-out',
        composite: def.composite ?? 'replace',
      });
      running.push(animation);
    } catch (err) {
      console.warn('animation failed', key, err);
    }
  }
  return running;
}

/** Для мини-карточек уменьшаем амплитуду сдвигов (px) пропорционально масштабу. */
function scaleTranslations(frames, scale) {
  return frames.map((frame) => {
    if (!frame.transform) return frame;
    return { ...frame, transform: frame.transform.replace(/(-?\d+(?:\.\d+)?)px/g, (_, n) => `${(Number(n) * scale).toFixed(2)}px`) };
  });
}

// --- Траектории -------------------------------------------------------------

export const TRAJECTORIES = ['none', 'circle', 'eight', 'custom'];

/** Точка на траектории для фазы t ∈ [0,1). Возвращает {x, y} в px относительно центра. */
export function trajectoryPoint(kind, t, customPath = [], radius = 90) {
  const a = t * Math.PI * 2;
  if (kind === 'circle') return { x: Math.cos(a) * radius, y: Math.sin(a) * radius };
  if (kind === 'eight') return { x: Math.sin(a) * radius * 1.4, y: Math.sin(a) * Math.cos(a) * radius * 1.4 };
  if (kind === 'custom' && customPath.length >= 2) return pointOnPath(customPath, t);
  return { x: 0, y: 0 };
}

const pathCache = new WeakMap();

function pathLengths(path) {
  let cached = pathCache.get(path);
  if (cached) return cached;
  const lens = [0];
  for (let i = 1; i < path.length; i++) {
    lens.push(lens[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  }
  // Замыкаем путь
  const closing = Math.hypot(path[0][0] - path[path.length - 1][0], path[0][1] - path[path.length - 1][1]);
  cached = { lens, total: lens[lens.length - 1] + closing };
  pathCache.set(path, cached);
  return cached;
}

function pointOnPath(path, t) {
  const { lens, total } = pathLengths(path);
  if (total === 0) return { x: path[0][0], y: path[0][1] };
  const d = t * total;
  let i = 1;
  while (i < lens.length && lens[i] < d) i++;
  const a = path[i - 1];
  const b = i < path.length ? path[i] : path[0];
  const segStart = lens[i - 1];
  const segLen = (i < lens.length ? lens[i] : total) - segStart;
  const tt = segLen ? (d - segStart) / segLen : 0;
  return { x: a[0] + (b[0] - a[0]) * tt, y: a[1] + (b[1] - a[1]) * tt };
}

export function trajectoryDuration(kind, speed, customPath = []) {
  const base = kind === 'custom' ? Math.max(2000, Math.min(12000, (customPath.length || 1) * 40)) : 4000;
  return base / Math.max(0.1, speed);
}
