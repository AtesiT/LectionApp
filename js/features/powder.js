// Песочница «Порошок» (в духе Powder Toy): клеточный автомат на типизированных
// массивах. Элементы двигаются по своим правилам (сыпучие, жидкости, газы) и
// реагируют друг с другом: вода тушит огонь, лава плавит лёд, кислота ест
// почти всё, порох и газ взрываются, растения растут рядом с водой.
//
// Всего зависимостей — ноль: рисуем сами в canvas, обновляем в requestAnimationFrame.
import { $, el } from '../core/dom.js';
import { state } from '../core/store.js';
import { t } from '../core/i18n.js';
import { on } from '../core/bus.js';

// --- элементы --------------------------------------------------------------------

export const EMPTY = 0;
export const T = {
  WALL: 1, STONE: 2, SAND: 3, WATER: 4, OIL: 5, FIRE: 6, SMOKE: 7, STEAM: 8,
  LAVA: 9, OBSIDIAN: 10, WOOD: 11, COAL: 12, ASH: 13, ICE: 14, SNOW: 15,
  GLASS: 16, METAL: 17, ACID: 18, DIRT: 19, MUD: 20, PLANT: 21, SEED: 22,
  SALT: 23, SALTWATER: 24, SUGAR: 25, POWDER: 26, GAS: 27, BOMB: 28, SPONGE: 29,
  VOID: 30, MERCURY: 31, SPARK: 32, CLOUD: 33, FIREWORK: 34, NEON: 35, TORCH: 36,
  RUST: 37, MAGIC: 38,
};

const POWDER = 'powder';
const LIQUID = 'liquid';
const GAS = 'gas';
const NONE = 'none';

/**
 * Таблица элементов.
 *  move  — как себя ведёт (сыпучее/жидкость/газ/неподвижно)
 *  rgb   — базовый цвет
 *  alpha — прозрачность (стекло)
 *  glow  — светится (рисуем свечение поверх)
 *  burn  — горит (вероятность за frame при соседстве с огнём)
 *  spread— во сколько клеток расползается жидкость за шаг
 *  diss  — растворяется кислотой
 */
