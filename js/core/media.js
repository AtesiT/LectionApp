// Медиа: разбор ссылок на видео (YouTube, Rutube, VK), прямые файлы,
// сжатие картинок до размера, который можно передать другим участникам.
//
// Зачем отдельный модуль: и фон сцены, и объект-картинка, и объект-видео
// используют один и тот же разбор ссылок и одни и те же ограничения на объём,
// чтобы состояние участника оставалось достаточно лёгким для синхронизации.

const YT_RE = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{6,20})/i;
const RUTUBE_RE = /rutube\.ru\/(?:video\/|play\/embed\/)([0-9a-fA-F]{8,64})/i;
const VK_ID_RE = /vk(?:video)?\.(?:com|ru)\/video(-?\d+)_(\d+)/i;
const VK_EXT_RE = /vk(?:video)?\.(?:com|ru)\/video_ext\.php\?[^#]*oid=(-?\d+)[^#]*id=(\d+)/i;
const FILE_RE = /\.(mp4|webm|ogv|ogg|mov|m4v|avi|mkv)(\?|#|$)/i;
const IMAGE_RE = /\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?|#|$)/i;

export const PROVIDER_LABELS = {
  youtube: 'YouTube',
  rutube: 'Rutube',
  vk: 'VK Видео',
  file: 'Файл',
};

/** Определяет, что прислали: ролик с хостинга, прямой файл или обычную ссылку. */
export function parseVideoUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) return null;
  const yt = url.match(YT_RE);
  if (yt) return makeVideo('youtube', yt[1], url);
  const rt = url.match(RUTUBE_RE);
  if (rt) return makeVideo('rutube', rt[1], url);
  const vkId = url.match(VK_ID_RE);
  if (vkId) return makeVideo('vk', `${vkId[1]}_${vkId[2]}`, url);
  const vkExt = url.match(VK_EXT_RE);
  if (vkExt) return makeVideo('vk', `${vkExt[1]}_${vkExt[2]}`, url);
  if (FILE_RE.test(url)) return makeVideo('file', url, url);
  return null;
}

function makeVideo(provider, id, src) {
  return {
    provider,
    id,
    src,
    embed: embedUrl(provider, id),
    label: provider === 'file' ? hostOf(src) : PROVIDER_LABELS[provider],
  };
}

/** Ссылка для <iframe> (YouTube / Rutube / VK) или null для прямого файла. */
export function embedUrl(provider, id, opts = {}) {
  const { loop = true, mute = true, autoplay = true } = opts;
  if (provider === 'youtube') {
    const params = ['modestbranding=1', 'rel=0', 'playsinline=1', 'controls=1'];
    if (autoplay) params.push('autoplay=1');
    if (mute) params.push('mute=1');
    if (loop) params.push('loop=1', `playlist=${id}`);
    return `https://www.youtube-nocookie.com/embed/${id}?${params.join('&')}`;
  }
  if (provider === 'rutube') {
    const params = [];
    if (autoplay) params.push('autoplay=1');
    if (mute) params.push('mute=1');
    if (loop) params.push('loop=1');
    return `https://rutube.ru/play/embed/${id}${params.length ? `?${params.join('&')}` : ''}`;
  }
  if (provider === 'vk') {
    const [oid, vid] = String(id).split('_');
    const params = ['hd=2'];
    if (autoplay) params.push('autoplay=1');
    return `https://vk.com/video_ext.php?oid=${oid}&id=${vid}${params.length ? `&${params.join('&')}` : ''}`;
  }
  return null;
}

/** Превью-картинка, если хостинг её отдаёт (иначе null — рисуем заглушку). */
export function thumbnailUrl(provider, id) {
  if (provider === 'youtube' && id) return `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
  return null;
}

export function isImageUrl(url) {
  return IMAGE_RE.test(String(url || ''));
}

export function hostOf(url) {
  try {
    return new URL(url, window.location.href).host || 'файл';
  } catch {
    return 'файл';
  }
}

// --- файлы -------------------------------------------------------------------

export function isDataUrl(value) {
  return /^data:/i.test(String(value || ''));
}

export function isBlobUrl(value) {
  return /^blob:/i.test(String(value || ''));
}

export function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('read_error'));
    reader.readAsDataURL(file);
  });
}

/** Размер data URL в байтах (по длине base64). */
export function dataUrlBytes(value) {
  const str = String(value || '');
  const comma = str.indexOf(',');
  if (comma < 0) return str.length;
  const body = str.slice(comma + 1);
  return Math.ceil((body.length * 3) / 4);
}

/**
 * Сжимает картинку до квадрата maxSide и до maxBytes, уменьшая качество.
 * Возвращает data URL (JPEG/PNG) или null, если браузер не смог.
 */
export async function compressImage(file, { maxSide = 256, quality = 0.72, maxBytes = 40_000 } = {}) {
  const isSvg = /svg/i.test(file.type || '') || /\.svg$/i.test(file.name || '');
  const raw = await readAsDataURL(file);
  if (isSvg && dataUrlBytes(raw) <= maxBytes) return raw;
  const bitmap = await loadImage(raw).catch(() => null);
  if (!bitmap) return isSvg ? null : raw;
  let side = maxSide;
  let q = quality;
  let out = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return raw;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    out = canvas.toDataURL('image/jpeg', q);
    if (dataUrlBytes(out) <= maxBytes) return out;
    side = Math.round(side * 0.75);
    q = Math.max(0.35, q - 0.12);
  }
  return out;
}

/** Видео сжимать нельзя — просто читаем и проверяем лимит на синхронизацию. */
export async function readVideoFile(file, maxBytes = 400_000) {
  const dataUrl = await readAsDataURL(file);
  return { dataUrl, syncable: dataUrlBytes(dataUrl) <= maxBytes, bytes: dataUrlBytes(dataUrl) };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image_error'));
    img.src = src;
  });
}

// --- загрузка на сервер ---------------------------------------------------------

/**
 * Кладёт файл в /uploads на сервере и возвращает ссылку.
 * Это снимает ограничение на размер: в состоянии участников лежит короткая ссылка,
 * а не мегабайты base64. Если сервер недоступен — возвращаем null (и вызывающий
 * код сам решит, сжимать файл или оставить его локальным).
 */
export async function uploadFile(file) {
  if (!file || typeof fetch !== 'function') return null;
  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name || 'file') },
      body: file,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.ok && data.url ? data : null;
  } catch (err) {
    return null;
  }
}

/**
 * Универсальная подготовка файла к использованию в сцене:
 * сначала пробуем загрузить на сервер, иначе сжимаем/читаем локально.
 * @returns {{src: string, uploaded: boolean, bytes: number, label: string}}
 */
export async function prepareMediaFile(file, { maxSide = 256, quality = 0.72, maxBytes = 32_000 } = {}) {
  const isVideo = /^video\//.test(file.type || '') || /\.(mp4|webm|ogv|mov|m4v)$/i.test(file.name || '');
  const uploaded = await uploadFile(file);
  if (uploaded) {
    return { src: uploaded.url, uploaded: true, bytes: uploaded.size, label: uploaded.name };
  }
  if (isVideo) {
    const { dataUrl, bytes } = await readVideoFile(file, maxBytes);
    return { src: dataUrl, uploaded: false, bytes, label: file.name };
  }
  const dataUrl = await compressImage(file, { maxSide, quality, maxBytes });
  return { src: dataUrl || '', uploaded: false, bytes: dataUrl ? dataUrlBytes(dataUrl) : 0, label: file.name };
}
