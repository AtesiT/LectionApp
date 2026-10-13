// Запись и экспорт сцены: видео (MediaRecorder), GIF (свой кодировщик) и
// CSS/HTML-код анимации для вставки в свой сайт.
//
// Кадры рисуем сами на отдельном холсте: фон → эффекты → объекты → доска.
// Анимации объектов берём из вычисленных стилей (getComputedStyle), поэтому
// в запись попадает ровно то, что видно на экране.
import { $, el } from '../core/dom.js';
import { state } from '../core/store.js';
import { shapePoints, isPolygonShape } from './shapes.js';
import { getObjectNode } from './objects.js';
import { animationByKey } from './animations.js';
import { encodeGif, buildPalette, toIndices } from '../core/gif.js';
import { t } from '../core/i18n.js';
import { toast } from '../ui/toast.js';

let recorder = null;
let chunks = [];
let stream = null;
let raf = null;
let outCanvas = null;
let outCtx = null;
let startedAt = 0;
let timer = null;

const imageCache = new Map();

function ensureCanvas(w, h) {
  if (!outCanvas) {
    outCanvas = document.createElement('canvas');
    outCtx = outCanvas.getContext('2d');
  }
  if (outCanvas.width !== w || outCanvas.height !== h) {
    outCanvas.width = w;
    outCanvas.height = h;
  }
  return outCtx;
}

export function isRecording() {
  return Boolean(recorder);
}

// --- отрисовка кадра ----------------------------------------------------------------

export function drawScene(ctx, W, H) {
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  drawBackground(ctx, W, H);
  const fx = $('#fxCanvas');
  if (fx?.width) {
    try { ctx.drawImage(fx, 0, 0, W, H); } catch { /* эффекты могли быть из чужого источника */ }
  }
  for (const obj of state.objects) drawObject(ctx, obj, W, H);
  const board = $('#boardCanvas');
  if (board?.width) {
    try { ctx.drawImage(board, 0, 0, W, H); } catch { /* пусто */ }
  }
  ctx.restore();
}

