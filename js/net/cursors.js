// Курсоры других участников поверх сцены.
import { $, el, throttle } from '../core/dom.js';
import { on } from '../core/bus.js';
import * as transport from './transport.js';
import { session, userById } from './session.js';

const cursors = new Map(); // userId → { node, timer }

export function init() {
  const stage = $('#stage');
  const layer = $('#cursorsLayer');
  const sendCursor = throttle((x, y, visible) => {
    if (!session.connected) return;
    transport.send({ kind: 'cursor', x, y, visible });
  }, 60);

  stage.addEventListener('pointermove', (e) => {
    const rect = stage.getBoundingClientRect();
    sendCursor((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height, true);
  }, { passive: true });
  stage.addEventListener('pointerleave', () => sendCursor(0, 0, false));

  on('net:message', (msg) => {
    if (msg.type !== 'cursor' || msg.userId === session.userId) return;
    let entry = cursors.get(msg.userId);
    if (!msg.visible) {
      if (entry) entry.node.classList.add('hide');
      return;
    }
    const user = userById(msg.userId);
    if (!entry) {
      const node = el('div', { class: 'remote-cursor' }, [
        el('span', { class: 'cursor-arrow' }),
        el('span', { class: 'cursor-label' }),
      ]);
      layer.append(node);
      entry = { node, timer: null };
      cursors.set(msg.userId, entry);
    }
    entry.node.style.setProperty('--c', user?.color || '#fff');
    entry.node.querySelector('.cursor-label').textContent = `${user?.avatar || ''} ${user?.name || '?'}`;
    entry.node.style.left = `${(msg.x * 100).toFixed(2)}%`;
    entry.node.style.top = `${(msg.y * 100).toFixed(2)}%`;
    entry.node.classList.remove('hide');
    clearTimeout(entry.timer);
    entry.timer = setTimeout(() => entry.node.classList.add('hide'), 3000);
  });

  on('session:users', (users) => {
    const ids = new Set(users.map((u) => u.id));
    for (const [id, entry] of cursors) {
      if (!ids.has(id)) { entry.node.remove(); cursors.delete(id); }
    }
  });
  on('session:left', () => { for (const e of cursors.values()) e.node.remove(); cursors.clear(); });
}
