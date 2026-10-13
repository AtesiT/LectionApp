// Пасхалки: код Konami (режим «Матрица» + конфетти) и 10 кликов по логотипу — дискотека.
import { $ } from '../core/dom.js';
import { emit } from '../core/bus.js';
import { t } from '../core/i18n.js';
import { state, setState } from '../core/store.js';
import { toast } from '../ui/toast.js';

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
let progress = 0;
let titleClicks = 0;
let titleTimer = null;
let discoTimer = null;
let discoOn = false;
let prevTheme = null;

export function init() {
  window.addEventListener('keydown', (e) => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === KONAMI[progress]) {
      progress += 1;
      if (progress === KONAMI.length) { progress = 0; konami(); }
    } else {
      progress = key === KONAMI[0] ? 1 : 0;
    }
  });
  $('#brandBtn')?.addEventListener('click', onTitleClick);
}

function konami() {
  setState({ effect: 'matrix', effectIntensity: 1.5 }, { action: 'effect' });
  emit('effects:burst', { kind: 'confetti' });
  emit('sfx', 'achievement');
  toast(t('toast.konami'), { type: 'success', timeout: 5000 });
  emit('konami');
  emit('feed', { action: 'konami' });
  document.body.classList.add('konami');
  setTimeout(() => document.body.classList.remove('konami'), 6000);
}

function onTitleClick() {
  if (discoOn) { stopDisco(); return; }
  titleClicks += 1;
  clearTimeout(titleTimer);
  titleTimer = setTimeout(() => { titleClicks = 0; }, 2500);
  const btn = $('#brandBtn');
  if (btn) {
    btn.style.transform = `rotate(${(titleClicks % 2 ? 1 : -1) * titleClicks * 2}deg) scale(${1 + titleClicks * 0.02})`;
    setTimeout(() => { btn.style.transform = ''; }, 300);
  }
  if (titleClicks >= 10) { titleClicks = 0; startDisco(); }
}

export function startDisco() {
  if (discoOn) return;
  discoOn = true;
  prevTheme = state.theme;
  document.body.classList.add('disco');
  toast(t('toast.disco'), { timeout: 5000 });
  emit('disco');
  emit('effects:burst', { kind: 'confetti' });
  let hue = 0;
  discoTimer = setInterval(() => {
    hue = (hue + 47) % 360;
    document.documentElement.style.setProperty('--disco-hue', String(hue));
    emit('sfx', 'tick');
  }, 350);
}

export function stopDisco() {
  if (!discoOn) return;
  discoOn = false;
  clearInterval(discoTimer);
  document.body.classList.remove('disco');
  document.documentElement.style.removeProperty('--disco-hue');
  if (prevTheme && prevTheme !== state.theme) setState({ theme: prevTheme }, { source: 'system' });
  toast(t('toast.discoOff'));
}

export function isDisco() {
  return discoOn;
}