function drawBackground(ctx, W, H) {
  const bg = state.background || {};
  const stageBg = $('#stageBg');
  if (bg.type === 'image' && bg.value && bg.value !== 'local-media') {
    const img = cachedImage(bg.value);
    if (img?.complete) {
      drawCover(ctx, img, W, H);
      return;
    }
  }
  if (bg.type === 'video') {
    const video = $('#stageVideo');
    if (!video?.classList.contains('hidden') && video.readyState >= 2) {
      drawCover(ctx, video, W, H);
      return;
    }
    const frame = $('#stageVideoFrame');
    if (frame && !frame.classList.contains('hidden')) {
      ctx.fillStyle = '#05070f';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(226,232,240,.75)';
      ctx.font = `${Math.round(H * 0.06)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText('🎬 ' + (bg.provider || 'video'), W / 2, H / 2);
      return;
    }
  }
  const computed = stageBg ? getComputedStyle(stageBg) : null;
  ctx.fillStyle = (computed?.backgroundColor && computed.backgroundColor !== 'rgba(0, 0, 0, 0)')
    ? computed.backgroundColor
    : '#0b1020';
  ctx.fillRect(0, 0, W, H);
}

function drawObject(ctx, obj, W, H) {
  const node = getObjectNode(obj.id);
  const size = obj.size || 160;
  const cx = W / 2 + (obj.x || 0);
  const cy = H / 2 + (obj.y || 0);
  ctx.save();
  ctx.translate(cx, cy);
  // анимации: берём матрицу из вычисленного стиля .obj-anim
  const animEl = node?.querySelector('.obj-anim');
  if (animEl) {
    const tr = getComputedStyle(animEl).transform;
    if (tr && tr !== 'none' && typeof DOMMatrixReadOnly === 'function') {
      try {
        const m = new DOMMatrixReadOnly(tr);
        ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f);
      } catch { /* старый браузер — рисуем без трансформации */ }
    }
  }
  const fxEl = node?.querySelector('.obj-fx');
  const opacity = fxEl ? Number(getComputedStyle(fxEl).opacity || obj.opacity || 1) : (obj.opacity ?? 1);
  ctx.globalAlpha = Math.max(0, Math.min(1, opacity));
  if (obj.glow > 0) {
    ctx.shadowColor = obj.color || '#fff';
    ctx.shadowBlur = obj.glow * 28;
  }

  const half = size / 2;
  if (isPolygonShape(obj.shape)) {
    const pts = shapePoints(obj.shape, obj.radius ?? 14);
    ctx.beginPath();
    pts.forEach(([px, py], i) => {
      const x = (px / 100) * size - half;
      const y = (py / 100) * size - half;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fillStyle = obj.color || '#38BDF8';
    ctx.fill('evenodd');
    if (obj.stroke > 0) {
      ctx.shadowBlur = 0;
      ctx.lineWidth = obj.stroke;
      ctx.strokeStyle = obj.strokeColor || '#fff';
      ctx.stroke();
    }
  } else if (obj.shape === 'emoji' || obj.shape === 'text') {
    ctx.shadowBlur = 0;
    ctx.fillStyle = obj.shape === 'text' ? (obj.color || '#fff') : '#fff';
    ctx.font = `${Math.round(size * (obj.shape === 'text' ? 0.4 : 0.7))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(obj.shape === 'text' ? (obj.text || 'Text') : (obj.emoji || '🙂'), 0, 0);
  } else if (obj.shape === 'image') {
    ctx.shadowBlur = 0;
    const img = obj.image && obj.image !== 'has-image' ? cachedImage(obj.image) : null;
    if (img?.complete && img.width) {
      roundRect(ctx, -half, -half, size, size, ((obj.radius ?? 14) / 100) * half);
      ctx.clip();
      drawCoverIn(ctx, img, -half, -half, size, size);
    } else {
      ctx.font = `${Math.round(size * 0.5)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#94a3b8';
      ctx.fillText('🖼', 0, 0);
    }
  } else if (obj.shape === 'video') {
    ctx.shadowBlur = 0;
    const video = node?.querySelector('video');
    const src = obj.video?.src;
    if (video && video.readyState >= 2) {
      roundRect(ctx, -half, -half, size, size, ((obj.radius ?? 14) / 100) * half);
      ctx.clip();
      drawCoverIn(ctx, video, -half, -half, size, size);
    } else if (src && src !== 'local-media' && obj.video?.provider !== 'file') {
      ctx.fillStyle = 'rgba(15,23,42,.85)';
      roundRect(ctx, -half, -half, size, size, 8);
      ctx.fill();
      ctx.fillStyle = '#e2e8f0';
      ctx.font = `${Math.round(size * 0.4)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🎬', 0, 0);
    } else if (src) {
      const img = cachedImage(src);
      if (img?.complete && img.width) {
        roundRect(ctx, -half, -half, size, size, ((obj.radius ?? 14) / 100) * half);
        ctx.clip();
        drawCoverIn(ctx, img, -half, -half, size, size);
      }
    }
  }
  ctx.restore();
}

function cachedImage(src) {
  if (!src) return null;
  let img = imageCache.get(src);
  if (!img) {
    img = new Image();
    img.crossOrigin = 'anonymous';
    img.src = src;
    imageCache.set(src, img);
  }
  return img;
}

function drawCover(ctx, source, W, H) {
  const sw = source.videoWidth || source.width || W;
  const sh = source.videoHeight || source.height || H;
  const scale = Math.max(W / sw, H / sh);
  const w = sw * scale;
  const h = sh * scale;
  ctx.drawImage(source, (W - w) / 2, (H - h) / 2, w, h);
}

function drawCoverIn(ctx, source, x, y, w, h) {
  const sw = source.videoWidth || source.width || w;
  const sh = source.videoHeight || source.height || h;
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(source, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

// --- видео --------------------------------------------------------------------------

const MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];

export function startSceneRecording({ fps = 30, width = 960 } = {}) {
  if (recorder) return false;
  if (typeof MediaRecorder === 'undefined' || !document.createElement('canvas').captureStream) {
    toast(t('board.recFail'), { type: 'warn' });
    return false;
  }
  const stage = $('#stage');
  const W = Math.min(width, Math.max(320, stage.clientWidth || 640));
  const H = Math.round((W / Math.max(1, stage.clientWidth || 640)) * (stage.clientHeight || 360));
  const ctx = ensureCanvas(W, H);
  const draw = () => {
    drawScene(ctx, W, H);
    raf = requestAnimationFrame(draw);
  };
  draw();
  const mimeType = MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported?.(m)) ?? '';
  try {
    stream = outCanvas.captureStream(fps);
    recorder = mimeType ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 }) : new MediaRecorder(stream);
  } catch (err) {
    console.warn('recorder failed', err);
    recorder = null;
    cancelAnimationFrame(raf);
    toast(t('board.recFail'), { type: 'warn' });
    return false;
  }
  chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: recorder?.mimeType || 'video/webm' });
    const ext = (recorder?.mimeType || '').includes('mp4') ? 'mp4' : 'webm';
    const url = URL.createObjectURL(blob);
    download(url, `scene-${stamp()}.${ext}`);
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    cleanup();
    toast(t('export.videoSaved'), { icon: '🎬' });
  };
  recorder.start(200);
  startedAt = Date.now();
  timer = setInterval(updateStatus, 500);
  updateStatus();
  return true;
}

export function stopSceneRecording() {
  if (!recorder) return false;
  recorder.stop();
  return true;
}

function cleanup() {
  cancelAnimationFrame(raf);
  raf = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  recorder = null;
  chunks = [];
  clearInterval(timer);
  timer = null;
  updateStatus();
}