export const ELEMENTS = {
  [T.WALL]: { ru: 'Стена', en: 'Wall', move: NONE, rgb: [120, 128, 140] },
  [T.STONE]: { ru: 'Камень', en: 'Stone', move: NONE, rgb: [122, 122, 132], diss: 0.35 },
  [T.SAND]: { ru: 'Песок', en: 'Sand', move: POWDER, rgb: [222, 196, 128] },
  [T.WATER]: { ru: 'Вода', en: 'Water', move: LIQUID, rgb: [56, 132, 230], spread: 4 },
  [T.OIL]: { ru: 'Масло', en: 'Oil', move: LIQUID, rgb: [92, 74, 52], spread: 3, burn: 0.25, float: true },
  [T.FIRE]: { ru: 'Огонь', en: 'Fire', move: GAS, rgb: [255, 150, 40], glow: true, rise: 0.35 },
  [T.SMOKE]: { ru: 'Дым', en: 'Smoke', move: GAS, rgb: [90, 90, 100], rise: 0.9, life: 90 },
  [T.STEAM]: { ru: 'Пар', en: 'Steam', move: GAS, rgb: [200, 214, 236], rise: 0.9, life: 220 },
  [T.LAVA]: { ru: 'Лава', en: 'Lava', move: LIQUID, rgb: [226, 84, 30], spread: 1, glow: true, hot: true },
  [T.OBSIDIAN]: { ru: 'Обсидиан', en: 'Obsidian', move: NONE, rgb: [46, 40, 62], diss: 0.08 },
  [T.WOOD]: { ru: 'Дерево', en: 'Wood', move: NONE, rgb: [124, 88, 52], burn: 0.06, diss: 0.2 },
  [T.COAL]: { ru: 'Уголь', en: 'Coal', move: NONE, rgb: [46, 46, 52], burn: 0.02, diss: 0.1 },
  [T.ASH]: { ru: 'Пепел', en: 'Ash', move: POWDER, rgb: [148, 148, 152] },
  [T.ICE]: { ru: 'Лёд', en: 'Ice', move: NONE, rgb: [150, 214, 244], alpha: 220, melt: 0.35 },
  [T.SNOW]: { ru: 'Снег', en: 'Snow', move: POWDER, rgb: [238, 246, 255], melt: 0.5 },
  [T.GLASS]: { ru: 'Стекло', en: 'Glass', move: NONE, rgb: [176, 214, 236], alpha: 90, diss: 0.25 },
  [T.METAL]: { ru: 'Металл', en: 'Metal', move: NONE, rgb: [158, 166, 178], diss: 0.15, conduct: true },
  [T.ACID]: { ru: 'Кислота', en: 'Acid', move: LIQUID, rgb: [150, 232, 60], spread: 3 },
  [T.DIRT]: { ru: 'Земля', en: 'Dirt', move: POWDER, rgb: [110, 82, 56], diss: 0.4 },
  [T.MUD]: { ru: 'Грязь', en: 'Mud', move: POWDER, rgb: [86, 66, 44], diss: 0.4 },
  [T.PLANT]: { ru: 'Растение', en: 'Plant', move: NONE, rgb: [64, 190, 108], burn: 0.12, grow: true, diss: 0.4 },
  [T.SEED]: { ru: 'Семечко', en: 'Seed', move: POWDER, rgb: [176, 146, 86] },
  [T.SALT]: { ru: 'Соль', en: 'Salt', move: POWDER, rgb: [238, 238, 246] },
  [T.SALTWATER]: { ru: 'Солёная вода', en: 'Salt water', move: LIQUID, rgb: [76, 156, 214], spread: 4 },
  [T.SUGAR]: { ru: 'Сахар', en: 'Sugar', move: POWDER, rgb: [246, 240, 226] },
  [T.POWDER]: { ru: 'Порох', en: 'Gunpowder', move: POWDER, rgb: [72, 72, 78], explode: true, burn: 0.6 },
  [T.GAS]: { ru: 'Газ', en: 'Gas', move: GAS, rgb: [188, 226, 120], rise: 0.85, explode: true, life: 200 },
  [T.BOMB]: { ru: 'Бомба', en: 'Bomb', move: NONE, rgb: [40, 44, 56], explode: true, glow: true },
  [T.SPONGE]: { ru: 'Губка', en: 'Sponge', move: NONE, rgb: [238, 216, 92], soak: true, diss: 0.5 },
  [T.VOID]: { ru: 'Пустота', en: 'Void', move: NONE, rgb: [16, 12, 26], erase: true, glow: true },
  [T.MERCURY]: { ru: 'Ртуть', en: 'Mercury', move: LIQUID, rgb: [190, 196, 208], spread: 5, conduct: true },
  [T.SPARK]: { ru: 'Ток', en: 'Spark', move: NONE, rgb: [130, 210, 255], glow: true, life: 30, energy: true },
  [T.CLOUD]: { ru: 'Облако', en: 'Cloud', move: NONE, rgb: [206, 216, 232], rain: true },
  [T.FIREWORK]: { ru: 'Фейерверк', en: 'Firework', move: GAS, rgb: [255, 220, 120], glow: true, rise: 0.9, life: 60 },
  [T.NEON]: { ru: 'Неон', en: 'Neon', move: NONE, rgb: [255, 90, 200], glow: true },
  [T.TORCH]: { ru: 'Факел', en: 'Torch', move: NONE, rgb: [148, 108, 62], glow: true, hot: true, diss: 0.3 },
  [T.RUST]: { ru: 'Ржавчина', en: 'Rust', move: POWDER, rgb: [172, 96, 48] },
  [T.MAGIC]: { ru: 'Магия', en: 'Magic', move: LIQUID, rgb: [186, 120, 255], spread: 3, glow: true, clone: true },
};

export const GROUPS = [
  { ru: 'Основное', en: 'Basics', items: [T.WALL, T.SAND, T.WATER, T.STONE, T.DIRT] },
  { ru: 'Огонь', en: 'Fire', items: [T.FIRE, T.SMOKE, T.STEAM, T.LAVA, T.TORCH, T.ASH] },
  { ru: 'Жидкости', en: 'Liquids', items: [T.OIL, T.ACID, T.MERCURY, T.MAGIC, T.SALTWATER] },
  { ru: 'Природа', en: 'Nature', items: [T.WOOD, T.PLANT, T.SEED, T.SNOW, T.ICE, T.MUD, T.CLOUD] },
  { ru: 'Химия', en: 'Chemistry', items: [T.COAL, T.SALT, T.SUGAR, T.POWDER, T.GAS, T.RUST, T.SPONGE] },
  { ru: 'Разное', en: 'Special', items: [T.METAL, T.GLASS, T.OBSIDIAN, T.SPARK, T.NEON, T.BOMB, T.VOID, T.FIREWORK] },
];

const FLAMMABLE = new Set([T.WOOD, T.COAL, T.PLANT, T.OIL, T.POWDER, T.GAS, T.SEED, T.SPONGE, T.SUGAR, T.MUD]);
const DISSOLVE_SAFE = new Set([EMPTY, T.WALL, T.GLASS, T.VOID, T.ACID]);
const CONDUCTORS = new Set([T.METAL, T.MERCURY, T.SPARK]);

// --- состояние симуляции --------------------------------------------------------------

