// Горячие клавиши + оверлей справки по ним (клавиша ?).
import { $, $$, el } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { t } from '../core/i18n.js';
import { state, activeObject, updateActiveObject, removeObject, undo, redo } from '../core/store.js';
import { runCommand } from './commands.js';
import { toggleBoardMode, isBoardMode } from '../net/whiteboard.js';
import { isPresenting, togglePresentation } from './view.js';

const HOTKEYS = [
  ['Space', 'hk.space'], ['1 – 9', 'hk.digits'], ['T', 'hk.t'], ['D', 'hk.d'], ['R', 'hk.r'], ['N', 'hk.n'],
  ['F', 'hk.f'], ['P', 'hk.p'], ['B', 'hk.b'], ['M', 'hk.m'], ['V', 'hk.v'], ['C', 'hk.c'], ['L', 'hk.l'],
  ['← ↑ → ↓', 'hk.arrows'], ['Delete', 'hk.del'], ['Ctrl+Z', 'hk.undo'], ['Ctrl+Y / Ctrl+Shift+Z', 'hk.redo'],
  ['Ctrl+K', 'hk.palette'], ['?', 'hk.help'], ['Esc', 'hk.esc'],
];

export function init() {
  window.addEventListener('keydown', onKeyDown);
  $('#helpBtn')?.addEventListener('click', toggleHelp);
  on('help:toggle', toggleHelp);
  on('lang', renderTables);
  renderTables();
}

function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
}

function used(e, id) {
  e.preventDefault();
  emit('hotkey', id);
}

function onKeyDown(e) {
  const key = e.key;
  const ctrl = e.ctrlKey || e.metaKey;

  // Esc — универсальный выход
  if (key === 'Escape') {
    const openModal = $$('.modal').find((m) => !m.hidden);
    if (openModal) { openModal.hidden = true; return; }
    if (isBoardMode()) { toggleBoardMode(false); return; }
    if (isPresenting()) { togglePresentation(); return; }
    return;
  }

  if (ctrl && key.toLowerCase() === 'k') { used(e, 'palette'); emit('palette:toggle'); return; }
  if (isTyping(e.target)) return;
  if (document.getElementById('entryGate') && !document.getElementById('entryGate').hidden) return;

  if (ctrl && !e.shiftKey && key.toLowerCase() === 'z') { used(e, 'undo'); undo(); return; }
  if (ctrl && (key.toLowerCase() === 'y' || (e.shiftKey && key.toLowerCase() === 'z'))) { used(e, 'redo'); redo(); return; }
  if (ctrl && key.toLowerCase() === 's') { used(e, 'save'); runCommand('save'); return; }
  if (ctrl || e.altKey) return;

  if (key === ' ') { used(e, 'toggle'); runCommand('toggle'); return; }
  if (/^[1-9]$/.test(key)) {
    const idx = Number(key) - 1;
    const cmdId = `anim:${['pulse', 'rotate', 'slide', 'fade', 'bounce', 'shake', 'flip', 'swing', 'wobble'][idx]}`;
    used(e, cmdId);
    runCommand(cmdId);
    return;
  }
  const map = { t: 'theme', d: '3d', r: 'random', f: 'fullscreen', p: 'present', b: 'board', m: 'mute', v: 'voice', c: 'chat', l: 'lang', n: 'addObject' };
  const lower = key.toLowerCase();
  const ruMap = { е: 't', в: 'd', к: 'r', а: 'f', з: 'p', и: 'b', ь: 'm', м: 'v', с: 'c', д: 'l', т: 'n' };
  const mapped = map[lower] || map[ruMap[lower]];
  if (mapped) { used(e, mapped); runCommand(mapped); return; }
  if (key === '?' || (key === '/' && e.shiftKey)) { used(e, 'help'); toggleHelp(); return; }
  if (key.startsWith('Arrow')) {
    const obj = activeObject();
    if (!obj || state.use3d) return;
    const step = e.shiftKey ? 20 : 5;
    const dx = key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0;
    const dy = key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0;
    used(e, 'move');
    updateActiveObject({ x: obj.x + dx, y: obj.y + dy }, { action: null, coalesce: `move-${obj.id}` });
    return;
  }
  if (key === 'Delete' || key === 'Backspace') {
    const obj = activeObject();
    if (obj && state.objects.length > 1) { used(e, 'delete'); removeObject(obj.id, { action: 'removeObject' }); }
  }
}

function renderTables() {
  const rows = HOTKEYS.map(([keys, label]) => el('tr', {}, [
    el('td', {}, keys.split(' / ').map((k, i) => el('span', {}, [i ? ' / ' : null, el('kbd', { text: k })]))),
    el('td', { text: t(label) }),
  ]));
  const table = $('#hotkeysTable');
  const overlayTable = $('#hotkeysTableOverlay');
  if (table) table.replaceChildren(...rows.map((r) => r.cloneNode(true)));
  if (overlayTable) overlayTable.replaceChildren(...rows);
}

export function toggleHelp() {
  const overlay = $('#helpOverlay');
  if (!overlay) return;
  overlay.hidden = !overlay.hidden;
}
