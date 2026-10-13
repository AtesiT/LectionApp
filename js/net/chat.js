// Чат, индикатор «печатает…», реакции и лайки.
import { $, el, formatTime } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { t } from '../core/i18n.js';
import * as transport from './transport.js';
import { session, userById, notify } from './session.js';
import { toast } from '../ui/toast.js';

const EMOJI = ['😀', '😂', '😍', '🤔', '👍', '👏', '🔥', '🎉', '❤️', '🚀', '👀', '💡'];
const REACTIONS = ['👍', '❤️', '😂', '🔥', '👏', '🎉', '🤯', '👀'];

const typing = new Map(); // userId → timeout
let typingSent = false;
let typingTimer = null;
let messageCount = 0;

export function init() {
  const form = $('#chatForm');
  const input = $('#chatInput');
  const emojiBar = $('#emojiBar');
  const reactionsBar = $('#reactionsBar');

  for (const e of EMOJI) {
    emojiBar.append(el('button', { type: 'button', class: 'emoji-btn', text: e, onClick: () => { input.value += e; input.focus(); } }));
  }
  for (const e of REACTIONS) {
    reactionsBar.append(el('button', { type: 'button', class: 'emoji-btn reaction-btn', text: e, onClick: () => sendReaction(e) }));
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    transport.send({ kind: 'chat', text });
    input.value = '';
    setTyping(false);
    emit('chat:sent', text);
  });
  input.addEventListener('input', () => {
    if (input.value) setTyping(true);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => setTyping(false), 2500);
  });

  on('net:message', onMessage);
  on('like:send', (targetId) => transport.send({ kind: 'like', target: targetId }).then((r) => { if (r?.ok) emit('like:given', targetId); }));
  on('session:left', () => { $('#chatMessages').textContent = ''; typing.clear(); renderTyping(); });
  on('lang', renderTyping);
}

function setTyping(on) {
  if (on === typingSent) return;
  typingSent = on;
  transport.send({ kind: 'typing', on });
}

function onMessage(msg) {
  switch (msg.type) {
    case 'snapshot':
      hydrate(msg.chat || []);
      break;
    case 'chat':
      appendMessage(msg.message);
      if (msg.message.userId !== session.userId) {
        emit('sfx', 'message');
        notify(t('notif.chat', { name: msg.message.userName, text: msg.message.text }));
        if (!$('[data-panel="session"]').classList.contains('active')) {
          toast(t('toast.newMessage', { name: msg.message.userName }), { icon: '💬', timeout: 2500 });
          markTabBadge();
        }
      }
      typing.delete(msg.message.userId);
      renderTyping();
      break;
    case 'typing':
      if (msg.userId === session.userId) break;
      clearTimeout(typing.get(msg.userId)?.timer);
      if (msg.on) {
        const timer = setTimeout(() => { typing.delete(msg.userId); renderTyping(); }, 4000);
        typing.set(msg.userId, { name: msg.name, timer });
      } else {
        typing.delete(msg.userId);
      }
      renderTyping();
      break;
    case 'reaction':
      showReaction(msg);
      break;
    case 'chat_cleared':
      $('#chatMessages').textContent = '';
      toast(t('chat.cleared'));
      break;
    default:
      break;
  }
}

function markTabBadge() {
  const tab = document.querySelector('.tab[data-tab="session"]');
  if (tab) tab.classList.add('has-badge');
}

function hydrate(messages) {
  const root = $('#chatMessages');
  root.textContent = '';
  messageCount = 0;
  for (const m of messages) appendMessage(m, false);
  if (!messages.length) root.append(el('div', { class: 'chat-empty hint', text: t('chat.empty') }));
  root.scrollTop = root.scrollHeight;
}

function appendMessage(m, scroll = true) {
  const root = $('#chatMessages');
  root.querySelector('.chat-empty')?.remove();
  const self = m.userId === session.userId;
  const row = el('div', { class: `chat-msg ${self ? 'self' : ''}` }, [
    el('span', { class: 'chat-avatar', text: m.avatar || '🙂' }),
    el('div', { class: 'chat-bubble' }, [
      el('div', { class: 'chat-meta' }, [
        el('span', { class: 'chat-name', style: { color: m.color }, text: m.userName }),
        el('span', { class: 'chat-time', text: formatTime(m.ts, false) }),
      ]),
      el('div', { class: 'chat-text', text: m.text }),
    ]),
  ]);
  root.append(row);
  messageCount++;
  while (root.children.length > 200) root.firstChild.remove();
  if (scroll) root.scrollTop = root.scrollHeight;
}

function renderTyping() {
  const node = $('#typingIndicator');
  if (!node) return;
  const names = Array.from(typing.values()).map((v) => v.name).filter(Boolean);
  if (!names.length) { node.textContent = ''; return; }
  node.textContent = names.length > 1 ? t('chat.typingMany', { names: names.join(', ') }) : t('chat.typing', { names: names[0] });
}

function sendReaction(emoji) {
  transport.send({ kind: 'reaction', emoji });
  emit('reaction:sent', emoji);
}

function showReaction(msg) {
  const layer = document.querySelector(`.user-model-card[data-user-id="${msg.userId}"] .reaction-float-layer`);
  floatEmoji(layer, msg.emoji);
  if (msg.userId === session.userId) floatEmoji($('#reactionsLayer'), msg.emoji, true);
  else {
    const user = userById(msg.userId);
    floatEmoji($('#reactionsLayer'), `${msg.emoji}`, false, user?.name);
  }
  emit('sfx', 'pop');
}

function floatEmoji(layer, emoji, big = false, label = '') {
  if (!layer) return;
  const node = el('span', { class: `reaction-float ${big ? 'big' : ''}` }, [
    emoji,
    label ? el('small', { text: label }) : null,
  ]);
  node.style.left = `${20 + Math.random() * 60}%`;
  layer.append(node);
  setTimeout(() => node.remove(), 2200);
}

export function focusChat() {
  document.querySelector('.tab[data-tab="session"]')?.click();
  $('#chatInput')?.focus();
}
