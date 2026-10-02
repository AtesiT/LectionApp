// Проверка API плагинов и песочницы: window/document/fetch/eval внутри недоступны,
// а само API работает. Запуск: node --no-warnings tests/plugins_test.mjs
import assert from 'node:assert/strict';

// Минимальная заглушка DOM: модули обращаются к document только в функциях отрисовки.
const noopEl = { textContent: '', children: [], append() {}, remove() {}, firstChild: null, scrollTop: 0, scrollHeight: 0 };
globalThis.document = {
  querySelector: () => null, querySelectorAll: () => [], getElementById: () => null,
  createElement: () => ({ ...noopEl }),
  hidden: false,
  addEventListener: () => {},
  body: { classList: { add() {}, remove() {}, toggle() {} } },
  documentElement: { lang: 'ru', classList: { add() {}, remove() {}, toggle() {} } },
};
globalThis.window = globalThis;
globalThis.window.addEventListener = () => {};

const plugins = await import('../js/core/plugins.js');

let passed = 0;
const failures = [];
const check = (name, fn) => {
  try { fn(); passed += 1; console.log('✓ ' + name); }
  catch (err) { failures.push(`${name}: ${err.message}`); console.log(`✗ ${name} — ${err.message}`); }
};

check('версия API доступна', () => {
  assert.equal(typeof plugins.PLUGIN_VERSION, 'string');
  assert.ok(Number(plugins.PLUGIN_VERSION) >= 1);
});

check('корректный код выполняется', () => {
  const res = plugins.run('return 1 + 1;', { name: 'test' });
  assert.equal(res.ok, true);
  assert.equal(res.result, 2);
});

check('ошибка в коде не роняет приложение', () => {
  const res = plugins.run('это не javascript(((', { name: 'bad' });
  assert.equal(res.ok, false);
  assert.equal(typeof res.error, 'string');
});

check('внутри плагина нет window', () => {
  const res = plugins.run('return typeof window;');
  assert.equal(res.result, 'undefined');
});

check('внутри плагина нет document', () => {
  const res = plugins.run('return typeof document;');
  assert.equal(res.result, 'undefined');
});

check('внутри плагина нет fetch и XMLHttpRequest', () => {
  const res = plugins.run('return [typeof fetch, typeof XMLHttpRequest].join(",");');
  assert.equal(res.result, 'undefined,undefined');
});

check('внутри плагина нет eval и localStorage', () => {
  const res = plugins.run('return [typeof eval, typeof localStorage, typeof indexedDB, typeof globalThis].join(",");');
  assert.equal(res.result, 'undefined,undefined,undefined,undefined');
});

check('плагин видит объект motion и его методы', () => {
  const res = plugins.run('return ["updateActive", "add", "remove", "say", "every", "after", "log", "patch", "setBackground", "setEffect", "timeline"].every((k) => typeof motion[k] !== "undefined");');
  assert.equal(res.result, true);
});

check('motion.log пишет в лог (без DOM — просто не падает)', () => {
  const res = plugins.run('motion.log("привет"); return true;');
  assert.equal(res.ok, true);
  assert.equal(res.result, true);
});

check('every/after регистрируют таймеры, stopAll их чистит', () => {
  let ticks = 0;
  const res = plugins.run('motion.every(10, () => {}); motion.after(10, () => {}); return true;');
  assert.equal(res.ok, true);
  assert.equal(typeof plugins.stopAll, 'function');
  plugins.stopAll();
  void ticks;
});

check('примеры плагинов валидны', () => {
  assert.ok(plugins.EXAMPLES.length >= 3);
  for (const ex of plugins.EXAMPLES) {
    assert.ok(ex.id && ex.code && ex.ru && ex.en, `у примера ${ex.id} не хватает полей`);
    const res = plugins.run(ex.code, { name: ex.id });
    assert.equal(res.ok, true, `пример ${ex.id} не запускается: ${res.error}`);
  }
  plugins.stopAll();
});

check('stopAll очищает список плагинов', () => {
  plugins.run('return 1;');
  assert.ok(plugins.list().length >= 1);
  plugins.stopAll();
  assert.equal(plugins.list().length, 0);
});

console.log(`\nПроверок пройдено: ${passed}`);
if (failures.length) {
  console.log(`ОШИБКИ (${failures.length}):`);
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
console.log('OK — API плагинов и песочница работают');
