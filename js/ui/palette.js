// Командная палитра (Ctrl+K): нечёткий поиск по командам, стрелки + Enter.
import { $, el } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { t } from '../core/i18n.js';
import { getCommands, runCommand, commandTitle, commandCategory } from './commands.js';

let modal; let input; let list;
let items = [];
let selected = 0;

export function init() {
  modal = $('#paletteModal');
  input = $('#paletteInput');
  list = $('#paletteList');
  if (!modal) return;
  $('#paletteBtn')?.addEventListener('click', () => toggle(true));
  on('palette:toggle', () => toggle());
  input.addEventListener('input', () => { selected = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); selected = Math.min(items.length - 1, selected + 1); highlight(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); selected = Math.max(0, selected - 1); highlight(); }
    else if (e.key === 'Enter') { e.preventDefault(); execute(selected); }
    else if (e.key === 'Escape') { toggle(false); }
  });
}

export function toggle(force) {
  const open = force ?? modal.hidden;
  modal.hidden = !open;
  if (open) {
    input.value = '';
    selected = 0;
    render();
    requestAnimationFrame(() => input.focus());
    emit('palette:open');
  }
}

/** Простая нечёткая оценка: все символы запроса по порядку; бонус за префикс слова. */
function score(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const s = text.toLowerCase();
  if (s.includes(q)) return 100 - s.indexOf(q);
  let qi = 0;
  let points = 0;
  for (let i = 0; i < s.length && qi < q.length; i += 1) {
    if (s[i] === q[qi]) {
      points += (i === 0 || s[i - 1] === ' ') ? 3 : 1;
      qi += 1;
    }
  }
  return qi === q.length ? points : 0;
}

function render() {
  const q = input.value.trim();
  items = getCommands()
    .map((cmd) => {
      const title = commandTitle(cmd);
      const cat = commandCategory(cmd);
      return { cmd, title, cat, score: Math.max(score(q, title), score(q, cat) * 0.5, score(q, cmd.id) * 0.8) };
    })
    .filter((it) => it.score > 0)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, 14);
  if (!items.length) {
    list.replaceChildren(el('li', { class: 'palette-empty', text: t('palette.empty') }));
    return;
  }
  list.replaceChildren(...items.map((it, i) => el('li', {
    class: `palette-item${i === selected ? ' selected' : ''}`, role: 'option', dataset: { i: String(i) },
    onClick: () => execute(i), onMousemove: () => { if (selected !== i) { selected = i; highlight(); } },
  }, [
    el('span', { class: 'palette-cat', text: it.cat }),
    el('span', { class: 'palette-title', text: it.title }),
    it.cmd.keys ? el('kbd', { class: 'palette-keys', text: it.cmd.keys }) : null,
  ])));
}

function highlight() {
  list.querySelectorAll('.palette-item').forEach((node, i) => {
    node.classList.toggle('selected', i === selected);
    if (i === selected) node.scrollIntoView({ block: 'nearest' });
  });
}

function execute(i) {
  const it = items[i];
  if (!it) return;
  toggle(false);
  runCommand(it.cmd.id);
  emit('sfx', 'tick');
}