let cols = 0;
let rows = 0;
let cell = 4;
let type = null;
let life = null;
let moved = null;
let orig = null;
let noise = null;
let ctx2d = null;
let canvas = null;
let image = null;
let pixels = null;
let glowCanvas = null;
let glowCtx = null;
let raf = 0;
let running = false;
let clock = 0;
let brushType = T.SAND;
let brushSize = 4;
let pointerDown = false;
let pointerAt = null;
let dirty = true;
let demoKind = 'volcano';
let fps = 0;
let frames = 0;
let fpsAt = 0;
let stats = { cells: 0 };

const counters = new Map();

export function init() {
  canvas = $('#powderCanvas');
  glowCanvas = document.createElement('canvas');
  glowCtx = glowCanvas.getContext?.('2d') || null;
  ctx2d = canvas ? (canvas.getContext?.('2d') || null) : null;
  buildPaletteUi();                        // палитру строим всегда
  bindControls();
  bindPointer();
  if (!canvas || !ctx2d) return;           // без 2d-контекста песочница просто не рисуется
  resize();
  demo('volcano');
  start();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stop();
    else if ($('#powder')?.classList.contains('active')) start();
  });
  window.addEventListener('resize', onResize);
  on('tab', (name) => {
    if (name === 'powder') { resize(); start(); }
    else stop();
  });
}

function onResize() {
  if (!$('#powder')?.classList.contains('active')) return;
  clearTimeout(onResize._t);
  onResize._t = setTimeout(resize, 200);
}

export function start() {
  if (running) return;
  running = true;
  fpsAt = performance.now();
  frames = 0;
  raf = requestAnimationFrame(loop);
  setPlayLabel();
}

export function stop() {
  running = false;
  cancelAnimationFrame(raf);
  setPlayLabel();
}

function loop(now) {
  if (!running) return;
  step();
  if (pointerDown && pointerAt) paint(pointerAt.x, pointerAt.y);
  render();
  frames++;
  if (now - fpsAt > 1000) {
    fps = Math.round((frames * 1000) / (now - fpsAt));
    frames = 0;
    fpsAt = now;
    updateStats();
  }
  raf = requestAnimationFrame(loop);
}

// --- сетка -------------------------------------------------------------------------

/** Создаёт (или пересоздаёт) мир заданного размера. Нужна и тестам без DOM. */
export function createWorld(newCols, newRows, newCell = 4) {
  cols = newCols;
  rows = newRows;
  cell = newCell;
  const n = cols * rows;
  type = new Uint8Array(n);
  life = new Uint8Array(n);
  moved = new Uint8Array(n);
  orig = new Uint8Array(n);
  noise = new Uint8Array(n);
  for (let i = 0; i < n; i++) noise[i] = Math.floor(Math.random() * 32);
  return n;
}

export function size() {
  return { cols, rows, cell };
}

export function cellAt(x, y) {
  if (!type || !inside(x, y)) return EMPTY;
  return type[idx(x, y)];
}

export function put(x, y, what, lifeValue = 0) {
  if (!type || !inside(x, y)) return false;
  set(idx(x, y), what, lifeValue);
  return true;
}

export function counts() {
  const map = new Map();
  if (!type) return map;
  for (let i = 0; i < type.length; i++) {
    if (type[i] === EMPTY) continue;
    map.set(type[i], (map.get(type[i]) || 0) + 1);
  }
  return map;
}

export function fill(x0, y0, x1, y1, what, lifeValue = 0) {
  let n = 0;
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) if (put(x, y, what, lifeValue)) n++;
  }
  return n;
}

export function setRunning(value) {
  if (value) start();
  else stop();
}

function resize() {
  if (!canvas) return;
  const wrap = canvas.parentElement;
  const w = Math.max(240, wrap.clientWidth);
  const h = Math.max(200, Math.min(560, Math.round(window.innerHeight * 0.55)));
  cell = window.innerWidth < 520 ? 5 : 4;
  cols = Math.floor(w / cell);
  rows = Math.floor(h / cell);
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  canvas.style.width = `${cols * cell}px`;
  canvas.style.height = `${rows * cell}px`;
  const n = cols * rows;
  type = new Uint8Array(n);
  life = new Uint8Array(n);
  moved = new Uint8Array(n);
  orig = new Uint8Array(n);
  noise = new Uint8Array(n);
  for (let i = 0; i < n; i++) noise[i] = Math.floor(Math.random() * 32);
  image = typeof ctx2d.createImageData === 'function'
    ? ctx2d.createImageData(canvas.width, canvas.height)
    : null;
  pixels = image?.data?.buffer ? new Uint32Array(image.data.buffer) : null;
  glowCanvas.width = Math.max(1, cols);
  glowCanvas.height = Math.max(1, rows);
  dirty = true;
  demo(demoKind);
}

