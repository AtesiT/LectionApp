// Фон сцены: пресеты-градиенты, цвет, картинка, видео, параллакс.
import { $ } from '../core/dom.js';
import { state, subscribe, activeObject } from '../core/store.js';
import { animationByKey } from './animations.js';
import { parseVideoUrl, embedUrl, isDataUrl, isBlobUrl } from '../core/media.js';
import { t } from '../core/i18n.js';

export const BG_PRESETS = {
  auto: null,
  aurora: 'linear-gradient(135deg, #0f172a 0%, #164e63 40%, #14532d 75%, #0f172a 100%)',
  sunset: 'linear-gradient(160deg, #7c2d12 0%, #ea580c 35%, #f59e0b 60%, #7e22ce 100%)',
  ocean: 'linear-gradient(180deg, #0c4a6e 0%, #0369a1 45%, #0891b2 100%)',
  forest: 'linear-gradient(180deg, #052e16 0%, #166534 50%, #4d7c0f 100%)',
  night: 'radial-gradient(circle at 30% 20%, #1e1b4b 0%, #020617 60%, #000 100%)',
  candy: 'linear-gradient(135deg, #f9a8d4 0%, #c4b5fd 50%, #a5f3fc 100%)',
  fire: 'radial-gradient(circle at 50% 100%, #fbbf24 0%, #ea580c 35%, #7f1d1d 75%, #1c0a0a 100%)',
  mono: 'linear-gradient(135deg, #111827 0%, #374151 100%)',
  grid: 'linear-gradient(rgba(255,255,255,.08) 1px, transparent 1px) 0 0/40px 40px, linear-gradient(90deg, rgba(255,255,255,.08) 1px, transparent 1px) 0 0/40px 40px, #0f172a',
};

let bgEl; let videoWrap; let videoEl; let videoFrame; let videoNote; let stage; let objectsLayer;
let parallaxBound = false;

export function init() {
  bgEl = $('#stageBg');
  videoWrap = $('#stageVideoWrap');
  videoEl = $('#stageVideo');
  videoFrame = $('#stageVideoFrame');
  videoNote = $('#stageVideoNote');
  stage = $('#stage');
  objectsLayer = $('#objectsLayer');
  subscribe((s, patch, meta) => {
    if ('background' in patch || 'objects' in patch || 'activeObjectId' in patch || meta.replace) render();
  });
  setupParallax();
  render();
}

export function autoColor() {
  const obj = activeObject();
  const key = obj?.animations?.[0];
  return animationByKey(key)?.stage ?? '#0EA5E9';
}

export function render() {
  const bg = state.background || { type: 'preset', value: 'auto' };
  // Полный снос медиа делаем только когда видео реально не нужно: рендер вызывается
  // и при перетаскивании объектов, и иначе фон-видео дёргалось бы на каждом кадре.
  const keepVideo = bg.type === 'video';
  if (!keepVideo) hideVideo();
  bgEl.style.backgroundImage = '';
  bgEl.style.backgroundColor = '';
  bgEl.style.background = '';
  if (bg.type === 'preset') {
    if (bg.value === 'auto' || !BG_PRESETS[bg.value]) bgEl.style.background = autoColor();
    else bgEl.style.background = BG_PRESETS[bg.value];
  } else if (bg.type === 'color') {
    bgEl.style.background = bg.value || '#0EA5E9';
  } else if (bg.type === 'image') {
    if (bg.value === 'local-media') {
      bgEl.style.background = 'repeating-linear-gradient(45deg, #1e293b 0 12px, #0f172a 12px 24px)';
      showVideoNote(t('scene.mediaLocalOnly'));
    } else {
      bgEl.style.background = `center / cover no-repeat url("${bg.value}")`;
    }
  } else if (bg.type === 'video') {
    bgEl.style.background = '#000';
    showVideo(bg);
  }
  stage.classList.toggle('parallax', Boolean(bg.parallax));
  if (!bg.parallax) {
    bgEl.style.transform = '';
    videoWrap.style.transform = '';
    objectsLayer.style.setProperty('--par-x', '0px');
    objectsLayer.style.setProperty('--par-y', '0px');
  }
}

