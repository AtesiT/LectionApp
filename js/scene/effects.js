// Погодные и праздничные эффекты на canvas поверх сцены.
import { $, rand, pick } from '../core/dom.js';
import { state, subscribe } from '../core/store.js';
import { on } from '../core/bus.js';

export const EFFECTS = ['none', 'snow', 'rain', 'leaves', 'petals', 'fireflies', 'fog', 'confetti', 'stars', 'matrix'];

let canvas; let ctx;
let W = 0; let H = 0; let dpr = 1;
let particles = [];
let bursts = [];
let current = 'none';
let intensity = 1;
let raf = null;
let lastTime = 0;
let flashAlpha = 0;
let matrixColumns = [];
let wind = 0;

export function init() {
  canvas = $('#fxCanvas');
  ctx = canvas.getContext('2d');
  const stage = $('#stage');
  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  resize();
  subscribe((s, patch, meta) => {
    if ('effect' in patch || 'effectIntensity' in patch || meta.replace) setEffect(s.effect, s.effectIntensity);
  });
  on('effects:burst', (kind) => burst(kind));
  on('effects:flash', () => { flashAlpha = 0.9; ensureLoop(); });
  on('weather:wind', (value) => { wind = value; });
  setEffect(state.effect, state.effectIntensity);
}

function resize() {
  const stage = $('#stage');
  dpr = Math.min(2, window.devicePixelRatio || 1);
  W = stage.clientWidth || 600;
  H = stage.clientHeight || 400;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  if (current === 'matrix') initMatrix();
}

function targetCount(kind) {
  const base = { snow: 140, rain: 220, leaves: 40, petals: 60, fireflies: 45, fog: 14, confetti: 120, stars: 90 }[kind] ?? 0;
  return Math.round(base * intensity * Math.max(0.5, Math.min(1.6, (W * H) / 240000)));
}

export function setEffect(kind, level = 1) {
  intensity = level;
  if (kind !== current) {
    current = kind;
    particles = [];
    if (kind === 'matrix') initMatrix();
  }
  ensureLoop();
}

export function currentEffect() {
  return current;
}

function ensureLoop() {
  if (raf) return;
  lastTime = performance.now();
  raf = requestAnimationFrame(frame);
}

function spawn(kind) {
  switch (kind) {
    case 'snow': return { x: rand(0, W), y: rand(-20, H), r: rand(1, 4), vy: rand(20, 60), sway: rand(0, Math.PI * 2), swaySpeed: rand(0.5, 1.6), o: rand(0.4, 0.95) };
    case 'rain': return { x: rand(-50, W + 50), y: rand(-H, 0), len: rand(10, 22), vy: rand(600, 900), o: rand(0.25, 0.6) };
    case 'leaves': return { x: rand(0, W), y: rand(-40, H), s: rand(7, 14), vy: rand(30, 70), rot: rand(0, Math.PI * 2), vr: rand(-2, 2), sway: rand(0, 6), color: pick(['#d97706', '#b45309', '#dc2626', '#f59e0b', '#84cc16']) };
    case 'petals': return { x: rand(0, W), y: rand(-40, H), s: rand(5, 10), vy: rand(25, 55), rot: rand(0, Math.PI * 2), vr: rand(-1.5, 1.5), sway: rand(0, 6), color: pick(['#fbcfe8', '#f9a8d4', '#f472b6', '#fce7f3']) };
    case 'fireflies': return { x: rand(0, W), y: rand(0, H), r: rand(1.5, 3), a: rand(0, Math.PI * 2), va: rand(-1, 1), v: rand(8, 25), phase: rand(0, Math.PI * 2), blink: rand(0.6, 2) };
    case 'fog': return { x: rand(-W * 0.3, W), y: rand(0, H), rx: rand(W * 0.25, W * 0.5), ry: rand(H * 0.12, H * 0.3), vx: rand(6, 20), o: rand(0.05, 0.16) };
    case 'confetti': return { x: rand(0, W), y: rand(-H, 0), w: rand(5, 10), h: rand(8, 16), vy: rand(60, 140), vx: rand(-30, 30), rot: rand(0, Math.PI * 2), vr: rand(-4, 4), color: pick(['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#facc15', '#22d3ee']) };
    case 'stars': return { x: rand(0, W), y: rand(0, H * 0.8), r: rand(0.5, 2), phase: rand(0, Math.PI * 2), tw: rand(1, 3) };
    default: return null;
  }
}

function initMatrix() {
  const cols = Math.floor(W / 14);
  matrixColumns = Array.from({ length: cols }, () => ({ y: rand(-H, 0), speed: rand(80, 220), chars: [] }));
}

