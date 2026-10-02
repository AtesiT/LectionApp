// Точка входа Motion Playground. Порядок инициализации важен:
// состояние → локализация → сцена (объекты до физики) → сеть → панели → фичи.
import { $, $$ } from './core/dom.js';
import { on, emit } from './core/bus.js';
import { initState, state, subscribe, saveLocal, activeObject } from './core/store.js';
import { applyI18n, getLang, t } from './core/i18n.js';
import { toast } from './ui/toast.js';

import * as objects from './scene/objects.js';
import * as physics from './scene/physics.js';
import * as model3d from './scene/model3d.js';
import * as webgl from './scene/webgl.js';
import * as effects from './scene/effects.js';
import * as backgrounds from './scene/backgrounds.js';
import * as cursorfx from './scene/cursorfx.js';

import * as session from './net/session.js';
import * as chat from './net/chat.js';
import * as rtc from './net/rtc.js';
import * as shared from './net/shared.js';
import * as polls from './net/polls.js';
import * as cursors from './net/cursors.js';
import * as whiteboard from './net/whiteboard.js';
import * as admin from './net/admin.js';
import * as qr from './net/qr.js';

import * as panels from './ui/panels.js';
import * as view from './ui/view.js';
import * as timeline from './ui/timeline.js';
import * as shortcuts from './ui/shortcuts.js';
import * as palette from './ui/palette.js';
import * as peek from './ui/peek.js';

import * as audio from './features/audio.js';
import * as voice from './features/voice.js';
import * as weather from './features/weather.js';
import * as widgets from './features/widgets.js';
import * as achievements from './features/achievements.js';
import * as easter from './features/easter.js';
import * as quiz from './features/quiz.js';
import * as pwa from './features/pwa.js';
import * as gestures from './features/gestures.js';
import * as games from './features/games.js';
import * as powder from './features/powder.js';
import * as journal from './features/journal.js';
import * as plugins from './core/plugins.js';
import * as recorder from './scene/recorder.js';

function setupTabs() {
  const tabs = $$('.tab[data-tab]');
  const panelsList = $$('.panel[data-panel]');
  const activate = (name) => {
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
      if (active) tab.classList.remove('has-badge');
    });
    panelsList.forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === name));
    try { sessionStorage.setItem('mp2:tab', name); } catch { /* ignore */ }
    emit('tab', name);
  };
  tabs.forEach((tab) => tab.addEventListener('click', () => activate(tab.dataset.tab)));
  $$('[data-tab-link]').forEach((btn) => btn.addEventListener('click', () => activate(btn.dataset.tabLink)));
  let initial = 'object';
  try { initial = sessionStorage.getItem('mp2:tab') || 'object'; } catch { /* ignore */ }
  if (!tabs.some((tab) => tab.dataset.tab === initial)) initial = 'object';
  activate(initial);
}

function setupRipples() {
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;
    const rect = btn.getBoundingClientRect();
    const span = document.createElement('span');
    span.className = 'ripple';
    const size = Math.max(rect.width, rect.height) * 1.2;
    span.style.width = span.style.height = `${size}px`;
    span.style.left = `${e.clientX - rect.left - size / 2}px`;
    span.style.top = `${e.clientY - rect.top - size / 2}px`;
    btn.append(span);
    setTimeout(() => span.remove(), 650);
  }, { passive: true });
}

function setupLangButtons() {
  const update = () => {
    const label = getLang() === 'ru' ? 'EN' : 'RU';
    const a = $('#langToggle'); const b = $('#entryLangBtn');
    if (a) a.textContent = label;
    if (b) b.textContent = label;
    document.documentElement.lang = getLang();
  };
  on('lang', update);
  update();
}

function boot() {
  initState();
  applyI18n();
  setupLangButtons();
  setupTabs();
  setupRipples();

  // Сцена
  objects.init();
  physics.init();
  model3d.init();
  webgl.init();
  effects.init();
  backgrounds.init();
  cursorfx.init();

  // Панели и вид
  panels.init();
  peek.init();
  view.init();
  shortcuts.init();
  palette.init();
  timeline.init();

  // Сеть
  session.init();
  chat.init();
  rtc.init();
  shared.init();
  polls.init();
  cursors.init();
  whiteboard.init();
  admin.init();
  qr.init();

  // Фичи
  audio.init();
  voice.init();
  weather.init();
  widgets.init();
  achievements.init();
  easter.init();
  quiz.init();
  pwa.init();
  gestures.init();
  games.init();
  powder.init();
  journal.init();
  plugins.init();
  setupExport();

  // Автосохранение сцены локально (не чаще раза в секунду)
  let saveTimer = null;
  subscribe((s, patch, meta) => {
    if (meta.transient) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveLocal, 1000);
  });

  // window.__motion — открытый API для плагинов (ставится в plugins.init)
  if (!window.__motion) window.__motion = { state, emit, on };
  document.body.classList.add('ready');
  console.info('%cMotion Playground 2.0', 'color:#38BDF8;font-weight:bold', '— готово. Попробуйте ↑↑↓↓←→←→BA 😉');
}

// Запись сцены в видео/GIF и экспорт анимации в CSS/HTML.
function setupExport() {
  const recBtn = $('#recSceneBtn');
  recBtn?.addEventListener('click', () => {
    if (recorder.isRecording()) {
      recorder.stopSceneRecording();
      if (recBtn) recBtn.textContent = t('export.video');
    } else if (recorder.startSceneRecording()) {
      recBtn.textContent = t('export.videoStop');
      toast(t('export.recStarted'), { icon: '⏺' });
    }
  });
  $('#recGifBtn')?.addEventListener('click', async () => {
    const btn = $('#recGifBtn');
    if (btn) btn.disabled = true;
    try {
      await recorder.exportSceneGif({ seconds: 4, fps: 12, scale: 0.5 });
    } catch (err) {
      console.warn('gif export failed', err);
      toast(t('export.gifFail'), { type: 'warn' });
    }
    if (btn) btn.disabled = false;
  });
  $('#exportCssBtn')?.addEventListener('click', () => {
    const obj = activeObject();
    if (!obj) { toast(t('export.noObject'), { type: 'warn' }); return; }
    recorder.exportCssFile(obj);
  });
  $('#exportHtmlBtn')?.addEventListener('click', () => {
    const obj = activeObject();
    if (!obj) { toast(t('export.noObject'), { type: 'warn' }); return; }
    recorder.exportHtmlFile(obj);
  });
  on('shared:view', () => { /* переключение общей/своей сцены */ });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
