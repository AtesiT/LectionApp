// Минимальная реализация DOM для дымового теста фронтенда в Node (без jsdom).
// Поддерживает: разбор index.html, дерево узлов, атрибуты/dataset/classList/style,
// querySelector с #id .class tag [attr] [attr="v"] :not() и комбинаторами " " и ">",
// события с всплытием, Element.animate(), canvas.getContext() (заглушка).

export class MiniEvent {
  constructor(type, init = {}) {
    this.type = type;
    this.bubbles = init.bubbles ?? true;
    this.cancelable = init.cancelable ?? true;
    this.defaultPrevented = false;
    this.propagationStopped = false;
    this.target = null;
    this.currentTarget = null;
    Object.assign(this, init);
  }
  preventDefault() { this.defaultPrevented = true; }
  stopPropagation() { this.propagationStopped = true; }
  stopImmediatePropagation() { this.propagationStopped = true; }
}
export class MiniKeyboardEvent extends MiniEvent {}
export class MiniMouseEvent extends MiniEvent {}

export class MiniNode {
  constructor() {
    this.childNodes = [];
    this.parentNode = null;
    this.listeners = new Map();
    this.ownerDocument = null;
  }
  get children() { return this.childNodes.filter((n) => n instanceof MiniElement); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get firstElementChild() { return this.children[0] ?? null; }
  get lastElementChild() { const c = this.children; return c[c.length - 1] ?? null; }
  get nextSibling() { if (!this.parentNode) return null; const i = this.parentNode.childNodes.indexOf(this); return this.parentNode.childNodes[i + 1] ?? null; }
  get nextElementSibling() { let n = this.nextSibling; while (n && !(n instanceof MiniElement)) n = n.nextSibling; return n; }
  get previousElementSibling() { if (!this.parentNode) return null; const c = this.parentNode.children; return c[c.indexOf(this) - 1] ?? null; }
  get parentElement() { return this.parentNode instanceof MiniElement ? this.parentNode : null; }
  get isConnected() { let n = this; while (n) { if (n.nodeType === 9) return true; n = n.parentNode; } return false; }
  _adopt(node) {
    if (typeof node === 'string' || typeof node === 'number') node = new MiniText(String(node));
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    node.ownerDocument = this.ownerDocument;
    return node;
  }
  appendChild(node) { node = this._adopt(node); this.childNodes.push(node); return node; }
  append(...nodes) { nodes.forEach((n) => { if (n !== null && n !== undefined) this.appendChild(n); }); }
  prepend(...nodes) { nodes.reverse().forEach((n) => { n = this._adopt(n); this.childNodes.unshift(n); }); }
  insertBefore(node, ref) {
    node = this._adopt(node);
    const i = ref ? this.childNodes.indexOf(ref) : -1;
    if (i === -1) this.childNodes.push(node); else this.childNodes.splice(i, 0, node);
    return node;
  }
  removeChild(node) { const i = this.childNodes.indexOf(node); if (i !== -1) { this.childNodes.splice(i, 1); node.parentNode = null; } return node; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceChildren(...nodes) { this.childNodes.slice().forEach((n) => this.removeChild(n)); this.append(...nodes); }
  replaceWith(node) { if (!this.parentNode) return; const p = this.parentNode; p.insertBefore(node, this); p.removeChild(this); }
  before(node) { this.parentNode?.insertBefore(node, this); }
  after(node) { this.parentNode?.insertBefore(node, this.nextSibling); }
  contains(node) { let n = node; while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  cloneNode(deep) {
    if (this instanceof MiniText) return new MiniText(this.data);
    const c = new MiniElement(this.tagName, this.ownerDocument);
    for (const [k, v] of this.attributes) c.attributes.set(k, v);
    Object.assign(c.style, this.style);
    if (deep) this.childNodes.forEach((n) => c.appendChild(n.cloneNode(true)));
    return c;
  }
  addEventListener(type, fn, opts) {
    if (!fn) return;
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push({ fn, once: typeof opts === 'object' && opts?.once });
  }
  removeEventListener(type, fn) { const l = this.listeners.get(type); if (l) this.listeners.set(type, l.filter((x) => x.fn !== fn)); }
  dispatchEvent(event) {
    if (!(event instanceof MiniEvent)) event = new MiniEvent(event.type, { bubbles: event.bubbles, cancelable: event.cancelable, detail: event.detail });
    if (!event.target) event.target = this;
    let node = this;
    const path = [];
    while (node) { path.push(node); node = node.parentNode || (node.nodeType === 9 ? node.defaultView : null); }
    for (const n of path) {
      event.currentTarget = n;
      const list = (n.listeners.get(event.type) || []).slice();
      for (const { fn, once } of list) {
        if (once) n.removeEventListener(event.type, fn);
        try {
          if (typeof fn === 'function') fn.call(n, event); else fn.handleEvent(event);
        } catch (err) {
          (globalThis.__domErrors ||= []).push({ where: `${event.type} on ${n.tagName || n.nodeName}#${n.id || ''}`, err });
        }
      }
      const prop = `on${event.type}`;
      if (typeof n[prop] === 'function') { try { n[prop](event); } catch (err) { (globalThis.__domErrors ||= []).push({ where: prop, err }); } }
      if (event.propagationStopped || !event.bubbles) break;
    }
    return !event.defaultPrevented;
  }
}

export class MiniText extends MiniNode {
  constructor(data) { super(); this.data = data; this.nodeType = 3; this.nodeName = '#text'; }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  get nodeValue() { return this.data; }
}

const VOID = new Set(['meta', 'link', 'input', 'br', 'img', 'hr', 'source', 'area', 'base', 'col', 'embed', 'track', 'wbr']);
const BOOL_PROPS = ['hidden', 'disabled', 'checked', 'required', 'inert', 'open', 'selected', 'multiple', 'readOnly', 'autofocus'];

class StyleDecl {
  setProperty(k, v) { this[k] = v; }
  removeProperty(k) { delete this[k]; }
  getPropertyValue(k) { return this[k] ?? ''; }
  get cssText() { return Object.entries(this).filter(([k]) => !k.startsWith('__')).map(([k, v]) => `${k}:${v}`).join(';'); }
  set cssText(v) { Object.keys(this).forEach((k) => delete this[k]); if (v) v.split(';').forEach((p) => { const [k, val] = p.split(':'); if (k && val) this[k.trim()] = val.trim(); }); }
}

export class MiniElement extends MiniNode {
  constructor(tagName, doc) {
    super();
    this.tagName = tagName.toUpperCase();
    this.nodeName = this.tagName;
    this.nodeType = 1;
    this.ownerDocument = doc;
    this.attributes = new Map();
    this.style = new StyleDecl();
    this._value = undefined;
    this._checked = undefined;
    this.files = [];
    this.scrollTop = 0; this.scrollHeight = 100; this.clientHeight = 100; this.clientWidth = 100;
    this.offsetWidth = 100; this.offsetHeight = 100; this.width = 300; this.height = 150;
    const self = this;
    this.classList = {
      add: (...c) => { const s = self._classSet(); c.forEach((x) => x && s.add(x)); self._setClassSet(s); },
      remove: (...c) => { const s = self._classSet(); c.forEach((x) => s.delete(x)); self._setClassSet(s); },
      toggle: (c, force) => { const s = self._classSet(); const on = force === undefined ? !s.has(c) : Boolean(force); if (on) s.add(c); else s.delete(c); self._setClassSet(s); return on; },
      contains: (c) => self._classSet().has(c),
      [Symbol.iterator]: function* () { yield* self._classSet(); },
      get length() { return self._classSet().size; },
    };
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === 'string' ? self.getAttribute(`data-${camelToKebab(k)}`) ?? undefined : undefined),
      set: (_, k, v) => { self.setAttribute(`data-${camelToKebab(k)}`, String(v)); return true; },
      has: (_, k) => self.hasAttribute(`data-${camelToKebab(k)}`),
      deleteProperty: (_, k) => { self.removeAttribute(`data-${camelToKebab(k)}`); return true; },
      ownKeys: () => Array.from(self.attributes.keys()).filter((k) => k.startsWith('data-')).map((k) => kebabToCamel(k.slice(5))),
      getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    });
  }
  _classSet() { return new Set((this.getAttribute('class') || '').split(/\s+/).filter(Boolean)); }
  _setClassSet(s) { this.setAttribute('class', Array.from(s).join(' ')); }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', v); }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }
  get name() { return this.getAttribute('name') || ''; }
  get type() { return this.getAttribute('type') || (this.tagName === 'BUTTON' ? 'submit' : 'text'); }
  get href() { return this.getAttribute('href') || ''; }
  set href(v) { this.setAttribute('href', v); }
  get src() { return this.getAttribute('src') || ''; }
  set src(v) { this.setAttribute('src', v); }
  get lang() { return this.getAttribute('lang') || ''; }
  set lang(v) { this.setAttribute('lang', v); }
  get title() { return this.getAttribute('title') || ''; }
  set title(v) { this.setAttribute('title', v); }
  get placeholder() { return this.getAttribute('placeholder') || ''; }
  set placeholder(v) { this.setAttribute('placeholder', v); }
  get tabIndex() { return Number(this.getAttribute('tabindex') || -1); }
  set tabIndex(v) { this.setAttribute('tabindex', String(v)); }
  get isContentEditable() { return this.getAttribute('contenteditable') === 'true'; }
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.tagName === 'SELECT') { const opt = this.querySelectorAll('option').find((o) => o.hasAttribute('selected')) || this.querySelector('option'); return opt ? (opt.getAttribute('value') ?? opt.textContent) : ''; }
    return this.getAttribute('value') ?? '';
  }
  set value(v) { this._value = String(v); }
  get checked() { return this._checked !== undefined ? this._checked : this.hasAttribute('checked'); }
  set checked(v) { this._checked = Boolean(v); }
  get selectedOptions() { const v = this.value; return this.querySelectorAll('option').filter((o) => (o.getAttribute('value') ?? o.textContent) === v); }
  get options() { return this.querySelectorAll('option'); }
  get form() { return this.closest('form'); }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(''); }
  set textContent(v) { this.replaceChildren(); if (v !== '' && v !== null && v !== undefined) this.appendChild(new MiniText(String(v))); }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  get innerHTML() { return this.childNodes.map(serialize).join(''); }
  set innerHTML(v) { this.replaceChildren(); parseInto(String(v), this, this.ownerDocument); }
  get outerHTML() { return serialize(this); }
  getAttribute(k) { return this.attributes.has(k) ? this.attributes.get(k) : null; }
  setAttribute(k, v) { this.attributes.set(k, String(v)); }
  hasAttribute(k) { return this.attributes.has(k); }
  removeAttribute(k) { this.attributes.delete(k); }
  toggleAttribute(k, force) { const on = force ?? !this.hasAttribute(k); if (on) this.setAttribute(k, ''); else this.removeAttribute(k); return on; }
  getAttributeNames() { return Array.from(this.attributes.keys()); }
  matches(sel) { return matchesSelector(this, sel); }
  closest(sel) { let n = this; while (n && n.nodeType === 1) { if (matchesSelector(n, sel)) return n; n = n.parentNode; } return null; }
  querySelector(sel) { return query(this, sel, true); }
  querySelectorAll(sel) { return query(this, sel, false); }
  getElementsByTagName(tag) { return this.querySelectorAll(tag); }
  getBoundingClientRect() { return { left: 0, top: 0, right: 800, bottom: 500, width: 800, height: 500, x: 0, y: 0 }; }
  getClientRects() { return [this.getBoundingClientRect()]; }
  click() { this.dispatchEvent(new MiniMouseEvent('click', { bubbles: true })); }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  select() {}
  scrollIntoView() {}
  scrollTo() {}
  scroll() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  requestFullscreen() { return Promise.resolve(); }
  requestSubmit() { this.dispatchEvent(new MiniEvent('submit')); }
  reset() {}
  checkValidity() { return true; }
  reportValidity() { return true; }
  setCustomValidity() {}
  animate(keyframes, opts) {
    const anim = { playState: 'running', currentTime: 0, playbackRate: 1, cancel() { this.playState = 'idle'; }, pause() { this.playState = 'paused'; }, play() { this.playState = 'running'; }, finish() { this.playState = 'finished'; }, reverse() {}, effect: { updateTiming() {}, getTiming() { return opts || {}; } }, onfinish: null };
    anim.finished = new Promise((resolve) => setTimeout(() => { if (anim.playState !== 'idle') { anim.playState = 'finished'; anim.onfinish?.(); } resolve(anim); }, Math.min(50, Number((opts && (opts.duration || opts)) || 0))));
    (globalThis.__animations ||= []).push({ el: this, keyframes, opts });
    return anim;
  }
  getAnimations() { return []; }
  getContext(kind) {
    if (this.tagName !== 'CANVAS') return null;
    if (kind === 'webgl' || kind === 'webgl2') return null;
    const calls = (this.__ctxCalls ||= []);
    return new Proxy({ canvas: this }, { get: (t, k) => (k in t ? t[k] : (k === 'measureText' ? () => ({ width: 10 }) : k === 'getImageData' ? () => ({ data: new Uint8ClampedArray(4) }) : k === 'createLinearGradient' || k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : (...a) => { calls.push(k); return undefined; })), set: () => true });
  }
  toDataURL() { return 'data:image/png;base64,'; }
  play() { return Promise.resolve(); }
  pause() {}
  load() {}
}
for (const prop of BOOL_PROPS) {
  Object.defineProperty(MiniElement.prototype, prop, {
    get() { return this.hasAttribute(prop.toLowerCase()); },
    set(v) { if (v) this.setAttribute(prop.toLowerCase(), ''); else this.removeAttribute(prop.toLowerCase()); },
  });
}

