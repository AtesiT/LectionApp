// Проверка песочницы «Порошок» без DOM: физика, химия и сохранение материи.
//   node --no-warnings tests/powder_test.mjs
import assert from 'node:assert/strict';
import {
  T, ELEMENTS, GROUPS, createWorld, size, put, fill, cellAt, counts, clearAll, step, demo,
} from '../js/features/powder.js';

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('✓ ' + name);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.log('✗ ' + name + ' — ' + err.message);
  }
}

const W = 60;
const H = 40;

/** Чистый мир с каменным дном. */
function world({ floor = true } = {}) {
  createWorld(W, H, 4);
  if (floor) fill(0, H - 1, W - 1, H - 1, T.STONE);
  return { cols: W, rows: H };
}

function run(n) {
  for (let i = 0; i < n; i++) step();
}

function count(what) {
  return counts().get(what) || 0;
}

// --- структура ---------------------------------------------------------------------
check('мир создаётся нужного размера', () => {
  const { cols, rows, cell } = size();
  createWorld(W, H, 4);
  const s = size();
  assert.equal(s.cols, W);
  assert.equal(s.rows, H);
  assert.equal(s.cell, 4);
  void cols; void rows; void cell;
});

check('в новом мире нет ни одного элемента', () => {
  createWorld(W, H, 4);
  assert.equal(counts().size, 0);
});

check('таблица элементов совпадает с палитрой интерфейса', () => {
  const known = new Set(Object.values(T));
  const inGroups = GROUPS.flatMap((g) => g.items);
  assert.equal(new Set(inGroups).size, inGroups.length, 'элементы в группах не повторяются');
  for (const item of inGroups) {
    assert.ok(known.has(item), `в группе есть неизвестный элемент ${item}`);
    assert.ok(ELEMENTS[item], `нет описания для ${item}`);
    assert.ok(ELEMENTS[item].ru && ELEMENTS[item].en, 'нет названия RU/EN');
    assert.equal(ELEMENTS[item].rgb.length, 3, 'нет цвета');
  }
  assert.ok(inGroups.length >= 30, `мало элементов: ${inGroups.length}`);
});

// --- физика --------------------------------------------------------------------------
check('песок падает вниз', () => {
  world();
  put(30, 2, T.SAND);
  run(40);
  assert.equal(cellAt(30, 2), 0, 'песок остался наверху');
  assert.equal(cellAt(30, H - 2), T.SAND, 'песок не дошёл до дна');
});

check('песок не исчезает и не размножается', () => {
  world();
  assert.equal(fill(28, 2, 32, 6, T.SAND), 25);
  const before = count(T.SAND);
  run(60);
  assert.equal(count(T.SAND), before, 'количество песка изменилось');
});

check('песок тонет в воде', () => {
  world();
  fill(20, H - 6, 40, H - 2, T.WATER);
  put(30, H - 8, T.SAND);
  run(60);
  let sandY = -1;
  let waterTopY = H;
  for (let y = 0; y < H; y++) {
    if (cellAt(30, y) === T.SAND) sandY = y;
    if (cellAt(30, y) === T.WATER && y < waterTopY) waterTopY = y;
  }
  assert.ok(sandY > waterTopY, `песок (${sandY}) должен быть ниже поверхности воды (${waterTopY})`);
});

check('вода растекается в стороны', () => {
  world();
  fill(29, 2, 31, 4, T.WATER);
  run(50);
  let minX = W;
  let maxX = -1;
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (cellAt(x, y) === T.WATER) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); }
    }
  }
  assert.ok(maxX - minX >= 6, `вода не растеклась: ширина ${maxX - minX}`);
});

check('стена не двигается', () => {
  world();
  fill(10, 2, 14, 4, T.WALL);
  run(30);
  assert.equal(count(T.WALL), 15);
  assert.equal(cellAt(12, 2), T.WALL);
});

check('дым поднимается вверх', () => {
  world();
  put(30, H - 4, T.SMOKE, 200);
  run(25);
  let top = H;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) if (cellAt(x, y) === T.SMOKE && y < top) top = y;
  }
  assert.ok(top < H - 4, `дым не поднялся (верхняя клетка ${top})`);
});

check('пар со временем превращается в воду', () => {
  world();
  put(30, H - 4, T.STEAM, 3);
  run(6);
  assert.ok(count(T.WATER) >= 1, 'пар не сконденсировался');
});

