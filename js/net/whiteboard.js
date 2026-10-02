// Общая доска: рисование поверх сцены, синхронизация штрихов через сервер,
// запись рисования в видео (MediaRecorder), скриншот сцены и повтор рисунка.
import { $, el } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { t } from '../core/i18n.js';
import { state } from '../core/store.js';
import * as transport from './transport.js';
import { session } from './session.js';
import { toast } from '../ui/toast.js';

let canvas; let ctx; let stage;
let recordCanvas = null;        // отдельный холст для записи: в него пишем то же, что и на доску
let recordCtx = null;
let strokes = [];
let active = null;     // текущий штрих
let flushTimer = null;
let pendingPoints = [];
let boardMode = false;
let drawnPoints = 0;

// запись
let recorder = null;
let recChunks = [];
let recTimer = null;
let recStartedAt = 0;
// повтор
let replay = null;

export function init() {
  canvas = $('#boardCanvas');
  ctx = canvas.getContext('2d');
  stage = $('#stage');
  recordCanvas = document.createElement('canvas');
  recordCtx = recordCanvas.getContext('2d');
  const ro = new ResizeObserver(() => { resize(); redraw(); });
  ro.observe(stage);
  resize();

  $('#drawToggle')?.addEventListener('click', () => toggleBoardMode());
  $('#boardClearBtn')?.addEventListener('click', () => transport.send({ kind: 'board_clear' }));
  $('#boardRecBtn')?.addEventListener('click', () => (recorder ? stopRecording() : startRecording()));
  $('#boardShotBtn')?.addEventListener('click', screenshot);
  $('#boardReplayBtn')?.addEventListener('click', () => (replay ? stopReplay() : startReplay()));

  canvas.addEventListener('pointerdown', (e) => {
    if (!boardMode || e.button !== 0) return;
    e.preventDefault();
    if (replay) stopReplay();
    canvas.setPointerCapture(e.pointerId);
    const erase = $('#boardEraser').checked;
    const now = Date.now();
    active = {
      id: uid(), userId: session.userId, color: $('#boardColor').value, width: Number($('#boardWidth').value) * (erase ? 3 : 1),
      erase, points: [norm(e)], ts: [now], done: false, pointerId: e.pointerId,
    };
    strokes.push(active);
    pendingPoints = [...active.points];
    paint(active, active.points.length - 1);
    scheduleFlush();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active || e.pointerId !== active.pointerId) return;
    const p = norm(e);
    const last = active.points[active.points.length - 1];
    if (Math.hypot(p[0] - last[0], p[1] - last[1]) < 0.002) return;
    active.points.push(p);
    active.ts.push(Date.now());
    pendingPoints.push(p);
    drawnPoints++;
    paint(active, active.points.length - 1);
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
    if (msg.type === 'snapshot') {
      strokes = (msg.strokes || []).map((s) => ({ ...s, ts: s.ts || [] }));
      redraw();
    }
    if (msg.type === 'stroke') {
      const s = msg.stroke;
      if (s.userId === session.userId) return;
      let existing = strokes.find((x) => x.id === s.id);
      const now = Date.now();
      if (!existing) {
        existing = { ...s, points: [], ts: [] };
        strokes.push(existing);
      }
      const start = existing.points.length;
      existing.points.push(...s.points);
      existing.ts.push(...(s.points || []).map(() => now));
      existing.done = s.done;
      for (let i = Math.max(1, start); i < existing.points.length; i++) paint(existing, i);
      if (start === 0 && existing.points.length === 1) paint(existing, 0);
    }
    if (msg.type === 'board_clear') {
      strokes = [];
      redraw();
      if (msg.by && msg.by !== session.userName) toast(t('board.clearedBy', { name: msg.by }), { icon: '🧽' });
    }
  });
  on('session:left', () => { strokes = []; redraw(); if (boardMode) toggleBoardMode(false); });
  on('lang', () => updateRecButton());
}

let strokeSeq = 0;
function uid() {
  strokeSeq += 1;
  return `${session.userId || 'local'}-${Date.now().toString(36)}-${strokeSeq}`;
}

function norm(e) {
  const rect = canvas.getBoundingClientRect();
  return [Number(((e.clientX - rect.left) / rect.width).toFixed(4)), Number(((e.clientY - rect.top) / rect.height).toFixed(4))];
}

function resize() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  for (const c of [canvas, recordCanvas]) {
    c.width = Math.round(stage.clientWidth * dpr);
    c.height = Math.round(stage.clientHeight * dpr);
  }
  canvas.style.width = `${stage.clientWidth}px`;
  canvas.style.height = `${stage.clientHeight}px`;
  for (const c of [ctx, recordCtx]) {
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.lineCap = 'round';
    c.lineJoin = 'round';
  }
}