function camelToKebab(s) { return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`); }
function kebabToCamel(s) { return s.replace(/-([a-z])/g, (_, c) => c.toUpperCase()); }

function serialize(node) {
  if (node instanceof MiniText) return node.data;
  const attrs = Array.from(node.attributes).map(([k, v]) => ` ${k}="${v}"`).join('');
  const tag = node.tagName.toLowerCase();
  if (VOID.has(tag)) return `<${tag}${attrs}>`;
  return `<${tag}${attrs}>${node.childNodes.map(serialize).join('')}</${tag}>`;
}

// --- HTML-парсер ------------------------------------------------------------
export function parseInto(html, root, doc) {
  const stack = [root];
  let i = 0;
  const RAW = new Set(['script', 'style']);
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) { addText(html.slice(i)); break; }
    if (lt > i) addText(html.slice(i, lt));
    if (html.startsWith('<!--', lt)) { const end = html.indexOf('-->', lt); i = end === -1 ? html.length : end + 3; continue; }
    if (html.startsWith('<!', lt)) { const end = html.indexOf('>', lt); i = end + 1; continue; }
    const gt = findTagEnd(html, lt);
    const raw = html.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim().toLowerCase();
      for (let s = stack.length - 1; s > 0; s -= 1) { if (stack[s].tagName.toLowerCase() === name) { stack.length = s; break; } }
      continue;
    }
    const selfClose = raw.endsWith('/');
    const body = selfClose ? raw.slice(0, -1) : raw;
    const m = body.match(/^([a-zA-Z][\w-]*)/);
    if (!m) continue;
    const tag = m[1].toLowerCase();
    const elNode = new MiniElement(tag, doc);
    const attrRe = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    const rest = body.slice(m[0].length);
    let a;
    while ((a = attrRe.exec(rest))) elNode.attributes.set(a[1], a[2] ?? a[3] ?? a[4] ?? '');
    stack[stack.length - 1].appendChild(elNode);
    if (RAW.has(tag)) {
      const close = html.indexOf(`</${tag}`, i);
      const text = html.slice(i, close === -1 ? html.length : close);
      if (text) elNode.appendChild(new MiniText(text));
      i = close === -1 ? html.length : html.indexOf('>', close) + 1;
      continue;
    }
    if (!selfClose && !VOID.has(tag)) stack.push(elNode);
  }
  function addText(t) {
    if (!t) return;
    const parent = stack[stack.length - 1];
    parent.appendChild(new MiniText(decodeEntities(t)));
  }
}
function findTagEnd(html, from) {
  let q = null;
  for (let i = from + 1; i < html.length; i += 1) {
    const c = html[i];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; continue; }
    if (c === '>') return i;
  }
  return html.length;
}
function decodeEntities(s) {
  return s.replace(/&(amp|lt|gt|quot|#39|nbsp|mdash|ndash|hellip|laquo|raquo);/g, (m, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'", nbsp: '\u00a0', mdash: '—', ndash: '–', hellip: '…', laquo: '«', raquo: '»' }[e]));
}

// --- Селекторы ----------------------------------------------------------------
function splitTop(s, sep) {
  const out = []; let depth = 0; let q = null; let cur = '';
  for (const c of s) {
    if (q) { cur += c; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === '(' || c === '[') depth += 1;
    if (c === ')' || c === ']') depth -= 1;
    if (c === sep && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}
function parseCompound(s) {
  const parts = { tag: null, id: null, classes: [], attrs: [], nots: [], pseudos: [] };
  const re = /([a-zA-Z][\w-]*|\*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~|^$*]?=)"?([^"\]]*)"?)?\]|:not\(([^)]*)\)|:([\w-]+)(?:\(([^)]*)\))?/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) parts.tag = m[1] === '*' ? null : m[1].toUpperCase();
    else if (m[2]) parts.id = m[2];
    else if (m[3]) parts.classes.push(m[3]);
    else if (m[4]) parts.attrs.push({ name: m[4], op: m[5], value: m[6] });
    else if (m[7] !== undefined) parts.nots.push(parseCompound(m[7]));
    else if (m[8]) parts.pseudos.push({ name: m[8], arg: m[9] });
  }
  return parts;
}
function matchCompound(el, c) {
  if (c.tag && el.tagName !== c.tag) return false;
  if (c.id && el.id !== c.id) return false;
  if (c.classes.length) { const s = el._classSet(); if (!c.classes.every((x) => s.has(x))) return false; }
  for (const a of c.attrs) {
    if (!el.hasAttribute(a.name)) return false;
    const v = el.getAttribute(a.name);
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '^=' && !v.startsWith(a.value)) return false;
    if (a.op === '$=' && !v.endsWith(a.value)) return false;
    if (a.op === '*=' && !v.includes(a.value)) return false;
    if (a.op === '~=' && !v.split(/\s+/).includes(a.value)) return false;
  }
  for (const n of c.nots) if (matchCompound(el, n)) return false;
  for (const p of c.pseudos) {
    if (p.name === 'first-child' && el.parentNode?.children[0] !== el) return false;
    if (p.name === 'last-child') { const ch = el.parentNode?.children || []; if (ch[ch.length - 1] !== el) return false; }
    if (p.name === 'empty' && el.childNodes.length) return false;
    if (p.name === 'checked' && !el.checked) return false;
    if (p.name === 'disabled' && !el.disabled) return false;
    if (p.name === 'focus' && el.ownerDocument.activeElement !== el) return false;
  }
  return true;
}
function parseComplex(sel) {
  const tokens = sel.replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
  const seq = [];
  let comb = ' ';
  for (const tk of tokens) {
    if (tk === '>') { comb = '>'; continue; }
    seq.push({ comp: parseCompound(tk), comb });
    comb = ' ';
  }
  return seq;
}
function matchComplex(el, seq) {
  let idx = seq.length - 1;
  if (!matchCompound(el, seq[idx].comp)) return false;
  let node = el;
  idx -= 1;
  while (idx >= 0) {
    const { comp } = seq[idx];
    const comb = seq[idx + 1].comb;
    if (comb === '>') {
      node = node.parentNode;
      if (!node || node.nodeType !== 1 || !matchCompound(node, comp)) return false;
    } else {
      node = node.parentNode;
      while (node && node.nodeType === 1 && !matchCompound(node, comp)) node = node.parentNode;
      if (!node || node.nodeType !== 1) return false;
    }
    idx -= 1;
  }
  return true;
}
const selCache = new Map();
function compile(sel) {
  if (!selCache.has(sel)) selCache.set(sel, splitTop(sel, ',').map(parseComplex));
  return selCache.get(sel);
}
export function matchesSelector(el, sel) {
  return compile(sel).some((seq) => matchComplex(el, seq));
}
function query(root, sel, first) {
  const compiled = compile(sel);
  const out = [];
  const walk = (n) => {
    for (const c of n.childNodes) {
      if (c.nodeType === 1) {
        if (compiled.some((seq) => matchComplex(c, seq))) { out.push(c); if (first) return true; }
        if (walk(c)) return true;
      }
    }
    return false;
  };
  walk(root);
  return first ? (out[0] ?? null) : out;
}

// --- Документ и окно ------------------------------------------------------------
export class MiniDocument extends MiniNode {
  constructor(html) {
    super();
    this.nodeType = 9;
    this.nodeName = '#document';
    this.ownerDocument = this;
    this.readyState = 'complete';
    this.hidden = false;
    this.visibilityState = 'visible';
    this.fullscreenElement = null;
    this.styleSheets = [];
    this.title = '';
    this.cookie = '';
    parseInto(html, this, this);
    this.documentElement = this.querySelector('html');
    this.head = this.querySelector('head');
    this.body = this.querySelector('body');
    this.activeElement = this.body;
  }
  createElement(tag) { return new MiniElement(tag, this); }
  createElementNS(ns, tag) { return new MiniElement(tag, this); }
  createTextNode(t) { return new MiniText(String(t)); }
  createDocumentFragment() { return new MiniElement('#fragment', this); }
  getElementById(id) { return this.querySelector(`#${id}`); }
  querySelector(sel) { return query(this, sel, true); }
  querySelectorAll(sel) { return query(this, sel, false); }
  exitFullscreen() { this.fullscreenElement = null; return Promise.resolve(); }
  hasFocus() { return true; }
  execCommand() { return true; }
}