export function clearAll() {
  if (!type) return;
  type.fill(0);
  life.fill(0);
  dirty = true;
  render();
}

function idx(x, y) {
  return y * cols + x;
}

function inside(x, y) {
  return x >= 0 && x < cols && y >= 0 && y < rows;
}

function set(i, what, lifeValue = 0) {
  type[i] = what;
  life[i] = lifeValue;
  if (orig) orig[i] = 0;
}

function swap(a, b) {
  const tt = type[a]; type[a] = type[b]; type[b] = tt;
  const ll = life[a]; life[a] = life[b]; life[b] = ll;
  const oo = orig[a]; orig[a] = orig[b]; orig[b] = oo;
  moved[a] = 1;
  moved[b] = 1;
}

/** Пустая ли клетка для движения данного типа (тяжёлое тонет в лёгком). */
function canDisplace(moving, target) {
  if (target === EMPTY) return true;
  const from = ELEMENTS[moving];
  const to = ELEMENTS[target];
  if (!from || !to) return false;
  if (from.move === GAS) return to.move === LIQUID;      // пузырьки поднимаются сквозь жидкость
  if (from.move === LIQUID) return to.move === GAS;      // жидкость топит газы
  if (from.move === POWDER) return to.move === GAS || to.move === LIQUID;
  return false;
}

// --- шаг симуляции ---------------------------------------------------------------------

export function step() {
  if (!type) return;
  moved.fill(0);
  clock++;
  const dir = clock % 2 === 0 ? 1 : -1;
  stats.cells = 0;
  counters.clear();
  for (let y = rows - 1; y >= 0; y--) {
    for (let k = 0; k < cols; k++) {
      const x = dir > 0 ? k : cols - 1 - k;
      const i = idx(x, y);
      const what = type[i];
      if (what === EMPTY) continue;
      counters.set(what, (counters.get(what) || 0) + 1);
      stats.cells++;
      if (moved[i]) continue;
      react(x, y, i, what);
      if (moved[i] || type[i] !== what) continue;
      move(x, y, i, what, dir);
    }
  }
  dirty = true;
}

