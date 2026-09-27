// Эффекты курсора: шлейф, искры, пузырьки, частицы при клике и ripple на кнопках.
import { $, rand, pick } from '../core/dom.js';
import { state, subscribe } from '../core/store.js';

let canvas; let ctx; let raf = null;
let particles = [];
let mode = 'trail';
let W = 0; let H = 0;
let last = { x: -100, y: -100 };
let accent = '#22d3ee';

export function init() {
  canvas = $('#cursorCanvas');
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  subscribe((s, patch, meta) => {
    if ('cursorFx' in patch || meta.replace) mode = s.cursorFx || 'none';
    if ('theme' in patch || meta.replace) readAccent();
  });
  mode = state.cursorFx || 'none';
  readAccent();

  window.addEventListener('pointermove', (e) => {
    if (mode === 'none' || e.pointerType === 'touch') return;
    const dist = Math.hypot(e.clientX - last.x, e.clientY - last.y);
    last = { x: e.clientX, y: e.clientY };
    if (dist < 3) return;
    if (mode === 'trail') addTrail(e.clientX, e.clientY);
    else if (mode === 'sparkles' && Math.random() < 0.6) addSparkle(e.clientX, e.clientY);
    else if (mode === 'bubbles' && Math.random() < 0.35) addBubble(e.clientX, e.clientY);
    ensureLoop();
  }, { passive: true });

  window.addEventListener('pointerdown', (e) => {
    if (mode === 'none') return;
    for (let i = 0; i < 14; i++) addBurst(e.clientX, e.clientY);
    ensureLoop();
  }, { passive: true });

  // Ripple на кнопках
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    const rect = btn.getBoundingClientRect();
    const span = document.createElement('span');
    span.className = 'ripple';
    const size = Math.max(rect.width, rect.height) * 1.6;
    span.style.width = span.style.height = `${size}px`;
    span.style.left = `${e.clientX - rect.left - size / 2}px`;
    span.style.top = `${e.clientY - rect.top - size / 2}px`;
    btn.append(span);
    setTimeout(() => span.remove(), 650);
  });
}

function readAccent() {
  accent = getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#22d3ee';
}

function resize() {
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = W;
  canvas.height = H;
}

function addTrail(x, y) {
  particles.push({ x, y, r: rand(3, 7), life: 0.5, age: 0, color: accent, type: 'dot' });
}
function addSparkle(x, y) {
  particles.push({ x: x + rand(-6, 6), y: y + rand(-6, 6), r: rand(1.5, 3.5), vx: rand(-40, 40), vy: rand(-60, 10), life: rand(0.5, 0.9), age: 0, color: pick(['#fde68a', '#fff', accent, '#f9a8d4']), type: 'star' });
}
function addBubble(x, y) {
  particles.push({ x: x + rand(-8, 8), y, r: rand(4, 12), vx: rand(-15, 15), vy: rand(-70, -30), life: rand(1, 1.8), age: 0, color: accent, type: 'bubble' });
}
function addBurst(x, y) {
  const a = rand(0, Math.PI * 2);
  const v = rand(80, 260);
  particles.push({ x, y, r: rand(2, 4), vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: rand(0.4, 0.8), age: 0, color: pick([accent, '#fff', '#fde68a']), type: 'dot', gravity: 300 });
}

function ensureLoop() {
  if (raf) return;
  let prev = performance.now();
  const tick = (now) => {
    const dt = Math.min(0.05, (now - prev) / 1000);
    prev = now;
    ctx.clearRect(0, 0, W, H);
    for (const p of particles) {
      p.age += dt;
      if (p.vx !== undefined) { p.x += p.vx * dt; p.y += p.vy * dt; }
      if (p.gravity) p.vy += p.gravity * dt;
      const k = 1 - p.age / p.life;
      if (k <= 0) continue;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.strokeStyle = p.color;
      if (p.type === 'bubble') {
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.stroke();
      } else if (p.type === 'star') {
        ctx.beginPath();
        for (let i = 0; i < 4; i++) {
          const ang = (i * Math.PI) / 2;
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + Math.cos(ang) * p.r * 2, p.y + Math.sin(ang) * p.r * 2);
        }
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * k, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    particles = particles.filter((p) => p.age < p.life);
    if (particles.length) raf = requestAnimationFrame(tick);
    else { raf = null; ctx.clearRect(0, 0, W, H); }
  };
  raf = requestAnimationFrame(tick);
}
