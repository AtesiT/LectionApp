// Превью объекта из «чужого» состояния: мини-карточка участника и крупный
// просмотр чужой сцены. Один и тот же код рисует фигуры, картинки и видео,
// поэтому участники видят именно то, что поставил себе автор сцены.
import { el } from '../core/dom.js';
import { clipPathFor, isPolygonShape } from './shapes.js';
import { runAnimations } from './animations.js';
import { renderVideoShape } from './objects.js';
import { buildModel } from './model3d.js';
import { t } from '../core/i18n.js';

/**
 * @param {object} obj      объект из состояния (свой или чужой)
 * @param {object} scene    состояние сцены владельца (speed, playing, use3d, shape3d, ...)
 * @param {object} opts     { size, interactive, animate, scale }
 * @returns {{node: HTMLElement, stop: () => void}}
 */
export function renderObjectPreview(obj, scene = {}, opts = {}) {
  const { size = 58, interactive = false, animate = true } = opts;
  const s = scene || {};
  const running = [];
  const box = el('div', { class: 'preview-obj' });
  box.style.setProperty('--size', `${size}px`);

  if (s.use3d) {
    const model = buildModel(s.shape3d || 'cube', Math.round(size * 0.9), obj.color || s.color || '#38BDF8');
    const spin = el('div', { class: `mini-spin ${animate && s.playing !== false ? 'on' : ''}` }, [model.root ?? model]);
    spin.style.setProperty('--speed', String(Math.max(0.1, s.speed || 1)));
    const holder = el('div', { class: 'mini-model' }, [spin]);
    holder.style.transform = `rotateX(${s.modelRotX ?? -18}deg) rotateY(${s.modelRotY ?? 28}deg) scale(${s.modelZoom ?? 1})`;
    box.append(holder);
    return { node: box, stop: () => running.forEach((a) => a.cancel()) };
  }

  const shape = el('div', { class: `shape shape-${obj.shape}` });
  const fx = el('div', { class: 'obj-fx' }, [shape]);
  const anim = el('div', { class: 'obj-anim' }, [fx]);
  box.append(anim);

  shape.dataset.polygon = isPolygonShape(obj.shape) ? '1' : '0';
  if (isPolygonShape(obj.shape)) {
    shape.style.clipPath = clipPathFor(obj.shape, obj.radius ?? 14);
    shape.style.background = obj.color || '#38BDF8';
  } else if (obj.shape === 'emoji') {
    shape.textContent = obj.emoji || '🙂';
    shape.style.fontSize = `${Math.round(size * 0.78)}px`;
  } else if (obj.shape === 'text') {
    shape.textContent = obj.text || 'Text';
    shape.style.fontSize = `${Math.max(11, Math.round(size * 0.28))}px`;
    shape.style.color = obj.color || '#38BDF8';
  } else if (obj.shape === 'image') {
    if (obj.image && obj.image !== 'has-image') {
      shape.append(el('img', { src: obj.image, alt: '', draggable: 'false' }));
    } else {
      shape.textContent = obj.image === 'has-image' ? '🖼' : '🖼';
      shape.style.fontSize = `${Math.round(size * 0.5)}px`;
      if (obj.image === 'has-image') shape.title = t('peek.localMedia');
    }
  } else if (obj.shape === 'video') {
    shape.style.width = '100%';
    shape.style.height = '100%';
    renderVideoShape(shape, obj, { size, interactive });
  }
  fx.style.opacity = String(obj.opacity ?? 1);
  if (obj.glow > 0) fx.style.filter = `drop-shadow(0 0 ${Math.round(obj.glow * 12)}px ${obj.color || '#fff'})`;

  if (animate && s.playing !== false) {
    running.push(...runAnimations(obj.animations || [], { anim, fx, shape }, {
      speed: s.speed || 1,
      shape: obj.shape,
      scale: size / (obj.size || 160),
    }));
  }
  return { node: box, stop: () => running.forEach((a) => a.cancel()) };
}

/** Фон чужой сцены: градиент, цвет, картинка или видео (плеером). */
export function applyBackgroundTo(node, bg) {
  const value = bg?.value;
  node.style.background = '';
  node.style.backgroundImage = '';
  node.style.backgroundColor = '';
  if (!bg || bg.type === 'preset') {
    node.style.background = 'linear-gradient(135deg, #0f172a, #1e293b)';
    return;
  }
  if (bg.type === 'color') {
    node.style.background = value || '#0EA5E9';
    return;
  }
  if (bg.type === 'image') {
    if (value && value !== 'local-media') node.style.background = `center / cover no-repeat url("${value}")`;
    else node.style.background = 'repeating-linear-gradient(45deg, #1e293b 0 12px, #0f172a 12px 24px)';
  }
}

/** Видео-фон чужой сцены (YouTube / Rutube / VK или файл) — поверхностью для <iframe>/<video>. */
export function applyVideoBackground(parent, bg) {
  parent.replaceChildren();
  if (!bg || bg.type !== 'video' || !bg.value || bg.value === 'local-media') return false;
  const provider = bg.provider || 'file';
  if (provider === 'file') {
    const video = el('video', {
      src: bg.value, autoplay: true, muted: true, loop: true, playsinline: true, preload: 'auto',
      class: 'peek-video',
    });
    video.muted = true;
    video.play?.().catch(() => {});
    parent.append(video);
    return true;
  }
  const frame = el('iframe', {
    src: bg.embed || bg.value, class: 'peek-video', title: 'video',
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
  });
  frame.setAttribute('allowfullscreen', 'true');
  parent.append(frame);
  return true;
}
