// Общая сцена: ведущий включает один «холст» на всю комнату — все правят его
// вместе. При этом личная сцена не пропадает: участник в любой момент переключается
// между «Общая сцена» и «Моя сцена» и работает в той, где ему удобнее.
import { $, el } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { t } from '../core/i18n.js';
import { state, replaceState, syncableState } from '../core/store.js';
import * as transport from './transport.js';
import { session, isHost } from './session.js';
import { toast } from '../ui/toast.js';

let enabled = false;          // общая сцена включена в комнате
let view = 'mine';            // 'shared' | 'mine' — что сейчас показываем
let sharedState = null;       // последняя известная общая сцена
let myScene = null;           // snapshot личной сцены, чтобы вернуться
let byName = '';

export function init() {
  $('#sharedToggle')?.addEventListener('change', (e) => {
    const on_ = e.target.checked;
    if (on_) enableShared();
    else disableShared();
  });
  // кнопки переключения есть и в баннере над сценой, и в карточке сессии
  ['#sharedViewShared', '#sharedViewSharedCard'].forEach((sel) => $(sel)?.addEventListener('click', () => showShared()));
  ['#sharedViewMine', '#sharedViewMineCard'].forEach((sel) => $(sel)?.addEventListener('click', () => showMine()));
  $('#sharedExitBtn')?.addEventListener('click', () => { if (isHost()) disableShared(); else showMine(); });
  on('net:message', onMessage);
  on('state', onLocalChange);
  on('lang', render);
}

export function isShared() {
  return enabled;
}

export function isViewingShared() {
  return enabled && view === 'shared';
}

// --- включение / выключение ------------------------------------------------------

export function enableShared() {
  if (!isHost()) return false;
  transport.send({ kind: 'shared_enable', state: syncableState() });
  return true;
}

export function disableShared() {
  if (!isHost()) return false;
  transport.send({ kind: 'shared_disable' });
  return true;
}

/** Переключение личного просмотра (доступно всем участникам). */
export function showShared() {
  if (!enabled) return false;
  if (view === 'shared') return true;
  myScene = syncableState();
  view = 'shared';
  if (sharedState) replaceState(sharedState, { source: 'remote' });
  render();
  emit('shared:view', view);
  toast(t('shared.viewShared'), { icon: '👥' });
  return true;
}

export function showMine() {
  if (view === 'mine') return true;
  view = 'mine';
  if (myScene) replaceState(myScene, { source: 'user', silent: true });
  render();
  emit('shared:view', view);
  toast(t('shared.viewMine'), { icon: '🎛' });
  return true;
}

// --- сеть ------------------------------------------------------------------------

function onMessage(msg) {
  if (msg.type === 'shared') {
    if (msg.enabled === false) {
      const wasViewing = enabled && view === 'shared';
      enabled = false;
      view = 'mine';
      sharedState = sharedState || null;
      if (wasViewing && myScene) replaceState(myScene, { source: 'user', silent: true });
      render();
      toast(t('shared.off', { name: msg.byName || '' }), { icon: '👥' });
      return;
    }
    const first = !enabled;
    enabled = true;
    byName = msg.byName || '';
    if (msg.state) sharedState = msg.state;
    if (first) {
      myScene = syncableState();
      view = 'shared';
      if (sharedState) replaceState(sharedState, { source: 'remote' });
      toast(t('shared.on', { name: byName }), { icon: '👥' });
    } else if (view === 'shared' && msg.state) {
      replaceState(msg.state, { source: 'remote' });
    }
    render();
    return;
  }
  if (msg.type === 'snapshot') {
    const info = msg.shared || {};
    enabled = Boolean(info.enabled);
    if (enabled && info.state) {
      sharedState = info.state;
      myScene = syncableState();
      view = 'shared';
      replaceState(sharedState, { source: 'remote' });
    } else if (!enabled) {
      view = 'mine';
    }
    render();
  }
}

/** Любое изменение сцены участником: если он в общей сцене — отправляем её всем. */
function onLocalChange({ meta }) {
  if (!enabled || view !== 'shared') return;
  if (!meta || meta.source !== 'user') return;
  if (meta.silent || meta.transient) return;
  transport.send({
    kind: 'shared_update',
    state: syncableState(),
    textKey: meta.action ? `feed.${meta.action}` : null,
    vars: meta.vars || {},
  });
}

// --- отрисовка --------------------------------------------------------------------

export function render() {
  const toggle = $('#sharedToggle');
  if (toggle) toggle.checked = enabled;
  const host = isHost();
  if (toggle) toggle.disabled = !host;
  const banner = $('#sharedBanner');
  if (banner) {
    banner.hidden = !enabled;
    banner.classList.toggle('viewing-shared', view === 'shared');
    const text = $('#sharedBannerText');
    if (text) {
      text.textContent = enabled
        ? (view === 'shared' ? t('shared.bannerShared', { name: byName }) : t('shared.bannerMine', { name: byName }))
        : '';
    }
    const exit = $('#sharedExitBtn');
    if (exit) exit.textContent = host ? t('shared.stop') : t('shared.hide');
  }
  const viewShared = $('#sharedViewShared');
  const viewMine = $('#sharedViewMine');
  viewShared?.classList.toggle('active', view === 'shared');
  viewMine?.classList.toggle('active', view === 'mine');
  document.body.classList.toggle('shared-scene', enabled && view === 'shared');
}