let shootingStar = null;

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;
  ctx.clearRect(0, 0, W, H);

  if (current !== 'none' && current !== 'matrix') {
    const want = targetCount(current);
    while (particles.length < want) particles.push(spawn(current));
    if (particles.length > want) particles.length = want;
    drawParticles(dt, now / 1000);
  } else if (current === 'matrix') {
    drawMatrix(dt);
  }
  drawBursts(dt);
  if (flashAlpha > 0) {
    ctx.fillStyle = `rgba(255,255,255,${flashAlpha.toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
    flashAlpha = Math.max(0, flashAlpha - dt * 2.5);
  }
  if (current === 'none' && bursts.length === 0 && flashAlpha <= 0) {
    cancelAnimationFrame(raf);
    raf = null;
    ctx.clearRect(0, 0, W, H);
  }
}

function drawParticles(dt, time) {
  const windPx = wind * 25;
  switch (current) {
    case 'snow':
      ctx.fillStyle = '#ffffff';
      for (const p of particles) {
        p.y += p.vy * dt;
        p.sway += p.swaySpeed * dt;
        p.x += (Math.sin(p.sway) * 18 + windPx) * dt;
        if (p.y > H + 5) { p.y = -5; p.x = rand(0, W); }
        if (p.x > W + 10) p.x = -10; else if (p.x < -10) p.x = W + 10;
        ctx.globalAlpha = p.o;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      break;
    case 'rain':
      ctx.strokeStyle = '#bfdbfe';
      ctx.lineWidth = 1.2;
      for (const p of particles) {
        p.y += p.vy * dt;
        p.x += (windPx * 4 - 40) * dt;
        if (p.y > H) { p.y = rand(-80, -10); p.x = rand(-50, W + 50); }
        ctx.globalAlpha = p.o;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 2 + wind, p.y - p.len); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    case 'leaves':
    case 'petals':
      for (const p of particles) {
        p.y += p.vy * dt;
        p.sway += dt;
        p.x += (Math.sin(p.sway * 1.3) * 30 + windPx) * dt;
        p.rot += p.vr * dt;
        if (p.y > H + 20) { p.y = -20; p.x = rand(0, W); }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = 0.9;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.s, p.s * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
      break;
    case 'fireflies':
      for (const p of particles) {
        p.a += p.va * dt;
        p.x += Math.cos(p.a) * p.v * dt;
        p.y += Math.sin(p.a) * p.v * dt;
        if (p.x < 0) p.x = W; if (p.x > W) p.x = 0; if (p.y < 0) p.y = H; if (p.y > H) p.y = 0;
        const glow = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * p.blink * 2 + p.phase));
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 6);
        g.addColorStop(0, `rgba(253, 224, 71, ${glow})`);
        g.addColorStop(1, 'rgba(253, 224, 71, 0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 6, 0, Math.PI * 2); ctx.fill();
      }
      break;
    case 'fog':
      for (const p of particles) {
        p.x += (p.vx + windPx) * dt;
        if (p.x - p.rx > W) p.x = -p.rx;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.rx);
        g.addColorStop(0, `rgba(226, 232, 240, ${p.o})`);
        g.addColorStop(1, 'rgba(226, 232, 240, 0)');
        ctx.fillStyle = g;
        ctx.save();
        ctx.scale(1, p.ry / p.rx);
        ctx.beginPath(); ctx.arc(p.x, p.y * (p.rx / p.ry), p.rx, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      break;
    case 'confetti':
      for (const p of particles) {
        p.y += p.vy * dt;
        p.x += (p.vx + windPx) * dt;
        p.rot += p.vr * dt;
        if (p.y > H + 20) { p.y = -20; p.x = rand(0, W); }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot * 2)) + 1);
        ctx.restore();
      }
      break;
    case 'stars':
      ctx.fillStyle = '#ffffff';
      for (const p of particles) {
        const a = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(time * p.tw + p.phase));
        ctx.globalAlpha = a;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
      if (!shootingStar && Math.random() < dt * 0.4) {
        shootingStar = { x: rand(0, W * 0.7), y: rand(0, H * 0.4), vx: rand(500, 800), vy: rand(150, 300), life: 0.8 };
      }
      if (shootingStar) {
        const s = shootingStar;
        s.x += s.vx * dt; s.y += s.vy * dt; s.life -= dt;
        const grad = ctx.createLinearGradient(s.x, s.y, s.x - s.vx * 0.15, s.y - s.vy * 0.15);
        grad.addColorStop(0, 'rgba(255,255,255,0.95)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - s.vx * 0.15, s.y - s.vy * 0.15); ctx.stroke();
        if (s.life <= 0 || s.x > W + 50) shootingStar = null;
      }
      break;
    default:
      break;
  }
}

const MATRIX_CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF<>/{}=*+-';

function drawMatrix(dt) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
  ctx.fillRect(0, 0, W, H);
  ctx.font = '13px monospace';
  matrixColumns.forEach((col, i) => {
    col.y += col.speed * dt * intensity;
    const x = i * 14 + 4;
    const ch = MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)];
    ctx.fillStyle = '#bbf7d0';
    ctx.fillText(ch, x, col.y);
    ctx.fillStyle = '#22c55e';
    ctx.fillText(MATRIX_CHARS[Math.floor(Math.random() * MATRIX_CHARS.length)], x, col.y - 14);
    if (col.y > H + rand(0, 200)) col.y = rand(-200, 0);
  });
}

/** Одноразовый залп: конфетти, сердечки, звёзды. */
export function burst(kind = 'confetti', x = W / 2, y = H / 2) {
  const colors = ['#f43f5e', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#facc15', '#22d3ee'];
  const n = kind === 'hearts' ? 26 : 90;
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const v = rand(120, kind === 'hearts' ? 260 : 520);
    bursts.push({
      kind, x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 200, life: rand(1.2, 2.2), age: 0,
      rot: rand(0, Math.PI * 2), vr: rand(-6, 6), color: kind === 'hearts' ? pick(['#fb7185', '#f472b6', '#e11d48']) : pick(colors), s: rand(5, 11),
    });
  }
  ensureLoop();
}

function drawBursts(dt) {
  if (!bursts.length) return;
  for (const p of bursts) {
    p.age += dt;
    p.vy += 600 * dt;
    p.vx *= 0.985;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
    const alpha = Math.max(0, 1 - p.age / p.life);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    if (p.kind === 'hearts') {
      ctx.font = `${p.s * 2}px serif`;
      ctx.fillText('♥', -p.s / 2, p.s / 2);
    } else {
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
    }
    ctx.restore();
  }
  bursts = bursts.filter((p) => p.age < p.life);
  ctx.globalAlpha = 1;
}