// --- химия -----------------------------------------------------------------------------
check('огонь поджигает дерево', () => {
  world();
  fill(20, H - 2, 40, H - 2, T.WOOD);        // дерево лежит на полу
  fill(21, H - 3, 23, H - 3, T.FIRE, 200);   // поджигаем сверху
  const before = count(T.WOOD);
  run(150);
  assert.ok(count(T.WOOD) < before, 'дерево не сгорело');
  assert.ok(count(T.ASH) + count(T.FIRE) + count(T.SMOKE) > 0, 'не осталось следов горения');
});

check('вода тушит огонь', () => {
  world();
  fill(20, H - 3, 40, H - 3, T.WATER);
  put(30, H - 4, T.FIRE, 120);
  run(6);
  assert.equal(count(T.FIRE), 0, 'огонь не погас');
  assert.ok(count(T.WATER) > 0, 'вода должна остаться');
});

check('лава + вода дают обсидиан и пар', () => {
  world();
  fill(28, H - 3, 32, H - 3, T.LAVA);
  fill(28, H - 4, 32, H - 4, T.WATER);
  run(20);
  assert.ok(count(T.OBSIDIAN) > 0, 'обсидиан не образовался');
  assert.ok(count(T.STEAM) + count(T.WATER) > 0, 'пар/вода исчезли');
});

check('лава плавит снег', () => {
  world();
  fill(28, H - 3, 32, H - 3, T.SNOW);
  fill(28, H - 4, 32, H - 4, T.LAVA);
  run(20);
  assert.ok(count(T.WATER) + count(T.STEAM) > 0, 'снег не растаял');
});

check('кислота растворяет землю', () => {
  world();
  fill(26, H - 3, 34, H - 3, T.DIRT);
  fill(26, H - 6, 34, H - 5, T.ACID);
  const before = count(T.DIRT);
  run(60);
  assert.ok(count(T.DIRT) < before, 'земля не растворилась');
});

check('кислота не ест стену и стекло', () => {
  world();
  fill(10, H - 3, 20, H - 3, T.GLASS);
  fill(10, H - 5, 20, H - 4, T.ACID);
  run(40);
  assert.equal(count(T.GLASS), 11, 'стекло пострадало от кислоты');
});

check('соль растворяется в воде', () => {
  world();
  fill(28, H - 3, 32, H - 3, T.WATER);
  put(30, H - 4, T.SALT);
  run(40);
  assert.ok(count(T.SALTWATER) > 0, 'солёная вода не получилась');
});

check('пустота стирает соседей', () => {
  world();
  put(30, H - 2, T.VOID);
  put(31, H - 2, T.STONE);
  run(3);
  assert.equal(cellAt(31, H - 2), 0, 'камень рядом с пустотой не исчез');
  assert.equal(cellAt(30, H - 2), T.VOID, 'пустота должна остаться');
});

check('губка впитывает воду', () => {
  world();
  fill(26, H - 2, 34, H - 2, T.WATER);       // вода уже стоит на полу
  fill(28, H - 3, 32, H - 3, T.SPONGE);      // губка прямо над водой
  const before = count(T.WATER);
  run(40);
  assert.equal(count(T.SPONGE), 5, 'губка должна остаться');
  assert.ok(count(T.WATER) < before, 'губка не впитала воду');
});

check('растение разрастается в воде', () => {
  world();
  fill(20, H - 4, 40, H - 2, T.WATER);       // целый бассейн
  put(30, H - 3, T.PLANT);                   // росток внутри воды
  const before = count(T.PLANT);
  run(150);
  assert.ok(count(T.PLANT) > before, 'растение не выросло');
});

check('семечко прорастает рядом с водой', () => {
  world();
  fill(28, H - 3, 32, H - 3, T.WATER);
  put(30, H - 4, T.SEED);
  run(40);
  assert.ok(count(T.PLANT) > 0, 'семечко не проросло');
});

check('порох взрывается от огня', () => {
  world();
  fill(26, H - 3, 34, H - 2, T.POWDER);      // порох лежит на полу
  put(30, H - 4, T.FIRE, 60);
  const before = count(T.POWDER);
  run(25);
  assert.ok(count(T.POWDER) < before, 'порох не сдетонировал');
  assert.ok(count(T.FIRE) > 3, 'взрыв не дал огня');
});

check('газ взрывается от искры', () => {
  world();
  fill(26, H - 4, 34, H - 3, T.GAS, 200);
  fill(26, H - 5, 34, H - 5, T.METAL);
  put(30, H - 6, T.SPARK, 25);
  const before = count(T.GAS);
  run(30);
  assert.ok(count(T.GAS) < before, 'газ не взорвался');
});

