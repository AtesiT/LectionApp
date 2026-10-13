// PWA: регистрация service worker, кнопка установки, офлайн-индикатор.
import { $ } from '../core/dom.js';
import { emit } from '../core/bus.js';
import { t } from '../core/i18n.js';
import { toast } from '../ui/toast.js';

let deferredPrompt = null;

export function init() {
  const installBtn = $('#installBtn');
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    if (installBtn) installBtn.hidden = false;
  });
  installBtn?.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    installBtn.hidden = true;
    if (outcome === 'accepted') toast(t('toast.installed'), { type: 'success' });
  });
  window.addEventListener('appinstalled', () => {
    if (installBtn) installBtn.hidden = true;
    emit('pwa:installed');
    toast(t('toast.installed'), { type: 'success' });
  });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js', { scope: './' })
        .then((reg) => {
          reg.addEventListener('updatefound', () => {
            const worker = reg.installing;
            worker?.addEventListener('statechange', () => {
              if (worker.state === 'installed' && navigator.serviceWorker.controller) {
                // Новая версия закэширована — применится при следующей загрузке.
                console.info('[pwa] new version cached');
              }
            });
          });
        })
        .catch((err) => console.warn('[pwa] sw register failed', err));
    });
  }

  window.addEventListener('offline', () => toast(t('toast.offline'), { type: 'warn' }));
}

export function canInstall() {
  return Boolean(deferredPrompt);
}