function react(x, y, i, what) {
  const d = ELEMENTS[what];
  if (!d) return;

  // счётчики жизни: элемент исчезает или превращается, когда время выйдет
  if (d.life && what !== T.FIRE) {
    if (life[i] === 0) life[i] = d.life;
    life[i]--;
    if (life[i] <= 0) {
      if (what === T.STEAM) set(i, T.WATER);
      else if (what === T.FIREWORK) explode(x, y, 6, T.FIRE);
      else if (what === T.SPARK) { const back = orig[i] || EMPTY; orig[i] = 0; set(i, back); }
      else set(i, EMPTY);
      return;
    }
  }

  const neighbours = [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]];

  switch (what) {
    case T.FIRE: {
      if (life[i] === 0) life[i] = 40 + Math.floor(Math.random() * 40);
      life[i]--;
      if (life[i] === 0) { set(i, Math.random() < 0.6 ? T.SMOKE : EMPTY, 60); return; }
      for (const [nx, ny] of neighbours) {
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        const other = type[j];
        if (other === T.WATER || other === T.SALTWATER) { set(i, T.STEAM, 180); return; }
        if (other === T.ICE || other === T.SNOW) { set(j, T.WATER); continue; }
        if (other === T.POWDER || other === T.GAS || other === T.BOMB) { explode(nx, ny, 5, T.FIRE); return; }
        if (FLAMMABLE.has(other)) {
          const burn = ELEMENTS[other]?.burn ?? 0.1;
          if (Math.random() < burn) set(j, T.FIRE, 40 + Math.floor(Math.random() * 60));
        }
      }
      break;
    }
    case T.LAVA: {
      for (const [nx, ny] of neighbours) {
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        const other = type[j];
        if (other === T.WATER || other === T.SALTWATER) {
          set(j, T.STEAM, 200);
          set(i, T.OBSIDIAN);
          return;
        }
        if (other === T.ICE || other === T.SNOW) { set(j, T.WATER); continue; }
        if (FLAMMABLE.has(other) && Math.random() < 0.4) set(j, T.FIRE, 60);
      }
      break;
    }
    case T.TORCH: {
      if (y > 0 && Math.random() < 0.12) {
        const j = idx(x, y - 1);
        if (type[j] === EMPTY) set(j, T.FIRE, 70);
      }
      break;
    }
    case T.WATER:
    case T.SALTWATER: {
      for (const [nx, ny] of neighbours) {
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        const other = type[j];
        if (other === T.FIRE) { set(j, T.STEAM, 160); continue; }
        if (other === T.LAVA) { set(i, T.STEAM, 200); set(j, T.OBSIDIAN); return; }
        if (other === T.SALT && what === T.WATER) { set(i, T.SALTWATER); set(j, EMPTY); continue; }
        if (other === T.SUGAR && Math.random() < 0.25) { set(j, EMPTY); continue; }
        if (other === T.DIRT && what === T.WATER && Math.random() < 0.05) { set(j, T.MUD); continue; }
        if (other === T.SEED && Math.random() < 0.15) { set(j, T.PLANT); continue; }
        if (other === T.PLANT && Math.random() < 0.03) { set(j, T.PLANT); continue; }
      }
      // испарение рядом с лавой/факелом уже обработано; жар от огня — испарение
      if (what === T.SALTWATER && Math.random() < 0.0008) set(i, T.SALT);
      break;
    }
    case T.ACID: {
      let eaten = false;
      for (const [nx, ny] of neighbours) {
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        const other = type[j];
        if (DISSOLVE_SAFE.has(other)) continue;
        const rate = ELEMENTS[other]?.diss ?? 0.2;
        if (Math.random() < rate * 0.35) {
          if (other === T.POWDER || other === T.GAS || other === T.BOMB) { explode(nx, ny, 4, T.ACID); return; }
          set(j, EMPTY);
          eaten = true;
        }
      }
      if (eaten && Math.random() < 0.35) set(i, Math.random() < 0.5 ? T.SMOKE : EMPTY, 50);
      break;
    }
    case T.PLANT: {
      if (Math.random() > 0.09) break;
      const water = neighbours.filter(([nx, ny]) => inside(nx, ny)
        && (type[idx(nx, ny)] === T.WATER || type[idx(nx, ny)] === T.MUD));
      if (water.length) {
        const [nx, ny] = water[Math.floor(Math.random() * water.length)];
        set(idx(nx, ny), T.PLANT);
      }
      break;
    }
    case T.CLOUD: {
      if (Math.random() < 0.02 && y + 1 < rows) {
        const j = idx(x, y + 1);
        if (type[j] === EMPTY) set(j, T.WATER);
      }
      break;
    }
    case T.SPONGE: {
      for (const [nx, ny] of neighbours) {
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        if ((type[j] === T.WATER || type[j] === T.SALTWATER) && Math.random() < 0.3) set(j, EMPTY);
      }
      break;
    }
    case T.VOID: {
      for (const [nx, ny] of neighbours) {
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        if (type[j] !== EMPTY && type[j] !== T.VOID) set(j, EMPTY);
      }
      break;
    }
    case T.SPARK: {
      // ток бежит по проводникам
      let spread = false;
      for (const [nx, ny] of [...neighbours, [x - 1, y - 1], [x + 1, y - 1], [x - 1, y + 1], [x + 1, y + 1]]) {
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        if (CONDUCTORS.has(type[j]) && type[j] !== T.SPARK) {
          // заряд слабеет с каждым переходом, поэтому волна тока конечна
          const charge = (life[i] || d.life) - 2;
          if (charge > 0) {
            const saved = type[j];           // запоминаем, что было (металл/ртуть)
            set(j, T.SPARK, charge);
            orig[j] = saved;
            spread = true;
          }
        } else if (type[j] === T.POWDER || type[j] === T.GAS || type[j] === T.BOMB) {
          explode(nx, ny, 5, T.FIRE);
          return;
        } else if (FLAMMABLE.has(type[j]) && Math.random() < 0.05) {
          set(j, T.FIRE, 40);
        }
      }
      if (!spread && !orig[i] && Math.random() < 0.5) set(i, EMPTY);
      break;
    }
    case T.MAGIC: {
      // «Магия» превращает соседей в себя, но медленно и только пустые/воду
      if (Math.random() < 0.35) {
        const j = randomNeighbour(x, y, neighbours);
        if (j >= 0 && (type[j] === EMPTY || type[j] === T.WATER)) set(j, T.MAGIC);
      }
      break;
    }
    case T.FIREWORK: {
      if (life[i] === 0) life[i] = 55 + Math.floor(Math.random() * 25);
      break;
    }
    default:
      break;
  }
}

/** Есть ли рядом горючий материал — тогда огонь не улетает вверх. */
function fuelAround(x, y) {
  const around = [[x, y - 1], [x, y + 1], [x - 1, y], [x + 1, y]];
  for (const [nx, ny] of around) {
    if (!inside(nx, ny)) continue;
    const other = type[idx(nx, ny)];
    if (FLAMMABLE.has(other) && ELEMENTS[other]?.burn) return true;
  }
  return false;
}

