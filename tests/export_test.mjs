// Проверка экспорта анимации в CSS/HTML (без браузера).
//   node --no-warnings tests/export_test.mjs
import assert from 'node:assert/strict';

globalThis.document = globalThis.document || {
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  createElement: () => ({ style: {}, getContext: () => null, append() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} } }),
  addEventListener: () => {},
  body: { append() {}, classList: { add() {}, remove() {}, toggle() {} } },
  documentElement: { lang: 'ru' },
};
globalThis.window = globalThis.window || globalThis;
globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});

const { buildCss, buildHtml } = await import('../js/scene/recorder.js');
const { DEFAULT_OBJECT } = await import('../js/core/store.js');

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try { fn(); passed += 1; console.log('✓ ' + name); }
  catch (err) { failures.push(`${name}: ${err.message}`); console.log(`✗ ${name} — ${err.message}`); }
};

const obj = {
  ...DEFAULT_OBJECT,
  shape: 'star',
  color: '#38BDF8',
  size: 180,
  opacity: 0.8,
  glow: 0.5,
  radius: 12,
  animations: ['pulse', 'rotate'],
};

check('CSS содержит размеры и цвет объекта', () => {
  const css = buildCss(obj);
  assert.ok(css.includes('width: 180px'), 'нет ширины');
  assert.ok(css.includes('height: 180px'), 'нет высоты');
  assert.ok(css.includes('#38BDF8'), 'нет цвета');
  assert.ok(css.includes('opacity: 0.8'), 'нет прозрачности');
});

check('CSS содержит clip-path для многоугольника', () => {
  const css = buildCss(obj);
  assert.ok(css.includes('clip-path: polygon('), 'нет clip-path');
  assert.ok(/polygon\([^)]+% [^)]+%/.test(css), 'точки полигона должны быть в процентах');
});

check('CSS содержит ключевые кадры выбранных анимаций', () => {
  const css = buildCss(obj);
  assert.ok(css.includes('@keyframes mp-pulse'), 'нет @keyframes mp-pulse');
  assert.ok(css.includes('@keyframes mp-rotate'), 'нет @keyframes mp-rotate');
  assert.ok(css.includes('animation: mp-pulse'), 'анимация не подключена');
  assert.ok(css.includes('infinite'), 'анимация должна быть бесконечной');
  assert.ok(/0% \{/.test(css) && /100% \{/.test(css), 'нет крайних кадров');
});

check('CSS без анимаций содержит animation: none', () => {
  const css = buildCss({ ...obj, animations: [] });
  assert.ok(css.includes('animation: none'), 'должно быть animation: none');
});

check('CSS для текстового объекта не содержит clip-path', () => {
  const css = buildCss({ ...obj, shape: 'text', text: 'Привет' });
  assert.ok(!css.includes('clip-path'), 'для текста clip-path не нужен');
});

check('HTML — целый документ с объектом внутри', () => {
  const html = buildHtml(obj);
  assert.ok(html.startsWith('<!doctype html>'), 'нет doctype');
  assert.ok(html.includes('<meta charset="utf-8" />'), 'нет кодировки');
  assert.ok(html.includes('class="mp-object"'), 'нет объекта');
  assert.ok(html.includes('@keyframes mp-pulse'), 'CSS не встроен');
  assert.ok(html.includes('</html>'), 'документ не закрыт');
});

check('HTML для текста содержит сам текст и экранирует его', () => {
  const html = buildHtml({ ...obj, shape: 'text', text: '<b>Привет</b>' });
  assert.ok(html.includes('&lt;b&gt;'), 'текст не экранирован');
  assert.ok(!html.includes('<b>Привет</b>'), 'опасный HTML попал в файл');
});

check('HTML для emoji содержит emoji', () => {
  const html = buildHtml({ ...obj, shape: 'emoji', emoji: '🚀' });
  assert.ok(html.includes('🚀'), 'emoji потерялось');
});

check('экспорт не падает на пустом объекте', () => {
  const css = buildCss({ shape: 'circle', size: 100, animations: ['unknown-animation'] });
  assert.equal(typeof css, 'string');
});

console.log(`\nПроверок пройдено: ${passed}`);
if (failures.length) {
  console.log(`ОШИБКИ (${failures.length}):`);
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
console.log('OK — экспорт CSS/HTML работает');
