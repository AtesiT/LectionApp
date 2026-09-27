// Общая доска: рисование поверх сцены, синхронизация штрихов через сервер.
import { $, uid } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { t } from '../core/i18n.js';
import * as transport from './transport.js';
import { session } from './session.js';
import { toast } from '../ui/toast.js';

let canvas; let ctx; let stage;
let strokes = [];
let active = null;     // текущий штрих
let flushTimer = null;
let pendingPoints = [];
let boardMode = false;
let drawnPoints = 0;

export function init() {
  canvas = $('#boardCanvas');
  ctx = canvas.getContext('2d');
  stage = $('#stage');
  const ro = new ResizeObserver(() => { resize(); redraw(); });
  ro.observe(stage);
  resize();

  $('#drawToggle')?.addEventListener('click', () => toggleBoardMode());
  $('#boardClearBtn')?.addEventListener('click', () => transport.send({ kind: 'board_clear' }));

  canvas.addEventListener('pointerdown', (e) => {
    if (!boardMode || e.button !== 0) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const erase = $('#boardEraser').checked;
    active = {
      id: uid('s'), userId: session.userId, color: $('#boardColor').value, width: Number($('#boardWidth').value) * (erase ? 3 : 1),
      erase, points: [norm(e)], done: false, pointerId: e.pointerId,
    };
    strokes.push(active);
    pendingPoints = [...active.points];
    drawStrokeSegment(active, active.points.length - 1);
    scheduleFlush();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== active.pointerId) return;
    const p = norm(e);
    const last = active.points[active.points.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.002) return;
    active.points.push(p);
    pendingPoints.push(p);
    drawnPoints++;
    drawStrokeSegment(active, active.points.length - 1);
    scheduleFlush();
  });
  const finish = (e) => {
    if (!active || (e.pointerId !== undefined && e.pointerId !== active.pointerId)) return;
    active.done = true;
    flush(true);
    active = null;
    emit('board:stroke', drawnPoints);
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  on('net:message', (msg) => {
    if (msg.type === 'snapshot') { strokes = (msg.strokes || []).map((s) => ({ ...s })); redraw(); }
    if (msg.type === 'stroke') {
      const s = msg.stroke;
      if (s.userId === session.userId) return;
      let existing = strokes.find((x) => x.id === s.id);
      if (!existing) {
        existing = { ...s, points: [] };
        strokes.push(existing);
      }
      const start = existing.points.length;
      existing.points.push(...s.points);
      existing.done = s.done;
      for (let i = Math.max(1, start); i < existing.points.length; i++) drawStrokeSegment(existing, i);
      if (start === 0 && existing.points.length === 1) drawStrokeSegment(existing, 0);
    }
    if (msg.type === 'board_clear') {
      strokes = [];
      redraw();
      if (msg.by && msg.by !== session.userName) toast(t('board.clearedBy', { name: msg.by }), { icon: '🧽' });
    }
  });
  on('session:left', () => { strokes = []; redraw(); if (boardMode) toggleBoardMode(false); });
}

function norm(e) {
  const rect = canvas.getBoundingClientRect();
  return [Number(((e.clientX - rect.left) / rect.width).toFixed(4)), Number(((e.clientY - rect.top) / rect.height).toFixed(4))];
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(stage.clientWidth * dpr);
  canvas.height = Math.round(stage.clientHeight * dpr);
  canvas.style.width = `${stage.clientWidth}px`;
  canvas.style.height = `${stage.clientHeight}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function drawStrokeSegment(stroke, i) {
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  const pts = stroke.points;
  if (!pts.length) return;
  ctx.save();
  ctx.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (pts.length === 1 || i === 0) {
    ctx.beginPath();
    ctx.arc(pts[0][0] * W, pts[0][1] * H, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.beginPath();
    ctx.moveTo(pts[i - 1][0] * W, pts[i - 1][1] * H);
    ctx.lineTo(pts[i][0] * W, pts[i][1] * H);
    ctx.stroke();
  }
  ctx.restore();
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  for (const s of strokes) {
    for (let i = 0; i < s.points.length; i++) drawStrokeSegment(s, i);
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => flush(false), 50);
}

function flush(done) {
  clearTimeout(flushTimer);
  flushTimer = null;
  if (!active && !done) return;
  const stroke = active;
  if (!stroke) return;
  if (!pendingPoints.length && !done) return;
  transport.send({ kind: 'stroke', stroke: { id: stroke.id, color: stroke.color, width: stroke.width, erase: stroke.erase, points: pendingPoints, done } });
  pendingPoints = [];
}

export function toggleBoardMode(force) {
  boardMode = typeof force === 'boolean' ? force : !boardMode;
  document.body.classList.toggle('board-mode', boardMode);
  $('#drawToggle')?.classList.toggle('active', boardMode);
  toast(boardMode ? t('board.on') : t('board.off'), { icon: '✏️', timeout: 1800 });
  return boardMode;
}

export function isBoardMode() {
  return boardMode;
}
