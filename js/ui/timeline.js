// Таймлайн: ключевые кадры свойств объекта, как в монтажной программе.
// Шкала времени, дорожки свойств, интерполяция значений и воспроизведение.
// Ключи хранятся в state.timeline.tracks[objectId][prop] = [{ t: мс, v: значение }].
import { $, el, clamp } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { t } from '../core/i18n.js';
import { state, setState, updateObject, activeObject, subscribe } from '../core/store.js';
import { toast } from './toast.js';

const PROPS = [
  { key: 'x', label: 'X', min: -600, max: 600, step: 1 },
  { key: 'y', label: 'Y', min: -400, max: 400, step: 1 },
  { key: 'size', label: 'Размер', min: 30, max: 360, step: 2 },
  { key: 'opacity', label: 'Прозрачность', min: 0.1, max: 1, step: 0.05 },
  { key: 'glow', label: 'Свечение', min: 0, max: 1, step: 0.05 },
  { key: 'radius', label: 'Скругление', min: 0, max: 50, step: 1 },
  { key: 'color', label: 'Цвет', color: true },
];

let playing = false;
let time = 0;                 // мс
let lastFrame = 0;
let raf = null;
let selected = null;          // { prop, index }
let lanes; let ruler; let keysBox;
let dragging = null;

export function init() {
  lanes = $('#tlLanes');
  ruler = $('#tlRuler');
  keysBox = $('#tlKeys');
  buildPropSelect();
  $('#tlPlayBtn')?.addEventListener('click', () => togglePlay());
  $('#tlStopBtn')?.addEventListener('click', () => stop());
  $('#tlAddBtn')?.addEventListener('click', addKeyAtPlayhead);
  $('#tlDeleteBtn')?.addEventListener('click', deleteSelected);
  $('#tlClearBtn')?.addEventListener('click', clearTimeline);
  const dur = $('#tlDuration');
  dur?.addEventListener('input', () => { $('#tlDurVal').textContent = (Number(dur.value) / 1000).toFixed(1); });
  dur?.addEventListener('change', () => setDuration(Number(dur.value)));
  $('#tlLoop')?.addEventListener('change', () => setState({ timeline: { ...timeline(), loop: $('#tlLoop').checked } }, { source: 'system' }));
  ruler?.addEventListener('pointerdown', scrub);
  ruler?.addEventListener('pointermove', (e) => { if (dragging?.kind === 'scrub') scrub(e); });
  window.addEventListener('pointerup', () => { dragging = null; });
  lanes?.addEventListener('pointerdown', onLanePointerDown);
  lanes?.addEventListener('pointermove', onLanePointerMove);
  on('lang', render);
  subscribe((s, patch, meta) => {
    if ('timeline' in patch || 'objects' in patch || 'activeObjectId' in patch || meta.replace) render();
  });
  render();
}

export function timeline() {
  return state.timeline || { enabled: true, duration: 8000, loop: true, tracks: {} };
}

// --- данные -----------------------------------------------------------------------

function tracksFor(objId) {
  const tl = timeline();
  return tl.tracks?.[objId] || {};
}

function updateTimeline(patch, meta = {}) {
  setState({ timeline: { ...timeline(), ...patch } }, { action: 'timeline', ...meta });
}

function setTrack(objId, prop, keys) {
  const tl = timeline();
  const tracks = { ...(tl.tracks || {}) };
  const objTracks = { ...(tracks[objId] || {}) };
  if (keys.length) objTracks[prop] = keys;
  else delete objTracks[prop];
  tracks[objId] = objTracks;
  updateTimeline({ tracks });
}

function setDuration(ms) {
  updateTimeline({ duration: clamp(ms, 1000, 60_000) });
}

