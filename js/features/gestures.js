// Мобильные жесты: свайп по панели вкладок (переключение вкладок), pinch на сцене
// (зум 3D-модели или размер активного объекта), двойной тап — старт/стоп.
import { $, $$, clamp } from '../core/dom.js';
import { emit } from '../core/bus.js';
import { state, setState, updateActiveObject, activeObject } from '../core/store.js';
import { runCommand } from '../ui/commands.js';

const pointers = new Map();
let pinchStartDist = 0;
let pinchLastDist = 0;
let pinching = false;
let pinchSizeStart = 0;
let lastTap = 0;

export function init() {
  setupPinch();
  setupSwipe();
  setupDoubleTap();
}

function dist() {
  const [a, b] = Array.from(pointers.values());
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function setupPinch() {
  const stage = $('#stage');
  if (!stage) return;
  stage.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      pinching = true;
      pinchStartDist = pinchLastDist = dist();
      pinchSizeStart = activeObject()?.size ?? 0;
      emit('gesture:pinchstart');
    }
  }, { passive: true });
  stage.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!pinching || pointers.size < 2) return;
    const d = dist();
    if (d < 1) return;
    const step = d / (pinchLastDist || d);
    pinchLastDist = d;
    if (state.use3d) {
      emit('gesture:pinch', { scale: step, total: d / pinchStartDist });
    } else if (activeObject()) {
      updateActiveObject({ size: Math.round(clamp(pinchSizeStart * (d / pinchStartDist), 30, 360)) }, { transient: true });
    }
  }, { passive: true });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pinching && pointers.size < 2) {
      pinching = false;
      if (state.use3d) emit('gesture:pinchend');
      else if (activeObject()) updateActiveObject({ size: activeObject().size }, { action: 'props', coalesce: 'size' });
    }
  };
  stage.addEventListener('pointerup', end);
  stage.addEventListener('pointercancel', end);
  stage.addEventListener('lostpointercapture', end);
  // Блокируем нативный pinch-zoom страницы над сценой.
  stage.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
}

function setupSwipe() {
  const panels = $('.tabs')?.parentElement;
  if (!panels) return;
  let startX = 0;
  let startY = 0;
  let startTime = 0;
  let tracking = false;
  panels.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) { tracking = false; return; }
    const target = e.target;
    if (target.closest('input, textarea, select, canvas, .animation-list, .chat-messages, .objects-list')) { tracking = false; return; }
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTime = Date.now();
    tracking = true;
  }, { passive: true });
  panels.addEventListener('touchend', (e) => {
    if (!tracking) return;
    tracking = false;
    const touch = e.changedTouches[0];
    const dx = touch.clientX - startX;
    const dy = touch.clientY - startY;
    if (Date.now() - startTime > 600 || Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    const tabs = $$('.tab[data-tab]');
    const idx = tabs.findIndex((tab) => tab.classList.contains('active'));
    const nextIdx = dx < 0 ? Math.min(tabs.length - 1, idx + 1) : Math.max(0, idx - 1);
    if (nextIdx !== idx) {
      tabs[nextIdx].click();
      tabs[nextIdx].scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
  }, { passive: true });
}

function setupDoubleTap() {
  const stage = $('#stage');
  if (!stage) return;
  stage.addEventListener('touchend', (e) => {
    if (e.touches.length > 0 || e.changedTouches.length !== 1) return;
    if (e.target.closest('button, .obj, canvas.board-canvas')) return;
    const now = Date.now();
    if (now - lastTap < 320) {
      runCommand('toggle');
      lastTap = 0;
    } else {
      lastTap = now;
    }
  }, { passive: true });
}
