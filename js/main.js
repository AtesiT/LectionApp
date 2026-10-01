// Точка входа Motion Playground. Порядок инициализации важен:
// состояние → локализация → сцена (объекты до физики) → сеть → панели → фичи.
import { $, $$ } from './core/dom.js';
import { on, emit } from './core/bus.js';
import { initState, state, subscribe, saveLocal } from './core/store.js';
import { applyI18n, getLang } from './core/i18n.js';

import * as objects from './scene/objects.js';
import * as physics from './scene/physics.js';
import * as model3d from './scene/model3d.js';
import * as webgl from './scene/webgl.js';
import * as effects from './scene/effects.js';
import * as backgrounds from './scene/backgrounds.js';
import * as cursorfx from './scene/cursorfx.js';

import * as session from './net/session.js';
import * as chat from './net/chat.js';
import * as polls from './net/polls.js';
import * as cursors from './net/cursors.js';
import * as whiteboard from './net/whiteboard.js';
import * as admin from './net/admin.js';
import * as qr from './net/qr.js';

import * as panels from './ui/panels.js';
import * as view from './ui/view.js';
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

  // Сеть
  session.init();
  chat.init();
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

  // Автосохранение сцены локально (не чаще раза в секунду)
  let saveTimer = null;
  subscribe((s, patch, meta) => {
    if (meta.transient) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveLocal, 1000);
  });

  window.__motion = { state, emit, on };
  document.body.classList.add('ready');
  console.info('%cMotion Playground 2.0', 'color:#38BDF8;font-weight:bold', '— готово. Попробуйте ↑↑↓↓←→←→BA 😉');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
