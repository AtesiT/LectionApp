// Всплывающие уведомления в углу экрана.
import { el } from '../core/dom.js';

export function toast(text, { type = 'info', timeout = 3200, icon = '' } = {}) {
  const root = document.getElementById('toasts');
  if (!root) return;
  const node = el('div', { class: `toast toast-${type}` }, [
    icon ? el('span', { class: 'toast-icon', text: icon }) : null,
    el('span', { class: 'toast-text', text }),
  ]);
  root.append(node);
  requestAnimationFrame(() => node.classList.add('show'));
  const remove = () => {
    node.classList.remove('show');
    setTimeout(() => node.remove(), 300);
  };
  node.addEventListener('click', remove);
  setTimeout(remove, timeout);
  while (root.children.length > 5) root.firstChild.remove();
}
