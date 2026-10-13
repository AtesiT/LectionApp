// Вспомогательный скрипт: печатает матрицы QR-кодов для tests/qr_roundtrip.py
import { encodeQR } from '../js/net/qr.js';
const texts = process.argv.slice(2);
console.log(JSON.stringify(texts.map((text) => {
  const modules = encodeQR(text);
  return { text, size: modules.length, modules: modules.map((r) => r.map((b) => (b ? 1 : 0))) };
})));