function randomNeighbour(x, y, list) {
  const candidates = list.filter(([nx, ny]) => inside(nx, ny));
  if (!candidates.length) return -1;
  const [nx, ny] = candidates[Math.floor(Math.random() * candidates.length)];
  return idx(nx, ny);
}

function explode(cx, cy, radius, withType) {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const nx = cx + dx;
      const ny = cy + dy;
      if (!inside(nx, ny)) continue;
      const j = idx(nx, ny);
      if (type[j] === T.WALL) continue;
      const chance = 1 - Math.sqrt(dx * dx + dy * dy) / (radius + 1);
      if (Math.random() < chance) set(j, withType === T.ACID ? T.ACID : T.FIRE, 30 + Math.floor(Math.random() * 50));
      else if (Math.random() < 0.3) set(j, EMPTY);
    }
  }
}

function move(x, y, i, what, dir) {
  const d = ELEMENTS[what];
  if (!d || d.move === NONE) return;

  if (d.move === GAS) {
    if (what === T.FIRE && fuelAround(x, y)) return;   // огонь «висит» на топливе, пока горит
    const rise = d.rise ?? 1;
    if (Math.random() > rise) return;                  // газы поднимаются не каждый кадр
    const up = y > 0 ? idx(x, y - 1) : -1;
    if (up >= 0 && canDisplace(what, type[up]) && Math.random() < 0.85) { swap(i, up); return; }
    const side = Math.random() < 0.5 ? -1 : 1;
    for (const sx of [side, -side]) {
      if (!inside(x + sx, y - 1)) continue;
      const j = idx(x + sx, y - 1);
      if (canDisplace(what, type[j])) { swap(i, j); return; }
    }
    for (const sx of [side, -side]) {
      if (!inside(x + sx, y)) continue;
      const j = idx(x + sx, y);
      if (type[j] === EMPTY) { swap(i, j); return; }
    }
    return;
  }

  // вниз
  const down = y + 1 < rows ? idx(x, y + 1) : -1;
  if (down >= 0 && canDisplace(what, type[down])) { swap(i, down); return; }

  // по диагонали
  const side = Math.random() < 0.5 ? -1 : 1;
  for (const sx of [side, -side]) {
    if (!inside(x + sx, y + 1)) continue;
    const j = idx(x + sx, y + 1);
    if (canDisplace(what, type[j])) { swap(i, j); return; }
  }

  // жидкости растекаются
  if (d.move === LIQUID) {
    const spread = d.spread ?? 3;
    let steps = 1 + Math.floor(Math.random() * spread);
    let cx = x;
    while (steps-- > 0) {
      const nx = cx + dir;
      if (!inside(nx, y) || type[idx(nx, y)] !== EMPTY) break;
      cx = nx;
    }
    if (cx !== x) { swap(i, idx(cx, y)); return; }
    let bx = x;
    let back = 1 + Math.floor(Math.random() * spread);
    while (back-- > 0) {
      const nx = bx - dir;
      if (!inside(nx, y) || type[idx(nx, y)] !== EMPTY) break;
      bx = nx;
    }
    if (bx !== x) swap(i, idx(bx, y));
  }
}

// --- отрисовка -------------------------------------------------------------------------

function render() {
  if (!canvas || !pixels) return;
  if (!dirty) return;
  pixels.fill(0);
  let glowCount = 0;
  const glowImage = typeof glowCtx?.createImageData === 'function'
    ? glowCtx.createImageData(glowCanvas.width, glowCanvas.height)
    : null;
  const glowPix = glowImage?.data?.buffer ? new Uint32Array(glowImage.data.buffer) : null;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = idx(x, y);
      const what = type[i];
      if (what === EMPTY) continue;
      const d = ELEMENTS[what];
      if (!d) continue;
      let [r, g, b] = d.rgb;
      const n = noise[i] - 16;
      if (what === T.FIRE) {
        const heat = Math.min(1, life[i] / 70);
        r = 255;
        g = Math.round(90 + 150 * heat);
        b = Math.round(20 + 90 * heat * heat);
      } else if (what === T.LAVA) {
        const heat = 0.6 + 0.4 * Math.sin((clock + noise[i] * 3) * 0.15);
        r = Math.round(200 + 55 * heat);
        g = Math.round(60 + 90 * heat);
        b = 30;
      } else if (what === T.MAGIC) {
        const hue = ((clock * 2 + noise[i] * 8) % 360) * (Math.PI / 180);
        r = Math.round(150 + 100 * Math.sin(hue));
        g = Math.round(120 + 100 * Math.sin(hue + 2.1));
        b = Math.round(200 + 55 * Math.sin(hue + 4.2));
      } else if (what === T.PLANT) {
        g = Math.round(150 + 60 * ((noise[i] % 8) / 8));
      } else {
        r = clamp255(r + n);
        g = clamp255(g + n);
        b = clamp255(b + n);
      }
      const a = d.alpha ?? 255;
      const color = ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
      fillBlock(x, y, color, a === 255);
      if (d.glow && glowPix) {
        glowPix[i] = (0xFF000000 | (b << 16) | (g << 8) | r) >>> 0;
        glowCount++;
      }
    }
  }
  ctx2d.putImageData(image, 0, 0);
  if (glowCount > 0 && glowPix?.some((v) => v !== 0)) {
    glowCtx.putImageData(glowImage, 0, 0);
    try {
      ctx2d.save();
      ctx2d.globalCompositeOperation = 'lighter';
      ctx2d.globalAlpha = 0.55;
      if ('filter' in ctx2d) ctx2d.filter = 'blur(3px)';
      ctx2d.imageSmoothingEnabled = true;
      ctx2d.drawImage(glowCanvas, 0, 0, canvas.width, canvas.height);
      ctx2d.restore();
    } catch { ctx2d.restore(); }
  }
  dirty = false;
}