/** Рисует один сегмент штриха сразу на доске и на холсте записи. */
function paint(stroke, i) {
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  const pts = stroke.points;
  if (!pts.length) return;
  for (const c of [ctx, recordCtx]) {
    if (!c) continue;
    c.save();
    c.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
    c.strokeStyle = stroke.color;
    c.fillStyle = stroke.color;
    c.lineWidth = stroke.width;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (pts.length === 1 || i === 0) {
      c.beginPath();
      c.arc(pts[0][0] * W, pts[0][1] * H, stroke.width / 2, 0, Math.PI * 2);
      c.fill();
    } else {
      c.beginPath();
      c.moveTo(pts[i - 1][0] * W, pts[i - 1][1] * H);
      c.lineTo(pts[i][0] * W, pts[i][1] * H);
      c.stroke();
    }
    c.restore();
  }
}

function clearRecordCanvas() {
  if (!recordCtx) return;
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  recordCtx.save();
  recordCtx.setTransform(1, 0, 0, 1, 0, 0);
  recordCtx.clearRect(0, 0, recordCanvas.width, recordCanvas.height);
  recordCtx.restore();
  recordCtx.fillStyle = 'rgba(9, 12, 24, 0.92)';
  recordCtx.fillRect(0, 0, W, H);
}

function redraw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  clearRecordCanvas();
  for (const s of strokes) {
    for (let i = 0; i < s.points.length; i++) paint(s, i);
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

// ---------------------------------------------------------------------------
// Запись доски в видео-файл
// ---------------------------------------------------------------------------

const MIME_CANDIDATES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

function pickMime() {
  if (typeof MediaRecorder === 'undefined') return null;
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
}

export function isRecording() {
  return Boolean(recorder);
}

export function startRecording() {
  if (recorder) return false;
  if (typeof MediaRecorder === 'undefined' || !recordCanvas.captureStream) {
    toast(t('board.recFail'), { type: 'warn' });
    return false;
  }
  const mimeType = pickMime();
  try {
    const stream = recordCanvas.captureStream(30);
    recorder = mimeType ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000 }) : new MediaRecorder(stream);
  } catch (err) {
    console.warn('recorder failed', err);
    toast(t('board.recFail'), { type: 'warn' });
    recorder = null;
    return false;
  }
  recChunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) recChunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(recChunks, { type: recorder?.mimeType || 'video/webm' });
    const ext = (recorder?.mimeType || 'video/webm').includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(blob);
    downloadUrl(url, `board-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    recorder = null;
    recChunks = [];
    clearInterval(recTimer);
    emit('board:recorded');
    recTimer = null;
    updateRecButton();
    toast(t('board.recSaved'), { icon: '🎞' });
  };
  clearRecordCanvas();
  recorder.start(250);
  recStartedAt = Date.now();
  updateRecButton();
  recTimer = setInterval(updateRecButton, 500);
  return true;
}

export function stopRecording() {
  if (!recorder) return false;
  clearInterval(recTimer);
  recTimer = null;
  recorder.stop();
  updateRecButton();
  return true;
}

function updateRecButton() {
  const btn = $('#boardRecBtn');
  if (!btn) return;
  if (recorder) {
    const sec = Math.round((Date.now() - recStartedAt) / 1000);
    btn.textContent = `⏹ ${sec} с`;
    btn.classList.add('recording');
  } else {
    btn.textContent = t('board.record');
    btn.classList.remove('recording');
  }
}

// ---------------------------------------------------------------------------
// Скриншот сцены (фон + эффекты + доска)
// ---------------------------------------------------------------------------

export function screenshot() {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(1, stage.clientWidth);
  const H = Math.max(1, stage.clientHeight);
  const out = document.createElement('canvas');
  out.width = Math.round(W * dpr);
  out.height = Math.round(H * dpr);
  const octx = out.getContext('2d');
  if (!octx || !ctx) { toast(t('board.recFail'), { type: 'warn' }); return false; }
  octx.scale(dpr, dpr);
  octx.fillStyle = '#0b1020';
  octx.fillRect(0, 0, W, H);
  drawBackgroundInto(octx, W, H);
  const fx = $('#fxCanvas');
  if (fx?.width) {
    try { octx.drawImage(fx, 0, 0, W, H); } catch { /* эффекты могли быть с другого источника */ }
  }
  // Штрихи рисуем на отдельном прозрачном холсте: в recordCanvas есть непрозрачная
  // подложка для записи видео, а для скриншота она бы закрыла фон сцены.
  const strokesCanvas = document.createElement('canvas');
  strokesCanvas.width = Math.round(W * dpr);
  strokesCanvas.height = Math.round(H * dpr);
  const sctx = strokesCanvas.getContext('2d');
  if (sctx) {
    sctx.scale(dpr, dpr);
    sctx.lineCap = 'round';
    sctx.lineJoin = 'round';
    for (const stroke of strokes) {
      for (let i = 0; i < stroke.points.length; i++) drawStrokeSegment(sctx, stroke, i);
    }
    octx.drawImage(strokesCanvas, 0, 0, W, H);
  }
  try {
    const url = out.toDataURL('image/png');
    downloadUrl(url, `stage-${new Date().toISOString().replace(/[:.]/g, '-')}.png`, true);
    toast(t('board.shotSaved'), { icon: '📷' });
    emit('board:screenshot');
    return true;
  } catch (err) {
    console.warn('screenshot failed', err);
    toast(t('board.recFail'), { type: 'warn' });
    return false;
  }
}

function drawBackgroundInto(octx, W, H) {
  const bg = state.background || {};
  if (bg.type === 'video' || bg.type === 'image') {
    const src = bg.value;
    if (src && src !== 'local-media' && !/^blob:/.test(src)) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = src;
      if (img.complete) {
        try { drawCover(octx, img, W, H); return; } catch { /* чужая картинка — просто фон */ }
      }
    }
  }
  const computed = getComputedStyle($('#stageBg'));
  const image = computed?.backgroundImage || '';
  if (image && image !== 'none' && image.includes('url(')) {
    const url = (image.match(/url\("?([^")]+)"?\)/) || [])[1];
    if (url) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.src = url;
      if (img.complete) {
        try { drawCover(octx, img, W, H); return; } catch { /* tainted canvas */ }
      }
    }
    octx.fillStyle = computed?.backgroundColor || '#0b1020';
  } else if (computed?.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)') {
    octx.fillStyle = computed.backgroundColor;
  } else {
    octx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--stage-bg').trim() || '#0b1020';
  }
  octx.fillRect(0, 0, W, H);
}

function drawCover(octx, img, W, H) {
  const scale = Math.max(W / (img.width || W), H / (img.height || H));
  const w = (img.width || W) * scale;
  const h = (img.height || H) * scale;
  octx.drawImage(img, (W - w) / 2, (H - h) / 2, w, h);
}

function downloadUrl(url, filename, isData = false) {
  const a = el('a', { href: url, download: filename });
  if (!isData) a.rel = 'noopener';
  document.body.append(a);
  a.click();
  a.remove();
}

// ---------------------------------------------------------------------------
// Повтор рисования (как рисовалось, с теми же паузами)
// ---------------------------------------------------------------------------

export function startReplay() {
  if (replay) return false;
  const events = [];
  for (const s of strokes) {
    const t0 = s.ts?.[0] ?? 0;
    for (let i = 0; i < s.points.length; i++) {
      events.push({ at: (s.ts?.[i] ?? t0 + i * 40) - t0, stroke: s, i });
    }
  }
  if (!events.length) {
    toast(t('board.replayEmpty'), { type: 'warn' });
    return false;
  }
  events.sort((a, b) => a.at - b.at);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  replay = { events, idx: 0, start: performance.now(), timer: null };
  const btn = $('#boardReplayBtn');
  if (btn) btn.classList.add('recording');
  toast(t('board.replaying'), { icon: '↻', timeout: 1500 });
  stepReplay();
  return true;
}

function stepReplay() {
  if (!replay) return;
  const elapsed = performance.now() - replay.start;
  while (replay.idx < replay.events.length && replay.events[replay.idx].at <= elapsed) {
    const ev = replay.events[replay.idx];
    drawStrokeSegment(ctx, ev.stroke, ev.i);
    replay.idx += 1;
  }
  if (replay.idx >= replay.events.length) {
    stopReplay();
    return;
  }
  const next = replay.events[replay.idx];
  replay.timer = setTimeout(stepReplay, Math.max(8, next.at - elapsed));
}

export function stopReplay() {
  if (!replay) return false;
  clearTimeout(replay.timer);
  replay = null;
  const btn = $('#boardReplayBtn');
  if (btn) btn.classList.remove('recording');
  redraw();
  return true;
}

function drawStrokeSegment(target, stroke, i) {
  const W = stage.clientWidth;
  const H = stage.clientHeight;
  const pts = stroke.points;
  if (!pts.length) return;
  target.save();
  target.globalCompositeOperation = stroke.erase ? 'destination-out' : 'source-over';
  target.strokeStyle = stroke.color;
  target.fillStyle = stroke.color;
  target.lineWidth = stroke.width;
  target.lineCap = 'round';
  target.lineJoin = 'round';
  if (pts.length === 1 || i === 0) {
    target.beginPath();
    target.arc(pts[0][0] * W, pts[0][1] * H, stroke.width / 2, 0, Math.PI * 2);
    target.fill();
  } else {
    target.beginPath();
    target.moveTo(pts[i - 1][0] * W, pts[i - 1][1] * H);
    target.lineTo(pts[i][0] * W, pts[i][1] * H);
    target.stroke();
  }
  target.restore();
}