/** Прячет и останавливает всё медиа фона. */
function hideVideo() {
  videoWrap.classList.add('hidden');
  videoEl.classList.add('hidden');
  videoFrame.classList.add('hidden');
  videoNote.classList.add('hidden');
  if (videoEl.src && !videoEl.paused) videoEl.pause();
  stopFrame();
}

/** Останавливает плеер: пустой about:blank вместо снятия src (иначе YouTube «мигает»). */
function stopFrame() {
  const current = videoFrame.getAttribute('src');
  if (current && current !== 'about:blank') {
    videoFrame.src = 'about:blank';
  }
  videoFrame.classList.add('hidden');
}

function showVideoNote(text) {
  videoWrap.classList.remove('hidden');
  videoNote.classList.remove('hidden');
  videoNote.textContent = text;
}

/** Видео-фон: файл (data/blob/URL) играет в <video>, YouTube/Rutube/VK — в <iframe>. */
function showVideo(bg) {
  const src = String(bg.value || '');
  if (!src || src === 'local-media') {
    stopFrame();
    if (videoEl.src && !videoEl.paused) videoEl.pause();
    videoEl.classList.add('hidden');
    showVideoNote(src === 'local-media' ? t('scene.mediaLocalOnly') : t('scene.videoPick'));
    return;
  }
  videoWrap.classList.remove('hidden');
  videoNote.classList.add('hidden');
  const provider = bg.provider || (isDataUrl(src) || isBlobUrl(src) ? 'file' : (parseVideoUrl(src)?.provider ?? 'file'));
  if (provider === 'file') {
    stopFrame();
    videoEl.classList.remove('hidden');
    if (videoEl.getAttribute('src') !== src) {
      videoEl.src = src;
      videoEl.muted = true;
      videoEl.loop = true;
      const played = videoEl.play();
      if (played?.catch) played.catch(() => showVideoNote(t('scene.videoTap')));
    } else if (videoEl.paused) {
      videoEl.play?.().catch(() => {});
    }
    videoEl.onerror = () => showVideoNote(t('scene.videoFail'));
    return;
  }
  if (videoEl.src && !videoEl.paused) videoEl.pause();
  videoEl.classList.add('hidden');
  const videoId = bg.videoId || parseVideoUrl(src)?.id || src;
  const embed = bg.embed || embedUrl(provider, videoId, { loop: true, mute: true, autoplay: true }) || src;
  if (videoFrame.getAttribute('src') !== embed) videoFrame.src = embed;
  videoFrame.classList.remove('hidden');
}

function setupParallax() {
  if (parallaxBound) return;
  parallaxBound = true;
  stage.addEventListener('pointermove', (e) => {
    if (!state.background?.parallax) return;
    const rect = stage.getBoundingClientRect();
    const nx = (e.clientX - rect.left) / rect.width - 0.5;
    const ny = (e.clientY - rect.top) / rect.height - 0.5;
    bgEl.style.transform = `scale(1.08) translate(${(-nx * 16).toFixed(1)}px, ${(-ny * 16).toFixed(1)}px)`;
    videoWrap.style.transform = bgEl.style.transform;
    objectsLayer.style.setProperty('--par-x', `${(nx * 10).toFixed(1)}px`);
    objectsLayer.style.setProperty('--par-y', `${(ny * 10).toFixed(1)}px`);
  });
  stage.addEventListener('pointerleave', () => {
    if (!state.background?.parallax) return;
    bgEl.style.transform = 'scale(1.08)';
    videoWrap.style.transform = bgEl.style.transform;
    objectsLayer.style.setProperty('--par-x', '0px');
    objectsLayer.style.setProperty('--par-y', '0px');
  });
}

export function describeBackground(bg) {
  if (!bg) return 'auto';
  if (bg.type === 'preset') return bg.value;
  return bg.type;
}
