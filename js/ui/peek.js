// Просмотр сцены другого участника: его фигуры, картинки и видео — крупно,
// с анимациями и его фоном. Отсюда же сцену можно скопировать себе.
import { $, el } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { t } from '../core/i18n.js';
import { replaceState, state, syncableState } from '../core/store.js';
import { renderObjectPreview, applyBackgroundTo, applyVideoBackground } from '../scene/preview.js';
import { toast } from './toast.js';
import * as transport from '../net/transport.js';

let modal;
let titleEl;
let avatarEl;
let bgEl;
let videoEl;
let objectsEl;
let metaEl;
let current = null;      // чей сцену смотрим
let currentSelf = false; // это наша собственная карточка
let previews = [];

export function init() {
  modal = $('#peekModal');
  titleEl = $('#peekTitle');
  avatarEl = $('#peekAvatar');
  bgEl = $('#peekBg');
  videoEl = $('#peekVideo');
  objectsEl = $('#peekObjects');
  metaEl = $('#peekMeta');
  $('#peekCopyBtn')?.addEventListener('click', copyToSelf);
  modal?.addEventListener('click', (e) => { if (e.target === modal) closePeek(); });
  // Закрыть могли и извне (кнопка data-close-modal, Esc) — следим за атрибутом hidden,
  // иначе окно «оживёт» само, например при смене языка.
  if (modal && typeof MutationObserver === 'function') {
    new MutationObserver(() => { if (modal.hidden) release(); }).observe(modal, { attributes: true, attributeFilter: ['hidden'] });
  }
  // Перерисовываем окно при смене языка, но только если оно реально открыто
  // (иначе оно «оживёт» само — закрытие могло прийти извне, от Esc или кнопки).
  on('lang', () => { if (current && modal && !modal.hidden) openPeek(current, { self: currentSelf }); });
  on('session:left', closePeek);
}

export function isOpen() {
  return Boolean(modal && !modal.hidden);
}

export function openPeek(user, { self = false } = {}) {
  if (!modal || !user) return false;
  currentSelf = self;
  const s = user.state || {};
  current = user;
  stopPreviews();
  titleEl.textContent = t('peek.title', { name: user.name });
  avatarEl.textContent = user.avatar || '🙂';

  applyBackgroundTo(bgEl, s.background);
  const hasVideo = applyVideoBackground(videoEl, s.background);
  videoEl.classList.toggle('hidden', !hasVideo);

  objectsEl.replaceChildren();
  objectsEl.classList.toggle('hidden', Boolean(s.use3d));
  const objects = (s.objects || []).slice(0, 8);
  const box = $('#peekStage');
  const size = Math.max(46, Math.min(120, Math.round(Math.min(box.clientWidth || 320, box.clientHeight || 220) / Math.max(2, objects.length) * 0.9)));
  for (const obj of objects) {
    const { node, stop } = renderObjectPreview(obj, s, { size, interactive: true, animate: s.playing !== false });
    node.style.setProperty('--x', `${obj.x || 0}px`);
    node.style.setProperty('--y', `${obj.y || 0}px`);
    objectsEl.append(node);
    previews.push(stop);
  }
  if (s.use3d) {
    const { node, stop } = renderObjectPreview(objects[0] || { shape: 'circle', color: user.color, animations: [] }, s, {
      size: Math.max(90, Math.round((box.clientHeight || 220) * 0.6)), interactive: true, animate: s.playing !== false,
    });
    objectsEl.append(node);
    objectsEl.classList.remove('hidden');
    previews.push(stop);
  }

  const bits = [];
  bits.push(s.use3d ? t(`s3.${s.shape3d || 'cube'}`) : t('peek.objects', { n: (s.objects || []).length }));
  if (s.effect && s.effect !== 'none') bits.push(t(`fx.${s.effect}`));
  if (s.speed && s.speed !== 1) bits.push(`x${Number(s.speed).toFixed(1)}`);
  if (state.weatherSync === false && s.weatherSync) bits.push('🌤');
  metaEl.textContent = bits.join(' · ');

  modal.hidden = false;
  $('#peekCopyBtn').disabled = self;
  emit('peek:opened', user.id);
  return true;
}

export function closePeek() {
  if (!modal || modal.hidden) return false;
  modal.hidden = true;
  release();
  return true;
}

/** Убирает чужие объекты и видео из памяти, когда окно закрыто. */
function release() {
  stopPreviews();
  if (videoEl) {
    applyVideoBackground(videoEl, null);
    videoEl.classList.add('hidden');
  }
  if (objectsEl) objectsEl.replaceChildren();
  current = null;
}

export function togglePeek(user) {
  if (isOpen() && current?.id === user.id) return closePeek();
  return openPeek(user);
}

function stopPreviews() {
  previews.forEach((stop) => { try { stop(); } catch { /* анимация уже снята */ } });
  previews = [];
}

/** Копирует чужую сцену себе (объекты, фон, эффекты — как есть). */
function copyToSelf() {
  if (!current?.state) return;
  const next = JSON.parse(JSON.stringify(current.state));
  next.activeObjectId = next.objects?.[0]?.id ?? null;
  // silent — чтобы лента получила один аккуратный пункт, а не два (состояние отправляем сами).
  replaceState(next, { source: 'user', silent: true });
  transport.send({
    kind: 'action', type: 'copyScene', textKey: 'feed.copyScene', vars: { name: current.name },
    text: t('feed.copyScene', { name: current.name }), state: syncableState(),
  });
  toast(t('peek.copied'), { icon: '📋' });
  closePeek();
}
