// Звуковые эффекты (синтез через Web Audio, без файлов) и визуализация микрофона.
import { $, loadJSON, saveJSON, clamp } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { subscribe } from '../core/store.js';
import { t } from '../core/i18n.js';
import { toast } from '../ui/toast.js';

const prefs = loadJSON('mp2:sound', { enabled: true, volume: 0.5 });
let ctx = null;
let master = null;
let noiseBuffer = null;
let lastCollision = 0;

// Микрофон
let micStream = null;
let analyser = null;
let micRaf = null;
let sensitivity = 1.5;

export function init() {
  const toggle = $('#soundToggle');
  const volume = $('#volume');
  const btn = $('#soundBtn');
  toggle.checked = prefs.enabled;
  volume.value = String(prefs.volume);
  updateButton();

  toggle.addEventListener('change', () => { prefs.enabled = toggle.checked; save(); updateButton(); if (prefs.enabled) play('click'); });
  volume.addEventListener('input', () => { prefs.volume = Number(volume.value); save(); if (master) master.gain.value = prefs.volume; });
  volume.addEventListener('change', () => play('pop'));
  btn.addEventListener('click', () => toggleSound());
  $('#soundTestBtn')?.addEventListener('click', () => play('achievement'));

  $('#micBtn')?.addEventListener('click', toggleMic);
  $('#micBtn2')?.addEventListener('click', toggleMic);
  $('#micSensitivity')?.addEventListener('input', (e) => { sensitivity = Number(e.target.value); });

  on('sfx', (name) => play(name));
  on('physics:collision', ({ force }) => {
    const now = performance.now();
    if (force > 150 && now - lastCollision > 90) { lastCollision = now; play('thump', clamp(force / 1500, 0.1, 1)); }
  });
  on('dice:rolling', () => play('dice'));
  on('dice:rolled', () => play('pop'));
  subscribe((s, patch, meta) => {
    if (meta.source !== 'user') return;
    if (meta.action === 'start') play('start');
    else if (meta.action === 'stop') play('stop');
    else if (meta.action === 'random') play('whoosh');
    else if (meta.action === 'theme') play('pop');
  });
  document.addEventListener('click', (e) => {
    if (e.target.closest('button, .tab, .anim-card')) play('click');
  });
}

function save() {
  saveJSON('mp2:sound', prefs);
}

function updateButton() {
  const btn = $('#soundBtn');
  if (btn) btn.textContent = prefs.enabled ? '🔊' : '🔇';
  const toggle = $('#soundToggle');
  if (toggle) toggle.checked = prefs.enabled;
}

export function toggleSound() {
  prefs.enabled = !prefs.enabled;
  save();
  updateButton();
  if (prefs.enabled) play('start');
  return prefs.enabled;
}

export function isSoundOn() {
  return prefs.enabled;
}

function ensureContext() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = prefs.volume;
  master.connect(ctx.destination);
  return ctx;
}

function tone({ freq = 440, type = 'sine', duration = 0.1, gain = 0.2, at = 0, slideTo = null }) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  const t0 = ctx.currentTime + at;
  osc.frequency.setValueAtTime(freq, t0);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + duration);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

function noise({ duration = 0.08, gain = 0.2, at = 0 }) {
  if (!noiseBuffer) {
    noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  const g = ctx.createGain();
  const t0 = ctx.currentTime + at;
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  const filter = ctx.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = 1800;
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + duration + 0.02);
}