class Storage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i) { return Array.from(this.map.keys())[i] ?? null; }
  get length() { return this.map.size; }
}

export function installGlobals(html, { origin = 'http://localhost:8080', path = '/' } = {}) {
  const document = new MiniDocument(html);
  const win = new MiniNode();
  win.nodeName = '#window';
  document.defaultView = win;
  const location = new URL(origin + path);
  Object.assign(win, {
    document, window: win, self: win, location, innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1, scrollX: 0, scrollY: 0,
    localStorage: new Storage(), sessionStorage: new Storage(),
    requestAnimationFrame: (fn) => setTimeout(() => fn(performance.now()), 16),
    cancelAnimationFrame: (id) => clearTimeout(id),
    requestIdleCallback: (fn) => setTimeout(fn, 1),
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {} }),
    getComputedStyle: (el) => ({ getPropertyValue: (k) => el.style[k] || (k === '--accent' ? '#22d3ee' : ''), ...el.style }),
    scrollTo() {}, scroll() {}, alert() {}, confirm: () => true, prompt: () => null, open: () => null, focus() {}, close() {},
    history: { pushState() {}, replaceState() {}, back() {} },
    screen: { width: 1280, height: 800, orientation: { type: 'landscape-primary', addEventListener() {} } },
    navigator: {
      userAgent: 'MiniDOM/1.0 Node', language: 'ru-RU', languages: ['ru-RU', 'en'], onLine: true, platform: 'Linux', maxTouchPoints: 0,
      clipboard: { writeText: async () => {} }, vibrate: () => true, sendBeacon: () => true,
    },
    KeyboardEvent: MiniKeyboardEvent, MouseEvent: MiniMouseEvent, PointerEvent: MiniMouseEvent, TouchEvent: MiniEvent,
    Node: MiniNode, Element: MiniElement, HTMLElement: MiniElement, HTMLCanvasElement: MiniElement, HTMLInputElement: MiniElement, Text: MiniText, Document: MiniDocument,
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    IntersectionObserver: class { observe() {} unobserve() {} disconnect() {} },
    MutationObserver: class { observe() {} disconnect() {} takeRecords() { return []; } },
    Image: class extends MiniElement { constructor() { super('img', document); } },
    FileReader: class { readAsDataURL() { setTimeout(() => this.onload?.({ target: { result: 'data:,x' } }), 1); } },
    Audio: class { play() { return Promise.resolve(); } pause() {} },
  });
  win.top = win; win.parent = win;
  const origFetch = globalThis.fetch;
  win.fetch = (url, opts) => origFetch(new URL(String(url), location.href).href, opts);
  win.EventSource = undefined;
  for (const key of Object.keys(win)) {
    if (['childNodes', 'parentNode', 'listeners', 'ownerDocument', 'nodeName'].includes(key)) continue;
    try { Object.defineProperty(globalThis, key, { value: win[key], configurable: true, writable: true }); } catch { /* ignore */ }
  }
  globalThis.addEventListener = win.addEventListener.bind(win);
  globalThis.removeEventListener = win.removeEventListener.bind(win);
  globalThis.dispatchEvent = win.dispatchEvent.bind(win);
  return { window: win, document };
}
