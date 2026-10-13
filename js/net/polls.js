// Опросы: ведущий создаёт, все голосуют, результаты обновляются вживую.
import { $, el } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { t } from '../core/i18n.js';
import * as transport from './transport.js';
import { session, isHost } from './session.js';
import { toast } from '../ui/toast.js';

let polls = [];

export function init() {
  $('#createPollBtn')?.addEventListener('click', createPoll);
  $('#pollOptions')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); createPoll(); } });
  on('net:message', (msg) => {
    if (msg.type === 'snapshot') { polls = msg.polls || []; render(); }
    if (msg.type === 'poll') {
      const idx = polls.findIndex((p) => p.id === msg.poll.id);
      if (idx >= 0) polls[idx] = msg.poll; else polls.push(msg.poll);
      render();
      if (msg.entry && msg.poll.createdBy !== session.userName) toast(`📊 ${msg.poll.question}`, { timeout: 4000 });
    }
  });
  on('session:left', () => { polls = []; render(); });
  on('session:users', render);
  on('lang', render);
}

async function createPoll() {
  const question = $('#pollQuestion').value.trim();
  const options = $('#pollOptions').value.split(',').map((s) => s.trim()).filter(Boolean);
  if (!question || options.length < 2) { toast(t('polls.invalid'), { type: 'warn' }); return; }
  const r = await transport.send({ kind: 'poll_create', question, options }, { wait: true });
  if (r?.ok) {
    $('#pollQuestion').value = '';
    $('#pollOptions').value = '';
    emit('poll:created');
  }
}

function render() {
  const root = $('#pollsList');
  if (!root) return;
  root.textContent = '';
  if (!polls.length) { root.append(el('p', { class: 'hint', text: t('polls.empty') })); return; }
  for (const poll of [...polls].reverse()) {
    const votes = Object.values(poll.votes || {});
    const total = votes.length;
    const mine = poll.votes?.[session.userId];
    const card = el('div', { class: `poll ${poll.open ? 'open' : 'closed'}` }, [
      el('div', { class: 'poll-head' }, [
        el('strong', { text: poll.question }),
        el('span', { class: 'chip', text: poll.open ? t('polls.open') : t('polls.closed') }),
      ]),
      el('div', { class: 'poll-options' }, poll.options.map((opt, i) => {
        const count = votes.filter((v) => v === i).length;
        const pct = total ? Math.round((count / total) * 100) : 0;
        const btn = el('button', {
          type: 'button', class: `poll-option ${mine === i ? 'mine' : ''}`, disabled: !poll.open,
          onClick: () => { transport.send({ kind: 'poll_vote', pollId: poll.id, option: i }); emit('poll:voted'); },
        }, [
          el('span', { class: 'poll-bar', style: { width: `${pct}%` } }),
          el('span', { class: 'poll-label', text: opt }),
          el('span', { class: 'poll-pct', text: `${pct}% (${count})` }),
        ]);
        return btn;
      })),
      el('div', { class: 'poll-foot' }, [
        el('span', { class: 'hint', text: `${t('polls.votes', { n: total })} · ${poll.createdBy}` }),
        poll.open && isHost() ? el('button', { type: 'button', class: 'ghost', text: t('polls.close'), onClick: () => transport.send({ kind: 'poll_close', pollId: poll.id }) }) : null,
      ]),
    ]);
    root.append(card);
  }
}