function fillBlock(x, y, color, opaque) {
  const px = x * cell;
  const py = y * cell;
  for (let dy = 0; dy < cell; dy++) {
    const row = (py + dy) * canvas.width;
    for (let dx = 0; dx < cell; dx++) {
      pixels[row + px + dx] = color;
    }
  }
  void opaque;
}

function clamp255(v) {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// --- кисть -----------------------------------------------------------------------------

function paint(clientX, clientY) {
  if (!canvas || !type) return;
  const rect = canvas.getBoundingClientRect();
  const sx = canvas.width / rect.width;
  const sy = canvas.height / rect.height;
  const cx = Math.floor(((clientX - rect.left) * sx) / cell);
  const cy = Math.floor(((clientY - rect.top) * sy) / cell);
  const r = brushSize;
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (!inside(x, y)) continue;
      const i = idx(x, y);
      if (brushType === EMPTY) { set(i, EMPTY); continue; }
      if (type[i] !== EMPTY && brushType !== EMPTY && !ELEMENTS[brushType].move) {
        if (Math.random() > 0.5) continue;
      }
      const density = brushType === T.FIRE || brushType === T.SMOKE ? 0.35 : 0.85;
      if (Math.random() > density) continue;
      set(i, brushType, ELEMENTS[brushType].life ? ELEMENTS[brushType].life : 0);
    }
  }
  dirty = true;
  if (!running) render();
}

