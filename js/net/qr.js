// Компактный генератор QR-кодов (байтовый режим, версии 1–10, уровень M),
// без внешних библиотек. Алгоритм по ISO/IEC 18004.
import { $ } from '../core/dom.js';
import { t } from '../core/i18n.js';
import { shareUrl } from './session.js';

const ECC = { L: { bits: 1, idx: 0 }, M: { bits: 0, idx: 1 } };
// Число кодовых слов коррекции на блок и число блоков (версии 1..10)
const ECC_PER_BLOCK = { L: [7, 10, 15, 20, 26, 18, 20, 24, 30, 18], M: [10, 16, 26, 18, 24, 16, 18, 22, 22, 26] };
const NUM_BLOCKS = { L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4], M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5] };
const ALIGN = [[], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

function rawDataModules(ver) {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

function dataCodewords(ver, ecl) {
  return Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ecl][ver - 1] * NUM_BLOCKS[ecl][ver - 1];
}

// --- Поле Галуа GF(256) и Рид–Соломон ----------------------------------------
function gfMul(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree) {
  const result = new Array(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < degree) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 2);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = new Array(divisor.length).fill(0);
  for (const b of data) {
    const factor = b ^ result.shift();
    result.push(0);
    divisor.forEach((coef, i) => { result[i] ^= gfMul(coef, factor); });
  }
  return result;
}

// --- Кодирование данных ----------------------------------------------------------
function encodeBytes(bytes, ver, ecl) {
  const bits = [];
  const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
  push(4, 4);                       // байтовый режим
  push(bytes.length, ver < 10 ? 8 : 16);
  for (const b of bytes) push(b, 8);
  const capacity = dataCodewords(ver, ecl) * 8;
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8) bits.push(0);
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) push(pad, 8);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) out.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  return out;
}

function interleave(data, ver, ecl) {
  const numBlocks = NUM_BLOCKS[ecl][ver - 1];
  const blockEcc = ECC_PER_BLOCK[ecl][ver - 1];
  const raw = Math.floor(rawDataModules(ver) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const blocks = [];
  const divisor = rsDivisor(blockEcc);
  let k = 0;
  for (let i = 0; i < numBlocks; i++) {
    const len = shortLen - blockEcc + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const ecc = rsRemainder(dat, divisor);
    if (i < numShort) dat.push(0);
    blocks.push(dat.concat(ecc));
  }
  const result = [];
  for (let i = 0; i < blocks[0].length; i++) {
    blocks.forEach((block, j) => {
      if (i !== shortLen - blockEcc || j >= numShort) result.push(block[i]);
    });
  }
  return result;
}

// --- Матрица ------------------------------------------------------------------------
class Matrix {
  constructor(size) {
    this.size = size;
    this.modules = Array.from({ length: size }, () => new Array(size).fill(false));
    this.isFunction = Array.from({ length: size }, () => new Array(size).fill(false));
  }

  setFn(x, y, dark) {
    this.modules[y][x] = dark;
    this.isFunction[y][x] = true;
  }

  drawFunctionPatterns(ver, ecl) {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      this.setFn(6, i, i % 2 === 0);
      this.setFn(i, 6, i % 2 === 0);
    }
    this.drawFinder(3, 3);
    this.drawFinder(n - 4, 3);
    this.drawFinder(3, n - 4);
    const pos = ALIGN[ver - 1];
    for (let i = 0; i < pos.length; i++) {
      for (let j = 0; j < pos.length; j++) {
        if ((i === 0 && j === 0) || (i === 0 && j === pos.length - 1) || (i === pos.length - 1 && j === 0)) continue;
        this.drawAlignment(pos[i], pos[j]);
      }
    }
    this.drawFormatBits(ecl, 0);
    this.drawVersion(ver);
  }

  drawFinder(cx, cy) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy));
        const x = cx + dx; const y = cy + dy;
        if (x >= 0 && x < this.size && y >= 0 && y < this.size) this.setFn(x, y, dist !== 2 && dist !== 4);
      }
    }
  }

  drawAlignment(cx, cy) {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) this.setFn(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }

  drawFormatBits(ecl, mask) {
    const data = (ECC[ecl].bits << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = ((data << 10) | rem) ^ 0x5412;
    const bit = (i) => ((bits >>> i) & 1) === 1;
    for (let i = 0; i <= 5; i++) this.setFn(8, i, bit(i));
    this.setFn(8, 7, bit(6));
    this.setFn(8, 8, bit(7));
    this.setFn(7, 8, bit(8));
    for (let i = 9; i < 15; i++) this.setFn(14 - i, 8, bit(i));
    const n = this.size;
    for (let i = 0; i < 8; i++) this.setFn(n - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i++) this.setFn(8, n - 15 + i, bit(i));
    this.setFn(8, n - 8, true);
  }

  drawVersion(ver) {
    if (ver < 7) return;
    let rem = ver;
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
    const bits = (ver << 12) | rem;
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1;
      const a = this.size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      this.setFn(a, b, bit);
      this.setFn(b, a, bit);
    }
  }

  drawCodewords(data) {
    const n = this.size;
    let i = 0;
    for (let right = n - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < n; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j;
          const upward = ((right + 1) & 2) === 0;
          const y = upward ? n - 1 - vert : vert;
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = ((data[i >>> 3] >>> (7 - (i & 7))) & 1) === 1;
            i++;
          }
        }
      }
    }
  }

  applyMask(mask) {
    const n = this.size;
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (this.isFunction[y][x]) continue;
        let invert;
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break;
          case 1: invert = y % 2 === 0; break;
          case 2: invert = x % 3 === 0; break;
          case 3: invert = (x + y) % 3 === 0; break;
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break;
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break;
          default: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break;
        }
        if (invert) this.modules[y][x] = !this.modules[y][x];
      }
    }
  }

  penalty() {
    const n = this.size;
    const m = this.modules;
    let score = 0;
    const runPenalty = (line) => {
      let s = 0;
      let run = 1;
      for (let i = 1; i <= line.length; i++) {
        if (i < line.length && line[i] === line[i - 1]) run++;
        else { if (run >= 5) s += 3 + (run - 5); run = 1; }
      }
      // Шаблон 1:1:3:1:1 с 4 светлыми модулями с одной из сторон
      const str = line.map((v) => (v ? '1' : '0')).join('');
      for (let idx = str.indexOf('10111010000'); idx >= 0; idx = str.indexOf('10111010000', idx + 1)) s += 40;
      for (let idx = str.indexOf('00001011101'); idx >= 0; idx = str.indexOf('00001011101', idx + 1)) s += 40;
      return s;
    };
    for (let y = 0; y < n; y++) score += runPenalty(m[y]);
    for (let x = 0; x < n; x++) score += runPenalty(m.map((row) => row[x]));
    for (let y = 0; y < n - 1; y++) {
      for (let x = 0; x < n - 1; x++) {
        const c = m[y][x];
        if (c === m[y][x + 1] && c === m[y + 1][x] && c === m[y + 1][x + 1]) score += 3;
      }
    }
    let dark = 0;
    for (const row of m) for (const v of row) if (v) dark++;
    const total = n * n;
    const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
    score += k * 10;
    return score;
  }
}

