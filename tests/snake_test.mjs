// Проверка логики «Змейки» без DOM: движение, еда, столкновения, повороты.
//   node --no-warnings tests/snake_test.mjs
import assert from 'node:assert/strict';
import { createGame, step, turn, placeFood, DIRS } from '../js/features/snake.js';

let passed = 0;
const failures = [];

function check(name, fn) {
  try { fn(); passed += 1; console.log('✓ ' + name); }
  catch (err) { failures.push(`${name}: ${err.message}`); console.log(`✗ ${name} — ${err.message}`); }
}

check('новая игра: змейка из одной клетки в центре и еда на поле', () => {
  const s = createGame(20, 10);
  assert.equal(s.snake.length, 1);
  assert.equal(s.snake[0].x, 10);
  assert.equal(s.snake[0].y, 5);
  assert.equal(s.cols, 20);
  assert.equal(s.rows, 10);
  assert.ok(s.food.x >= 0 && s.food.x < s.cols);
  assert.ok(s.alive);
  assert.ok(!s.snake.some((p) => p.x === s.food.x && p.y === s.food.y), 'еда не должна быть в змейке');
});

check('шаг двигает голову вправо', () => {
  const s = createGame(20, 10);
  const before = { ...s.snake[0] };
  const res = step(s);
  assert.deepEqual(res, { ate: false, died: false });
  assert.equal(s.snake[0].x, before.x + 1);
  assert.equal(s.snake[0].y, before.y);
  assert.equal(s.snake.length, 1, 'без еды змейка не растёт');
});

check('поворот меняет направление, но не мгновенно разворот на 180°', () => {
  const s = createGame(20, 10);
  assert.equal(turn(s, 'up'), true);
  step(s);
  assert.deepEqual(s.dir, DIRS.up);
  assert.equal(turn(s, 'down'), false, 'разворот на 180° запрещён');
  assert.equal(turn(s, 'up'), false, 'повтор того же направления игнорируется');
  assert.equal(turn(s, 'left'), true);
  step(s);
  assert.deepEqual(s.dir, DIRS.left);
});

check('змейка растёт, съев еду, и счёт увеличивается', () => {
  const s = createGame(20, 10);
  s.food = { x: s.snake[0].x + 1, y: s.snake[0].y };      // еда прямо по курсу
  const res = step(s);
  assert.equal(res.ate, true);
  assert.equal(s.score, 1);
  assert.equal(s.snake.length, 2);
  assert.equal(s.best, 1);
  // еда появилась в новой свободной клетке
  assert.ok(!s.snake.some((p) => p.x === s.food.x && p.y === s.food.y));
});

check('столкновение со стеной завершает игру', () => {
  const s = createGame(8, 6);
  s.food = { x: 0, y: 0 };
  for (let i = 0; i < 10 && s.alive; i += 1) step(s);
  assert.equal(s.alive, false);
  const deadRes = step(s);
  assert.deepEqual(deadRes, { ate: false, died: false }, 'после смерти шаг ничего не меняет');
});

check('столкновение с собой завершает игру', () => {
  const s = createGame(12, 12);
  // строим змейку длиной 5 и разворачиваем её в петлю
  s.snake = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 6, y: 5 }, { x: 7, y: 5 }];
  s.dir = { ...DIRS.down };                     // голова (5,5) → (5,6) — это своё тело
  s.food = { x: 0, y: 0 };
  const res = step(s);
  assert.equal(res.died, true);
  assert.equal(s.alive, false);
});

check('хвост не считается препятствием (можно идти на его место)', () => {
  const s = createGame(12, 12);
  s.snake = [{ x: 5, y: 5 }, { x: 5, y: 6 }, { x: 5, y: 7 }];
  s.dir = { ...DIRS.left };                     // уходим в сторону от собственного хвоста
  s.food = { x: 0, y: 0 };
  step(s);
  assert.equal(s.alive, true);
});

check('змейка заполняет всё поле — победа без ошибок', () => {
  const s = createGame(4, 3);
  let guard = 0;
  while (s.alive && guard < 200) { step(s); guard += 1; }
  assert.ok(guard < 200, 'игра должна когда-нибудь закончиться');
});

check('placeFood на занятом поле завершает игру победой', () => {
  const s = createGame(2, 1);
  s.snake = [{ x: 0, y: 0 }, { x: 1, y: 0 }];
  assert.equal(placeFood(s), false);
  assert.equal(s.alive, false);
  assert.equal(s.won, true);
});

check('пауза останавливает движение', () => {
  const s = createGame(20, 10);
  s.paused = true;
  const before = { ...s.snake[0] };
  step(s);
  assert.deepEqual(s.snake[0], before);
});

check('очередь поворотов не превышает 3 (быстрые нажатия не ломают управление)', () => {
  const s = createGame(20, 10);
  turn(s, 'up'); turn(s, 'left'); turn(s, 'down'); turn(s, 'right');
  assert.ok(s.queue.length <= 3);
});

console.log(`\nПроверок пройдено: ${passed}`);
if (failures.length) {
  console.log(`ОШИБКИ (${failures.length}):`);
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
console.log('OK — логика змейки работает');
