// Проверка расчёта значений таймлайна: интерполяция чисел и цветов между ключами.
//   node --no-warnings tests/timeline_test.mjs
import assert from 'node:assert/strict';

// ui/timeline.js внутри использует DOM только в функциях отрисовки, поэтому
// чистую функцию valueAt можно проверить и без браузера. Добавляем заглушку на всякий случай.
globalThis.document = globalThis.document || {
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementById: () => null,
  createElement: () => ({ style: {}, append() {}, addEventListener() {}, classList: { add() {}, remove() {}, toggle() {} } }),
  addEventListener: () => {},
  body: { classList: { add() {}, remove() {}, toggle() {} } },
  documentElement: { lang: 'ru' },
};
globalThis.window = globalThis.window || globalThis;
globalThis.window.addEventListener = globalThis.window.addEventListener || (() => {});

const { valueAt } = await import('../js/ui/timeline.js');

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try { fn(); passed += 1; console.log('✓ ' + name); }
  catch (err) { failures.push(`${name}: ${err.message}`); console.log(`✗ ${name} — ${err.message}`); }
};

check('без ключей значение не вычисляется', () => {
  assert.equal(valueAt([], 100), null);
  assert.equal(valueAt(null, 100), null);
  assert.equal(valueAt(undefined, 0), null);
});

check('до первого ключа — значение первого', () => {
  const keys = [{ t: 1000, v: 40 }, { t: 2000, v: 80 }];
  assert.equal(valueAt(keys, 0), 40);
  assert.equal(valueAt(keys, 1000), 40);
});

check('после последнего ключа — значение последнего', () => {
  const keys = [{ t: 1000, v: 40 }, { t: 2000, v: 80 }];
  assert.equal(valueAt(keys, 5000), 80);
  assert.equal(valueAt(keys, 2000), 80);
});

check('линейная интерполяция чисел', () => {
  const keys = [{ t: 0, v: 0 }, { t: 1000, v: 100 }];
  assert.equal(valueAt(keys, 250), 25);
  assert.equal(valueAt(keys, 500), 50);
  assert.equal(valueAt(keys, 900), 90);
});

check('интерполяция между тремя ключами', () => {
  const keys = [{ t: 0, v: 0 }, { t: 1000, v: 100 }, { t: 2000, v: 0 }];
  assert.equal(valueAt(keys, 500), 50);
  assert.equal(valueAt(keys, 1500), 50);
  assert.equal(valueAt(keys, 1750), 25);
});

check('отрицательные значения считаются верно', () => {
  const keys = [{ t: 0, v: -100 }, { t: 1000, v: 100 }];
  assert.equal(valueAt(keys, 500), 0);
  assert.equal(valueAt(keys, 250), -50);
});

check('цвета смешиваются плавно', () => {
  const keys = [{ t: 0, v: '#000000' }, { t: 1000, v: '#ffffff' }];
  assert.equal(valueAt(keys, 0), '#000000');
  assert.equal(valueAt(keys, 500), '#808080');
  assert.equal(valueAt(keys, 1000), '#ffffff');
});

check('красный → синий даёт фиолетовый', () => {
  const keys = [{ t: 0, v: '#ff0000' }, { t: 1000, v: '#0000ff' }];
  assert.equal(valueAt(keys, 500), '#800080');
});

check('сокращённая запись цвета тоже понимается', () => {
  const keys = [{ t: 0, v: '#000' }, { t: 1000, v: '#fff' }];
  assert.equal(valueAt(keys, 500), '#808080');
});

check('одиночный ключ держит значение всё время', () => {
  assert.equal(valueAt([{ t: 300, v: 7 }], 0), 7);
  assert.equal(valueAt([{ t: 300, v: 7 }], 9999), 7);
});

console.log(`\nПроверок пройдено: ${passed}`);
if (failures.length) {
  console.log(`ОШИБКИ (${failures.length}):`);
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
console.log('OK — расчёт ключевых кадров работает');