export function addKeyAtPlayhead() {
  const obj = activeObject();
  const prop = $('#tlProp')?.value;
  if (!obj || !prop) return false;
  const keys = [...(tracksFor(obj.id)[prop] || [])];
  const value = obj[prop];
  const existing = keys.findIndex((k) => Math.abs(k.t - time) < 60);
  if (existing >= 0) keys[existing] = { t: Math.round(time), v: value };
  else keys.push({ t: Math.round(time), v: value });
  keys.sort((a, b) => a.t - b.t);
  setTrack(obj.id, prop, keys);
  selected = { prop, index: keys.findIndex((k) => k.t === Math.round(time)) };
  render();
  return true;
}

function deleteSelected() {
  const obj = activeObject();
  if (!obj || !selected) { toast(t('tl.selectKey'), { type: 'warn' }); return false; }
  const keys = [...(tracksFor(obj.id)[selected.prop] || [])];
  keys.splice(selected.index, 1);
  setTrack(obj.id, selected.prop, keys);
  selected = null;
  render();
  return true;
}

function clearTimeline() {
  updateTimeline({ tracks: {} });
  selected = null;
  time = 0;
  render();
  toast(t('tl.cleared'), { icon: '⏱' });
}

export function valueAt(keys, at) {
  if (!keys?.length) return null;
  if (at <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (at >= last.t) return last.v;
  for (let i = 1; i < keys.length; i++) {
    if (keys[i].t >= at) {
      const a = keys[i - 1];
      const b = keys[i];
      const k = (at - a.t) / Math.max(1, b.t - a.t);
      if (typeof a.v === 'string') return lerpColor(a.v, b.v, k);
      return a.v + (b.v - a.v) * k;
    }
  }
  return last.v;
}

function lerpColor(a, b, k) {
  const pa = hexToParts(a);
  const pb = hexToParts(b);
  const mix = pa.map((v, i) => Math.round(v + (pb[i] - v) * k));
  return `#${mix.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

function hexToParts(hex) {
  const str = String(hex || '#000000').replace('#', '');
  const full = str.length === 3 ? str.split('').map((c) => c + c).join('') : str.padEnd(6, '0');
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
}

// --- воспроизведение ---------------------------------------------------------------

export function togglePlay() {
  if (playing) { pause(); return false; }
  play();
  return true;
}

export function play() {
  if (playing) return;
  playing = true;
  lastFrame = performance.now();
  raf = requestAnimationFrame(frame);
  $('#tlPlayBtn').textContent = '⏸';
}

export function pause() {
  playing = false;
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  $('#tlPlayBtn').textContent = '▶';
}

export function stop() {
  pause();
  time = 0;
  render();
}

function frame(now) {
  raf = requestAnimationFrame(frame);
  const dt = now - lastFrame;
  lastFrame = now;
  const tl = timeline();
  time += dt;
  if (time > tl.duration) {
    if (tl.loop) time = time % tl.duration;
    else { time = tl.duration; pause(); }
  }
  applyAt(time);
  drawPlayhead();
}

function applyAt(at) {
  const tl = timeline();
  for (const obj of state.objects) {
    const tracks = tl.tracks?.[obj.id];
    if (!tracks) continue;
    const patch = {};
    for (const [prop, keys] of Object.entries(tracks)) {
      const value = valueAt(keys, at);
      if (value === null) continue;
      patch[prop] = typeof value === 'number' ? Number(value.toFixed(3)) : value;
    }
    if (Object.keys(patch).length) updateObject(obj.id, patch, { source: 'system' });
  }
}

// --- интерфейс -----------------------------------------------------------------------

function buildPropSelect() {
  const select = $('#tlProp');
  if (!select) return;
  select.replaceChildren(...PROPS.map((p) => el('option', { value: p.key, text: t(`tl.${p.key}`, {}, p.label) })));
}

function scrub(e) {
  const rect = ruler.getBoundingClientRect();
  const k = clamp((e.clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  time = Math.round(k * timeline().duration);
  dragging = { kind: 'scrub' };
  applyAt(time);
  drawPlayhead();
}

function onLanePointerDown(e) {
  const dot = e.target.closest('.tl-key');
  if (!dot) return;
  const obj = activeObject();
  if (!obj) return;
  selected = { prop: dot.dataset.prop, index: Number(dot.dataset.index) };
  dragging = { kind: 'key', startX: e.clientX, startTime: Number(dot.dataset.t) };
  render();
}

function onLanePointerMove(e) {
  if (dragging?.kind !== 'key' || !selected) return;
  const obj = activeObject();
  if (!obj) return;
  const lane = lanes.getBoundingClientRect();
  const dt = ((e.clientX - dragging.startX) / Math.max(1, lane.width)) * timeline().duration;
  const keys = [...(tracksFor(obj.id)[selected.prop] || [])];
  if (!keys[selected.index]) return;
  keys[selected.index] = { ...keys[selected.index], t: Math.round(clamp(dragging.startTime + dt, 0, timeline().duration)) };
  keys.sort((a, b) => a.t - b.t);
  selected.index = keys.findIndex((k) => k.t === Math.round(clamp(dragging.startTime + dt, 0, timeline().duration)));
  setTrack(obj.id, selected.prop, keys);
}

function render() {
  if (!lanes || !$('#tlDuration')) return;
  const tl = timeline();
  const obj = activeObject();
  $('#tlDuration').value = tl.duration;
  $('#tlDurVal').textContent = (tl.duration / 1000).toFixed(1);
  $('#tlLoop').checked = tl.loop !== false;
  const tracks = obj ? tracksFor(obj.id) : {};
  const props = Object.keys(tracks).filter((p) => tracks[p]?.length);
  lanes.replaceChildren(...(props.length ? props.map((prop) => laneRow(prop, tracks[prop])) : [
    el('p', { class: 'hint', text: t('tl.empty') }),
  ]));
  if (keysBox) {
    const all = [];
    for (const [prop, keys] of Object.entries(tracks)) {
      keys.forEach((k, index) => all.push({ prop, index, k }));
    }
    all.sort((a, b) => a.k.t - b.k.t);
    keysBox.replaceChildren(...(all.length ? all.map(({ prop, index, k }) => el('button', {
      type: 'button',
      class: `tl-key-item ${selected?.prop === prop && selected?.index === index ? 'active' : ''}`,
      text: `${propLabel(prop)} · ${(k.t / 1000).toFixed(2)}s · ${fmtValue(k.v)}`,
      onClick: () => { selected = { prop, index }; time = k.t; applyAt(time); render(); },
    })) : [el('p', { class: 'hint', text: t('tl.noKeys') })]));
  }
  drawPlayhead();
}

function laneRow(prop, keys) {
  const row = el('div', { class: 'tl-lane', dataset: { prop } });
  row.append(el('span', { class: 'tl-lane-label', text: propLabel(prop) }));
  const track = el('div', { class: 'tl-track' });
  for (let i = 0; i < keys.length - 1; i++) {
    const left = (keys[i].t / timeline().duration) * 100;
    const width = ((keys[i + 1].t - keys[i].t) / timeline().duration) * 100;
    track.append(el('span', { class: 'tl-seg', style: { left: `${left}%`, width: `${width}%` } }));
  }
  keys.forEach((k, index) => {
    track.append(el('span', {
      class: `tl-key ${selected?.prop === prop && selected?.index === index ? 'active' : ''}`,
      dataset: { prop, index, t: k.t },
      style: { left: `${(k.t / timeline().duration) * 100}%` },
      title: `${(k.t / 1000).toFixed(2)}s → ${fmtValue(k.v)}`,
    }));
  });
  row.append(track);
  return row;
}

function drawPlayhead() {
  const head = $('#tlPlayhead');
  if (head) head.style.left = `${(time / timeline().duration) * 100}%`;
  const label = $('#tlTime');
  if (label) label.textContent = `${(time / 1000).toFixed(2)} / ${(timeline().duration / 1000).toFixed(1)} с`;
}

function propLabel(prop) {
  const def = PROPS.find((p) => p.key === prop);
  return def ? t(`tl.${prop}`, {}, def.label) : prop;
}

function fmtValue(v) {
  return typeof v === 'number' ? (Number.isInteger(v) ? String(v) : v.toFixed(2)) : String(v);
}

export function isPlaying() {
  return playing;
}
