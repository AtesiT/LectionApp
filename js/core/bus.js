// Простая шина событий приложения: модули общаются через события,
// не зная друг о друге напрямую.
const target = new EventTarget();

export function on(name, handler) {
  const wrapped = (event) => handler(event.detail);
  target.addEventListener(name, wrapped);
  return () => target.removeEventListener(name, wrapped);
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