/** Возвращает матрицу булевых значений (true = тёмный модуль). */
export function encodeQR(text, ecl = 'M') {
  const bytes = Array.from(new TextEncoder().encode(text));
  let ver = 1;
  for (; ver <= 10; ver++) {
    const capacityBits = dataCodewords(ver, ecl) * 8;
    const needed = 4 + (ver < 10 ? 8 : 16) + bytes.length * 8;
    if (needed <= capacityBits) break;
  }
  if (ver > 10) {
    if (ecl === 'M') return encodeQR(text, 'L');
    throw new Error('Текст слишком длинный для QR-кода');
  }
  const data = interleave(encodeBytes(bytes, ver, ecl), ver, ecl);
  const size = ver * 4 + 17;
  let best = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const mx = new Matrix(size);
    mx.drawFunctionPatterns(ver, ecl);
    mx.drawCodewords(data);
    mx.drawFormatBits(ecl, mask);
    mx.applyMask(mask);
    const score = mx.penalty();
    if (score < bestScore) { bestScore = score; best = mx; }
  }
  return best.modules;
}

export function drawQR(canvas, text, { margin = 3, dark = '#0b1020', light = '#ffffff' } = {}) {
  const modules = encodeQR(text);
  const n = modules.length;
  const ctx = canvas.getContext('2d');
  const scale = Math.floor(canvas.width / (n + margin * 2));
  const offset = Math.floor((canvas.width - scale * n) / 2);
  ctx.fillStyle = light;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = dark;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (modules[y][x]) ctx.fillRect(offset + x * scale, offset + y * scale, scale, scale);
    }
  }
}

export function showQR() {
  const modal = $('#qrModal');
  const canvas = $('#qrCanvas');
  const url = shareUrl();
  try {
    drawQR(canvas, url);
  } catch (err) {
    console.warn(err);
  }
  $('#qrUrl').textContent = url;
  modal.hidden = false;
}

export function init() {
  $('#qrBtn')?.addEventListener('click', showQR);
  document.querySelectorAll('[data-close-modal]').forEach((btn) => btn.addEventListener('click', () => { btn.closest('.modal').hidden = true; }));
  document.querySelectorAll('.modal').forEach((modal) => modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; }));
  void t;
}

// Для модульных тестов
export const _internals = { rsDivisor, rsRemainder, encodeBytes, interleave, dataCodewords };