function updateStatus() {
  const node = $('#exportStatus');
  if (!node) return;
  node.textContent = recorder ? `${t('export.recording')} ${Math.round((Date.now() - startedAt) / 1000)} ${t('export.sec')}` : '';
  $('#recSceneBtn')?.classList.toggle('recording', Boolean(recorder));
}

// --- GIF ----------------------------------------------------------------------------

export async function exportSceneGif({ seconds = 4, fps = 12, scale = 0.5 } = {}) {
  const stage = $('#stage');
  const W = Math.max(80, Math.round((stage.clientWidth || 640) * scale));
  const H = Math.max(60, Math.round((stage.clientHeight || 360) * scale));
  const ctx = ensureCanvas(W, H);
  const palette = buildPalette();
  const cache = new Map();
  const frames = [];
  const total = Math.max(1, Math.round(seconds * fps));
  const status = $('#exportStatus');
  for (let i = 0; i < total; i++) {
    drawScene(ctx, W, H);
    const data = ctx.getImageData(0, 0, W, H).data;
    frames.push(toIndices(data, palette, cache));
    if (status) status.textContent = `${t('export.gifProgress')} ${Math.round(((i + 1) / total) * 100)}%`;
    await sleep(1000 / fps);
  }
  const bytes = encodeGif({ width: W, height: H, frames, delay: Math.round(100 / fps), palette });
  const blob = new Blob([bytes], { type: 'image/gif' });
  const url = URL.createObjectURL(blob);
  download(url, `scene-${stamp()}.gif`);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  if (status) status.textContent = `${t('export.gifSaved')} (${Math.round(bytes.length / 1024)} КБ, ${W}×${H})`;
  toast(t('export.gifSaved'), { icon: '🎞' });
  return bytes.length;
}

// --- CSS / HTML ------------------------------------------------------------------------

/** Готовый CSS с ключевыми кадрами анимаций активного объекта. */
export function buildCss(obj) {
  if (!obj) return '';
  const lines = [];
  lines.push('/* Motion Playground — экспорт анимации */');
  lines.push('.mp-object {');
  lines.push(`  width: ${obj.size}px;`);
  lines.push(`  height: ${obj.size}px;`);
  if (isPolygonShape(obj.shape)) {
    const pts = shapePoints(obj.shape, obj.radius ?? 14).map(([x, y]) => `${x.toFixed(1)}% ${y.toFixed(1)}%`);
    lines.push(`  clip-path: polygon(${pts.join(', ')});`);
    lines.push(`  background: ${obj.color};`);
  }
  lines.push(`  opacity: ${obj.opacity};`);
  if (obj.glow > 0) lines.push(`  filter: drop-shadow(0 0 ${Math.round(obj.glow * 28)}px ${obj.color});`);
  const names = [];
  (obj.animations || []).forEach((key) => {
    const def = animationByKey(key);
    if (!def) return;
    const name = `mp-${key}`;
    const frames = def.keyframes(obj.shape);
    names.push({ name, def });
    lines.push('');
    lines.push(`@keyframes ${name} {`);
    frames.forEach((frame, i) => {
      const at = frame.offset ?? (i / Math.max(1, frames.length - 1));
      const props = Object.entries(frame).filter(([k]) => k !== 'offset')
        .map(([k, v]) => `    ${kebab(k)}: ${v};`).join('\n');
      lines.push(`  ${Math.round(at * 100)}% {`);
      lines.push(props);
      lines.push('  }');
    });
    lines.push('}');
  });
  lines.push('');
  lines.push('.mp-object {');
  lines.push(`  animation: ${names.map(({ name, def }) => `${name} ${Math.round(def.duration)}ms ${def.easing || 'ease-in-out'} infinite`).join(', ') || 'none'};`);
  lines.push('}');
  return lines.join('\n');
}

export function buildHtml(obj) {
  const css = buildCss(obj);
  const inner = isPolygonShape(obj.shape) ? '' : (obj.shape === 'text' ? escapeHtml(obj.text || 'Text') : (obj.emoji || '🙂'));
  return `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<title>Motion Playground — экспорт</title>
<style>
  body { display: grid; place-items: center; min-height: 100vh; margin: 0; background: #0b1020; font-family: system-ui, sans-serif; }
${css.split('\n').map((line) => `  ${line}`).join('\n')}
</style>
</head>
<body>
  <div class="mp-object">${inner}</div>
</body>
</html>
`;
}

export function exportCssFile(obj) {
  downloadText(`animation-${stamp()}.css`, buildCss(obj), 'text/css');
  toast(t('export.cssSaved'), { icon: '📄' });
}

export function exportHtmlFile(obj) {
  downloadText(`animation-${stamp()}.html`, buildHtml(obj), 'text/html');
  toast(t('export.htmlSaved'), { icon: '📄' });
}

// --- мелочи ----------------------------------------------------------------------------

function kebab(prop) {
  return prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function download(url, filename) {
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
}

export function downloadText(filename, text, type = 'text/plain') {
  const blob = new Blob([text], { type: `${type};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  download(url, filename);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
