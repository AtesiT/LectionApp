// Журнал занятия: история комнаты, которую хранит сервер (data/rooms.json).
// Показываем списком, умеем копировать и сохранять в Markdown.
import { $, el, formatTime } from '../core/dom.js';
import { on } from '../core/bus.js';
import { t } from '../core/i18n.js';
import { session, loadJournal } from '../net/session.js';
import { toast } from '../ui/toast.js';
import { downloadText } from '../scene/recorder.js';

const TYPE_ICON = {
  join: '🟢', leave: '🔴', chat: '💬', state: '🎛', anim: '✨', like: '👍',
  reaction: '😀', poll: '📊', board: '✏️', freeze: '🧊', announce: '📢',
  shared: '👥', game: '🎮', push: '📤', role: '👑', kick: '⛔', system: 'ℹ️',
};

let entries = [];

export function init() {
  $('#journalRefreshBtn')?.addEventListener('click', () => refresh(true));
  $('#journalCopyBtn')?.addEventListener('click', copy);
  $('#journalSaveBtn')?.addEventListener('click', save);
  on('lang', render);
}

export async function refresh(notify = false) {
  entries = await loadJournal(200);
  render();
  if (notify) toast(t('journal.loaded', { n: entries.length }), { icon: '📔' });
  return entries.length;
}

export function get() {
  return entries.slice();
}

function render() {
  const host = $('#journalList');
  if (!host) return;
  if (!entries.length) {
    host.replaceChildren(el('li', { class: 'hint', text: t('journal.empty') }));
    return;
  }
  host.replaceChildren(...entries.slice().reverse().map((entry) => el('li', { class: 'journal-item' }, [
    el('span', { class: 'journal-time', text: formatTime(entry.ts || Date.now()) }),
    el('span', { class: 'journal-icon', text: TYPE_ICON[entry.type] || '•' }),
    el('span', { class: 'journal-text', text: entryText(entry) }),
    el('span', { class: 'journal-user', text: entry.user || '' }),
  ])));
}

function entryText(entry) {
  if (entry.textKey) return t(entry.textKey, entry.vars || {});
  return entry.text || '';
}

/** Журнал в виде Markdown — удобно вставить в отчёт о занятии. */
export function toMarkdown() {
  const header = `# ${t('journal.title')} — ${session.room || 'MAIN'}\n\n`;
  const lines = entries.map((entry) => {
    const time = formatTime(entry.ts || Date.now());
    const who = entry.user ? ` **${entry.user}**` : '';
    return `- \`${time}\` ${TYPE_ICON[entry.type] || '•'}${who} — ${entryText(entry)}`;
  });
  if (!lines.length) return `${header}_${t('journal.empty')}_\n`;
  return `${header}${lines.join('\n')}\n`;
}

function toText() {
  return entries.map((entry) => `${formatTime(entry.ts || Date.now())} ${entry.user || ''} — ${entryText(entry)}`).join('\n');
}

async function copy() {
  const text = toText();
  if (!text.trim()) { toast(t('journal.empty'), { type: 'warn' }); return false; }
  try {
    await navigator.clipboard.writeText(text);
    toast(t('journal.copied'), { icon: '📋' });
    return true;
  } catch {
    toast(t('journal.copyFail'), { type: 'warn' });
    return false;
  }
}

function save() {
  if (!entries.length) { toast(t('journal.empty'), { type: 'warn' }); return false; }
  downloadText(`journal-${session.room || 'MAIN'}-${new Date().toISOString().slice(0, 10)}.md`, toMarkdown(), 'text/markdown');
  toast(t('journal.saved'), { icon: '💾' });
  return true;
}