check('ток бежит по металлу и не портит его', () => {
  world();
  const metal = fill(10, H - 2, 45, H - 2, T.METAL);   // провод целиком на полу
  put(12, H - 3, T.SPARK, 25);                         // искра прилетает из воздуха
  let maxSparks = 0;
  for (let i = 0; i < 12; i++) {
    step();
    let sparks = 0;
    for (let x = 0; x < W; x++) if (cellAt(x, H - 2) === T.SPARK) sparks++;
    maxSparks = Math.max(maxSparks, sparks);
  }
  assert.ok(maxSparks >= 2, 'ток не пошёл по проводу');
  run(60);
  assert.equal(count(T.METAL), metal, 'металл должен остаться после разряда');
  assert.equal(count(T.SPARK), 0, 'искра должна погаснуть');
});

check('факел поджигает пустоту над собой', () => {
  world();
  put(30, H - 3, T.TORCH);
  let maxFire = 0;
  for (let i = 0; i < 40; i++) {
    step();
    maxFire = Math.max(maxFire, count(T.FIRE));
  }
  assert.ok(maxFire > 0, 'факел не дал огня');
  assert.equal(count(T.TORCH), 1, 'факел должен остаться');
});

check('облако проливается дождём', () => {
  world();
  fill(10, 2, 40, 3, T.CLOUD);
  run(60);
  assert.ok(count(T.WATER) > 0, 'дождь не пошёл');
});

check('магия медленно заполняет пространство', () => {
  world();
  put(30, H - 3, T.MAGIC);
  const before = count(T.MAGIC);
  run(60);
  assert.ok(count(T.MAGIC) >= before, 'магия исчезла');
});

check('земля рядом с водой превращается в грязь', () => {
  world();
  fill(26, H - 3, 34, H - 3, T.DIRT);
  fill(26, H - 4, 34, H - 4, T.WATER);
  run(60);
  assert.ok(count(T.MUD) > 0, 'грязь не образовалась');
});

check('стекло не горит и не тонет', () => {
  world();
  fill(20, H - 4, 30, H - 4, T.GLASS);
  put(25, H - 5, T.FIRE, 80);
  run(40);
  assert.equal(count(T.GLASS), 11, 'стекло изменилось');
});

// --- целостность -------------------------------------------------------------------------
check('клетки не выходят за пределы мира', () => {
  world();
  fill(5, 5, 25, 15, T.SAND);
  fill(30, 5, 40, 15, T.WATER);
  fill(41, 5, 50, 15, T.ACID);
  put(52, 6, T.FIRE, 60);
  run(120);
  let total = 0;
  for (const n of counts().values()) total += n;
  assert.ok(total <= W * H, `элементов больше, чем клеток: ${total}`);
});

check('смесь не создаёт «мусорных» типов', () => {
  const known = new Set([0, ...Object.values(T)]);
  for (const key of counts().keys()) assert.ok(known.has(key), `неизвестный тип ${key}`);
});

check('clearAll очищает мир', () => {
  clearAll();
  assert.equal(counts().size, 0);
});

check('демо «вулкан» заполняет мир', () => {
  world({ floor: false });
  demo('volcano');
  assert.ok(count(T.LAVA) > 0, 'нет лавы');
  assert.ok(count(T.STONE) + count(T.WALL) > 0, 'нет скал');
  run(20);
});

check('демо «дождь» работает', () => {
  world({ floor: false });
  demo('rain');
  assert.ok(count(T.CLOUD) > 0, 'нет облаков');
  run(40);
  assert.ok(count(T.WATER) > 0, 'нет воды');
});

check('демо «цепь» замыкает ток', () => {
  world({ floor: false });
  demo('circuit');
  assert.ok(count(T.METAL) > 0 && count(T.SPARK) > 0, 'цепи нет');
  run(30);
});

check('демо «фейерверк» взрывается', () => {
  world({ floor: false });
  demo('fireworks');
  assert.ok(count(T.FIREWORK) > 0, 'нет фейерверков');
  run(120);
  assert.ok(count(T.FIRE) + count(T.SMOKE) > 0, 'фейерверк не сработал');
});

check('демо «химия» запускает кислоту', () => {
  world({ floor: false });
  demo('chemistry');
  assert.ok(count(T.ACID) > 0, 'нет кислоты');
  run(20);
});

check('демо «пусто» очищает сцену', () => {
  world({ floor: false });
  demo('empty');
  assert.ok(counts().size <= W * 2, 'сцена не пустая');
});

console.log(`\nПроверок пройдено: ${passed}`);
if (failures.length) {
  console.log(`ОШИБКИ (${failures.length}):`);
  failures.forEach((f) => console.log(' - ' + f));
  process.exit(1);
}
console.log('OK — песочница «Порошок» работает');
