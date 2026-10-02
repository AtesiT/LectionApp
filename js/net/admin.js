// Панель ведущего: кик, очистка ленты/чата, заморозка, объявления, передача роли.
import { $, el } from '../core/dom.js';
import { on } from '../core/bus.js';
import { t } from '../core/i18n.js';
import * as transport from './transport.js';
import { session, isHost } from './session.js';
import { syncableState } from '../core/store.js';

export function init() {
  $('#freezeBtn')?.addEventListener('click', () => transport.send({ kind: 'admin', op: session.frozen ? 'unfreeze' : 'freeze' }));
  $('#pushSceneBtn')?.addEventListener('click', () => transport.send({ kind: 'admin', op: 'push_scene', state: syncableState() }));
  $('#clearFeedBtn')?.addEventListener('click', () => transport.send({ kind: 'admin', op: 'clear_feed' }));
  $('#clearChatBtn')?.addEventListener('click', () => transport.send({ kind: 'admin', op: 'clear_chat' }));
  $('#announceBtn')?.addEventListener('click', announce);
  $('#announceInput')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') announce(); });
  on('session:users', render);
  on('lang', render);
}

function announce() {
  const input = $('#announceInput');
  transport.send({ kind: 'admin', op: 'announce', text: input.value.trim() });
  input.value = '';
}

function render() {
  const root = $('#adminUsers');
  if (!root || !isHost()) return;
  root.textContent = '';
  for (const user of session.users) {
    if (user.id === session.userId) continue;
    root.append(el('div', { class: 'admin-user' }, [
      el('span', { class: 'user-dot', style: { background: user.color } }),
      el('span', { text: `${user.avatar || ''} ${user.name}` }),
      el('button', { type: 'button', class: 'ghost', text: t('admin.makeHost'), onClick: () => transport.send({ kind: 'admin', op: 'transfer_host', target: user.id }) }),
      el('button', { type: 'button', class: 'ghost danger', text: t('admin.kick'), onClick: () => transport.send({ kind: 'admin', op: 'kick', target: user.id }) }),
    ]));
  }
}