export function play(name, strength = 1) {
  if (!prefs.enabled) return;
  if (!ensureContext()) return;
  try {
    switch (name) {
      case 'click': tone({ freq: 900, duration: 0.03, gain: 0.06 }); break;
      case 'pop': tone({ freq: 700, slideTo: 300, duration: 0.09, gain: 0.15 }); break;
      case 'start': tone({ freq: 440, duration: 0.1, gain: 0.15 }); tone({ freq: 660, duration: 0.14, gain: 0.15, at: 0.1 }); break;
      case 'stop': tone({ freq: 660, duration: 0.1, gain: 0.15 }); tone({ freq: 330, duration: 0.16, gain: 0.15, at: 0.1 }); break;
      case 'join': [523, 659, 784].forEach((f, i) => tone({ freq: f, duration: 0.14, gain: 0.14, at: i * 0.09 })); break;
      case 'leave': tone({ freq: 392, duration: 0.14, gain: 0.12 }); tone({ freq: 262, duration: 0.2, gain: 0.12, at: 0.12 }); break;
      case 'message': tone({ freq: 880, slideTo: 1320, duration: 0.09, gain: 0.12 }); break;
      case 'achievement': [523, 659, 784, 1047].forEach((f, i) => tone({ freq: f, type: 'triangle', duration: 0.18, gain: 0.16, at: i * 0.1 })); break;
      case 'error': tone({ freq: 200, type: 'square', duration: 0.15, gain: 0.08 }); break;
      case 'dice': [0, 0.1, 0.22, 0.38].forEach((at) => noise({ duration: 0.06, gain: 0.25, at })); break;
      case 'thump': tone({ freq: 140 * strength + 60, slideTo: 50, type: 'sine', duration: 0.09, gain: 0.12 * strength }); break;
      case 'whoosh': noise({ duration: 0.25, gain: 0.18 }); tone({ freq: 300, slideTo: 900, duration: 0.25, gain: 0.05 }); break;
      case 'tick': tone({ freq: 1200, duration: 0.02, gain: 0.05 }); break;
      default: tone({ freq: 600, duration: 0.05, gain: 0.08 });
    }
  } catch (err) {
    console.warn('sfx error', err);
  }
}

// --- микрофон / визуализация -----------------------------------------------

export async function toggleMic() {
  const status = $('#micStatus');
  if (micStream) {
    stopMic();
    if (status) status.textContent = '';
    return false;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    toast(t('sound.micNo'), { type: 'warn' });
    if (status) status.textContent = t('sound.micNo');
    return false;
  }
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch {
    toast(t('sound.micDenied'), { type: 'warn' });
    if (status) status.textContent = t('sound.micDenied');
    return false;
  }
  if (!ensureContext()) return false;
  const src = ctx.createMediaStreamSource(micStream);
  analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.7;
  src.connect(analyser);
  const canvas = $('#audioCanvas');
  canvas.classList.remove('hidden');
  $('#micBtn')?.classList.add('active');
  const btn2 = $('#micBtn2');
  if (btn2) btn2.textContent = t('sound.micOff');
  if (status) status.textContent = t('sound.micOn');
  emit('mic:on');
  micLoop();
  return true;
}

function stopMic() {
  micStream?.getTracks().forEach((tr) => tr.stop());
  micStream = null;
  analyser = null;
  cancelAnimationFrame(micRaf);
  $('#audioCanvas')?.classList.add('hidden');
  $('#micBtn')?.classList.remove('active');
  const btn2 = $('#micBtn2');
  if (btn2) btn2.textContent = t('sound.micBtn');
  document.getElementById('objectsLayer')?.style.setProperty('--audio', '1');
  document.getElementById('model3dAnim')?.style.setProperty('--audio', '1');
}

function micLoop() {
  const canvas = $('#audioCanvas');
  const stage = $('#stage');
  const c = canvas.getContext('2d');
  const freq = new Uint8Array(analyser.frequencyBinCount);
  const time = new Uint8Array(analyser.fftSize);
  const tick = () => {
    micRaf = requestAnimationFrame(tick);
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(time);
    let sum = 0;
    for (let i = 0; i < time.length; i++) { const v = (time[i] - 128) / 128; sum += v * v; }
    const rms = Math.sqrt(sum / time.length);
    const scale = 1 + clamp(rms * sensitivity * 1.6, 0, 0.6);
    document.getElementById('objectsLayer').style.setProperty('--audio', scale.toFixed(3));
    document.getElementById('model3dAnim').style.setProperty('--audio', scale.toFixed(3));
    const W = stage.clientWidth;
    const H = 70;
    if (canvas.width !== W) { canvas.width = W; canvas.height = H; }
    c.clearRect(0, 0, W, H);
    const bars = 48;
    const step = Math.floor(freq.length / bars);
    const bw = W / bars;
    for (let i = 0; i < bars; i++) {
      const v = freq[i * step] / 255;
      const h = v * H * sensitivity * 0.7;
      c.fillStyle = `hsla(${190 + v * 120}, 90%, 60%, 0.75)`;
      c.fillRect(i * bw + 1, H - h, bw - 2, h);
    }
  };
  tick();
}

export function isMicOn() {
  return Boolean(micStream);
}