function bindPointer() {
  if (!canvas) return;
  canvas.addEventListener('pointerdown', (e) => {
    pointerDown = true;
    canvas.setPointerCapture?.(e.pointerId);
    paint(e.clientX, e.clientY);
  });
  canvas.addEventListener('pointermove', (e) => {
    pointerAt = { x: e.clientX, y: e.clientY };
    if (pointerDown) paint(e.clientX, e.clientY);
  });
  const stop = () => { pointerDown = false; };
  canvas.addEventListener('pointerup', stop);
  canvas.addEventListener('pointerleave', () => { stop(); pointerAt = null; });
  canvas.addEventListener('pointercancel', stop);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

// --- интерфейс --------------------------------------------------------------------------

function buildPaletteUi() {
  if (typeof document === 'undefined') return;
  const host = $('#powderPalette');
  if (!host) return;
  host.textContent = '';
  for (const group of GROUPS) {
    const title = el('div', { class: 'powder-group-title', 'data-i18n-skip': '1' }, [label(group)]);
    const row = el('div', { class: 'powder-row' });
    for (const item of group.items) {
      const d = ELEMENTS[item];
      const btn = el('button', {
        class: 'powder-chip',
        type: 'button',
        title: label(d),
        'data-mat': String(item),
      }, [
        el('span', { class: 'powder-dot', style: `background:rgb(${d.rgb.join(',')})` }),
        el('span', { class: 'powder-name' }, [label(d)]),
      ]);
      btn.addEventListener('click', () => selectMaterial(item));
      row.append(btn);
    }
    host.append(title, row);
  }
  const eraser = el('button', {
    class: 'powder-chip', type: 'button', title: t('powder.eraser'), 'data-mat': '0',
  }, [el('span', { class: 'powder-dot', style: 'background:#0b1020;border:1px solid #475569' }), el('span', { class: 'powder-name' }, [t('powder.eraser')])]);
  eraser.addEventListener('click', () => selectMaterial(EMPTY));
  host.append(el('div', { class: 'powder-group-title' }, [t('powder.tools')]), el('div', { class: 'powder-row' }, [eraser]));
}

function label(entry) {
  return state.lang === 'en' ? entry.en : entry.ru;
}

function selectMaterial(what) {
  if (typeof document === 'undefined') return;
  brushType = Number(what) || EMPTY;
  document.querySelectorAll('.powder-chip').forEach((node) => {
    node.classList.toggle('active', Number(node.dataset.mat) === brushType);
  });
  const name = brushType === EMPTY ? t('powder.eraser') : label(ELEMENTS[brushType]);
  const hint = $('#powderHint');
  if (hint) hint.textContent = `${t('powder.brush')}: ${name}`;
}

function bindControls() {
  $('#powderPlay')?.addEventListener('click', () => (running ? stop() : start()));
  $('#powderStep')?.addEventListener('click', () => { stop(); step(); render(); });
  $('#powderClear')?.addEventListener('click', clearAll);
  $('#powderDemo')?.addEventListener('change', (e) => demo(e.target.value));
  const size = $('#powderBrush');
  size?.addEventListener('input', () => {
    brushSize = Number(size.value) || 3;
    const out = $('#powderBrushVal');
    if (out) out.textContent = String(brushSize);
  });
  selectMaterial(brushType);
}

function setPlayLabel() {
  if (typeof document === 'undefined') return;
  const btn = $('#powderPlay');
  if (btn) btn.textContent = running ? `⏸ ${t('powder.pause')}` : `▶ ${t('powder.play')}`;
}

function updateStats() {
  if (typeof document === 'undefined') return;
  const node = $('#powderStats');
  if (!node) return;
  const top = [...counters.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
    .map(([what, count]) => `${label(ELEMENTS[what])}: ${count}`).join(' · ');
  node.textContent = `${t('powder.fps')}: ${fps} · ${stats.cells} ${t('powder.cells')}${top ? ' · ' + top : ''}`;
}

// --- примеры ------------------------------------------------------------------------------

export function demo(kind) {
  if (!type) return;
  if (kind) demoKind = kind;
  type.fill(0);
  life.fill(0);
  const put = (x, y, what) => { if (inside(x, y)) set(idx(x, y), what); };
  const rect = (x0, y0, x1, y1, what) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, what);
  };
  // дно и стенки
  rect(0, rows - 2, cols - 1, rows - 1, T.STONE);
  rect(0, 0, 0, rows - 1, T.WALL);
  rect(cols - 1, 0, cols - 1, rows - 1, T.WALL);

  if (kind === 'volcano') {
    const cx = Math.floor(cols / 2);
    rect(cx - 12, rows - 12, cx + 12, rows - 3, T.STONE);
    rect(cx - 4, rows - 16, cx + 4, rows - 12, T.STONE);
    rect(cx - 2, 2, cx + 2, 2, T.LAVA);
    rect(2, rows - 8, 14, rows - 3, T.SAND);
    rect(cols - 15, rows - 8, cols - 3, rows - 3, T.WATER);
    rect(cx - 20, rows - 5, cx - 16, rows - 3, T.WOOD);
  } else if (kind === 'rain') {
    rect(4, 2, cols - 5, 4, T.CLOUD);
    rect(6, rows - 10, cols - 7, rows - 3, T.WATER);
    rect(Math.floor(cols / 2) - 6, rows - 14, Math.floor(cols / 2) + 6, rows - 11, T.PLANT);
  } else if (kind === 'chemistry') {
    rect(6, 6, cols - 7, 9, T.ACID);
    rect(10, rows - 6, cols - 11, rows - 3, T.METAL);
    rect(Math.floor(cols / 2) - 8, rows - 12, Math.floor(cols / 2) + 8, rows - 7, T.WOOD);
  } else if (kind === 'fireworks') {
    rect(2, rows - 6, cols - 3, rows - 3, T.STONE);
    for (let i = 0; i < 5; i++) put(4 + i * Math.floor((cols - 8) / 5), rows - 4, T.FIREWORK);
    rect(Math.floor(cols / 2) - 3, rows - 20, Math.floor(cols / 2) + 3, rows - 18, T.WOOD);
  } else if (kind === 'circuit') {
    rect(4, Math.floor(rows / 2), cols - 5, Math.floor(rows / 2) + 1, T.METAL);
    rect(Math.floor(cols / 2) - 2, Math.floor(rows / 2) - 8, Math.floor(cols / 2) + 2, Math.floor(rows / 2) - 1, T.METAL);
    put(Math.floor(cols / 2), Math.floor(rows / 2), T.SPARK);
    rect(6, rows - 6, 20, rows - 4, T.POWDER);
    rect(cols - 21, rows - 6, cols - 7, rows - 4, T.POWDER);
  } else if (kind === 'empty') {
    rect(0, rows - 2, cols - 1, rows - 1, T.STONE);
  }
  dirty = true;
  render();
}

export function setLang() {
  buildPaletteUi();
  selectMaterial(brushType);
  setPlayLabel();
}

export function isRunning() {
  return running;
}
