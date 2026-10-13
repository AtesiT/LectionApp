// Свой кодировщик GIF (без библиотек): палитра 256 цветов + LZW-сжатие кадров.
// Нужен для экспорта сцены в анимированную гифку прямо в браузере.
//
// Формат: GIF89a, глобальная таблица цветов, расширение NETSCAPE (бесконечный цикл),
// у каждого кадра — Graphic Control Extension с задержкой и Image Descriptor.

const TRANSPARENT_INDEX = -1;   // прозрачность не используем, но индекс держим про запас

/** Палитра: куб 6×6×6 «веб-безопасных» цветов + 40 оттенков серого. */
export function buildPalette() {
  const palette = [];
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        palette.push([Math.round((r * 255) / 5), Math.round((g * 255) / 5), Math.round((b * 255) / 5)]);
      }
    }
  }
  while (palette.length < 256) {
    const v = Math.round(((palette.length - 216) * 255) / 39);
    palette.push([v, v, v]);
  }
  return palette;
}

/** Номер ближайшего цвета палитры (кэшируем, иначе кодирование долгое). */
export function nearestIndex(palette, r, g, b, cache) {
  const key = (r << 16) | (g << 8) | b;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < palette.length; i++) {
    const p = palette[i];
    const dr = p[0] - r;
    const dg = p[1] - g;
    const db = p[2] - b;
    const dist = dr * dr * 3 + dg * dg * 4 + db * db * 2;   // вес зелёного выше — так глазу приятнее
    if (dist < bestDist) {
      bestDist = dist;
      best = i;
      if (dist === 0) break;
    }
  }
  cache.set(key, best);
  return best;
}

/** RGBA-кадр (Uint8ClampedArray) → индексы палитры. */
export function toIndices(rgba, palette, cache = new Map()) {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
    out[p] = nearestIndex(palette, rgba[i], rgba[i + 1], rgba[i + 2], cache);
  }
  return out;
}

/**
 * Собирает GIF.
 * @param {number} width
 * @param {number} height
 * @param {Uint8Array[]} frames — индексы палитры (width*height) для каждого кадра
 * @param {number} delay — задержка в сотых долях секунды
 * @param {number[][]} [palette]
 * @returns {Uint8Array} байты GIF
 */
export function encodeGif({ width, height, frames, delay = 10, palette = null }) {
  const pal = palette || buildPalette();
  const out = new ByteArray();
  out.writeAscii('GIF89a');
  out.writeUint16(width);
  out.writeUint16(height);
  out.writeByte(0xf7);            // глобальная таблица цветов, 256 записей, 8 бит на цвет
  out.writeByte(0);               // номер фона
  out.writeByte(0);               // соотношение сторон
  for (const [r, g, b] of pal) {
    out.writeByte(r);
    out.writeByte(g);
    out.writeByte(b);
  }
  // NETSCAPE 2.0 — бесконечный цикл
  out.writeByte(0x21);
  out.writeByte(0xff);
  out.writeByte(11);
  out.writeAscii('NETSCAPE2.0');
  out.writeByte(3);
  out.writeByte(1);
  out.writeUint16(0);
  out.writeByte(0);

  for (const frame of frames) {
    out.writeByte(0x21);          // Graphic Control Extension
    out.writeByte(0xf9);
    out.writeByte(4);
    out.writeByte(0x04);          // ничего не выкидываем
    out.writeUint16(delay);
    out.writeByte(TRANSPARENT_INDEX < 0 ? 0 : TRANSPARENT_INDEX);
    out.writeByte(0);
    out.writeByte(0x2c);          // Image Descriptor
    out.writeUint16(0);
    out.writeUint16(0);
    out.writeUint16(width);
    out.writeUint16(height);
    out.writeByte(0);             // без локальной таблицы и перемежения
    const minCodeSize = 8;
    out.writeByte(minCodeSize);
    const packed = lzwEncode(frame, minCodeSize);
    for (let i = 0; i < packed.length; i += 255) {
      const chunk = Math.min(255, packed.length - i);
      out.writeByte(chunk);
      out.writeBytes(packed.subarray(i, i + chunk));
    }
    out.writeByte(0);             // конец блока данных
  }
  out.writeByte(0x3b);            // трейлер
  return out.toUint8Array();
}

/** LZW-сжатие по спецификации GIF (коды переменной длины, очистка на 4096). */
export function lzwEncode(indices, minCodeSize = 8) {
  const clearCode = 1 << minCodeSize;      // 256
  const eoiCode = clearCode + 1;           // 257
  let codeSize = minCodeSize + 1;          // 9 бит
  let maxcode = 1 << codeSize;             // как только следующий код выйдет за 512 — увеличиваем разрядность
  let nextCode = eoiCode + 1;              // 258
  let dict = new Map();
  const out = new ByteArray();

  writeCode(out, clearCode, codeSize);
  if (!indices.length) {
    writeCode(out, eoiCode, codeSize);
    return out.toUint8Array();
  }

  let prefix = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const key = (prefix << 8) | k;
    const found = dict.get(key);
    if (found !== undefined) {
      prefix = found;
      continue;
    }
    writeCode(out, prefix, codeSize);
    dict.set(key, nextCode);
    nextCode += 1;
    if (nextCode > maxcode && codeSize < 12) {
      codeSize += 1;
      maxcode = (1 << codeSize) - 1;
    }
    if (nextCode === 4096) {
      writeCode(out, clearCode, codeSize);
      dict = new Map();
      codeSize = minCodeSize + 1;
      maxcode = 1 << codeSize;
      nextCode = eoiCode + 1;
    }
    prefix = k;
  }
  writeCode(out, prefix, codeSize);
  writeCode(out, eoiCode, codeSize);
  out.flushBits();
  return out.toUint8Array();
}

// --- мелкие помощники -------------------------------------------------------------

class ByteArray {
  constructor() {
    this.parts = [];
    this.length = 0;
    this.bitBuffer = 0;
    this.bitCount = 0;
  }

  writeByte(value) {
    this.parts.push(value & 0xff);
    this.length += 1;
  }

  writeBytes(list) {
    for (const value of list) this.writeByte(value);
  }

  writeUint16(value) {
    this.writeByte(value & 0xff);
    this.writeByte((value >> 8) & 0xff);
  }

  writeAscii(text) {
    for (let i = 0; i < text.length; i++) this.writeByte(text.charCodeAt(i));
  }

  /** Пишет код в поток «младшие биты вперёд», как требует GIF. */
  writeBits(code, bits) {
    this.bitBuffer |= code << this.bitCount;
    this.bitCount += bits;
    while (this.bitCount >= 8) {
      this.writeByte(this.bitBuffer & 0xff);
      this.bitBuffer >>= 8;
      this.bitCount -= 8;
    }
  }

  flushBits() {
    if (this.bitCount > 0) {
      this.writeByte(this.bitBuffer & 0xff);
      this.bitBuffer = 0;
      this.bitCount = 0;
    }
  }

  toUint8Array() {
    const out = new Uint8Array(this.length);
    let offset = 0;
    for (const part of this.parts) out[offset++] = part;
    return out;
  }
}

function writeCode(out, code, size) {
  out.writeBits(code, size);
}
