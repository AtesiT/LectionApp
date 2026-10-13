// Готовит тестовые GIF на нашем кодировщике (для проверки декодером на Python).
//   node tests/gif_dump.mjs [путь/к/файлу.gif]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeGif, buildPalette, toIndices } from '../js/core/gif.js';

const outPath = process.argv[2] || path.join(path.dirname(fileURLToPath(import.meta.url)), 'out', 'test.gif');
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const W = 12;
const H = 8;
const palette = buildPalette();
const cache = new Map();

function frame(color) {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    rgba[i * 4] = color[0];
    rgba[i * 4 + 1] = color[1];
    rgba[i * 4 + 2] = color[2];
    rgba[i * 4 + 3] = 255;
  }
  return toIndices(rgba, palette, cache);
}

// Кадры с разными цветами + градиент, чтобы LZW реально строил словарь.
const frames = [
  frame([255, 0, 0]),
  frame([0, 0, 255]),
  frame([0, 255, 0]),
];
const gradient = new Uint8ClampedArray(W * H * 4);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    gradient[i] = Math.round((x * 255) / (W - 1));
    gradient[i + 1] = Math.round((y * 255) / (H - 1));
    gradient[i + 2] = 128;
    gradient[i + 3] = 255;
  }
}
frames.push(toIndices(gradient, palette, cache));

const bytes = encodeGif({ width: W, height: H, frames, delay: 12, palette });
fs.writeFileSync(outPath, Buffer.from(bytes));
console.log(JSON.stringify({ file: outPath, width: W, height: H, frames: frames.length, bytes: bytes.length }));
