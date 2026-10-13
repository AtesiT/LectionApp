// Простая шина событий приложения: модули общаются через события,
// не зная друг о друге напрямую.
//
// На каждое имя события в EventTarget вешаем ровно один служебный обработчик,
// а сами подписки храним в своём множестве. Так подписчиков может быть сколько
// угодно — например, на смену языка слушают все панели сразу, — и при этом не
// срабатывает предупреждение среды о слишком большом числе слушателей.
const target = new EventTarget();
const handlers = new Map();   // имя события -> множество подписчиков
const relays = new Map();     // имя события -> обработчик, повешенный в EventTarget

function relay(name) {
  return (event) => {
    const list = Array.from(handlers.get(name) || []);
    for (const handler of list) handler(event.detail);
  };
}

export function on(name, handler) {
  let list = handlers.get(name);
  if (!list) {
    list = new Set();
    handlers.set(name, list);
  }
  list.add(handler);
  if (!relays.has(name)) {
    const wrapped = relay(name);
    relays.set(name, wrapped);
    target.addEventListener(name, wrapped);
  }
  return () => list.delete(handler);
}

export function once(name, handler) {
  const off = on(name, (detail) => {
    off();
    handler(detail);
  });
  return off;
}

export function emit(name, detail = null) {
  target.dispatchEvent(new CustomEvent(name, { detail }));
}
