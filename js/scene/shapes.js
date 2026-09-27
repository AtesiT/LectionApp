// Геометрия 2D-фигур. Все фигуры описываются полигоном с одинаковым числом
// вершин, поэтому браузер умеет плавно интерполировать clip-path между ними
// (это используется анимацией «Морфинг»).
export const SHAPES = ['circle', 'square', 'triangle', 'star', 'heart', 'hexagon', 'ring', 'emoji', 'text', 'image'];
export const POLYGON_SHAPES = ['circle', 'square', 'triangle', 'star', 'heart', 'hexagon', 'ring'];
export const SHAPE_ICONS = {
  circle: '●', square: '■', triangle: '▲', star: '★', heart: '♥', hexagon: '⬢', ring: '◎', emoji: '🙂', text: 'Aa', image: '🖼',
};

const POINTS = 72;

/** Прямоугольник со скруглёнными углами (radius в % от половины стороны). */
function roundedSquare(radius) {
  const r = Math.max(0, Math.min(50, radius));
  if (r < 0.5) return [[0, 0], [100, 0], [100, 100], [0, 100]];
  const pts = [];
  const corners = [[100 - r, r, -Math.PI / 2], [100 - r, 100 - r, 0], [r, 100 - r, Math.PI / 2], [r, r, Math.PI]];
  for (const [cx, cy, start] of corners) {
    for (let i = 0; i <= 6; i++) {
      const a = start + (i / 6) * (Math.PI / 2);
      pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    }
  }
  return pts;
}

/** Базовые вершины (в процентах, 0..100) для многоугольников. */
function baseVertices(shape, radius = 0) {
  switch (shape) {
    case 'square':
      return roundedSquare(radius);
    case 'triangle':
      return [[50, 2], [98, 96], [2, 96]];
    case 'hexagon':
      return Array.from({ length: 6 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 3;
        return [50 + 48 * Math.cos(a), 50 + 48 * Math.sin(a)];
      });
    case 'star':
      return Array.from({ length: 10 }, (_, i) => {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 === 0 ? 49 : 21;
        return [50 + r * Math.cos(a), 50 + r * Math.sin(a)];
      });
    default:
      return null;
  }
}

/** Равномерная выборка N точек вдоль периметра многоугольника. */
function samplePerimeter(vertices, n) {
  const segs = [];
  let total = 0;
  for (let i = 0; i < vertices.length; i++) {
    const a = vertices[i];
    const b = vertices[(i + 1) % vertices.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    segs.push({ a, b, len });
    total += len;
  }
  const out = [];
  let segIdx = 0;
  let segStart = 0;
  for (let k = 0; k < n; k++) {
    const d = (k / n) * total;
    while (segIdx < segs.length - 1 && d > segStart + segs[segIdx].len) {
      segStart += segs[segIdx].len;
      segIdx++;
    }
    const s = segs[segIdx];
    const tt = s.len ? (d - segStart) / s.len : 0;
    out.push([s.a[0] + (s.b[0] - s.a[0]) * tt, s.a[1] + (s.b[1] - s.a[1]) * tt]);
  }
  return out;
}

function circlePoints(n, cx = 50, cy = 50, r = 50, start = -Math.PI / 2, reverse = false) {
  return Array.from({ length: n }, (_, i) => {
    const a = start + (reverse ? -1 : 1) * (i / n) * Math.PI * 2;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });
}

function heartPoints(n) {
  const raw = [];
  for (let i = 0; i < n; i++) {
    const tt = (i / n) * Math.PI * 2;
    const x = 16 * Math.sin(tt) ** 3;
    const y = 13 * Math.cos(tt) - 5 * Math.cos(2 * tt) - 2 * Math.cos(3 * tt) - Math.cos(4 * tt);
    raw.push([x, -y]);
  }
  const xs = raw.map((p) => p[0]);
  const ys = raw.map((p) => p[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs);
  const minY = Math.min(...ys); const maxY = Math.max(...ys);
  return raw.map(([x, y]) => [((x - minX) / (maxX - minX)) * 96 + 2, ((y - minY) / (maxY - minY)) * 96 + 2]);
}

const cache = new Map();

/** Возвращает массив точек фигуры [[x%, y%], ...] длиной POINTS. */
export function shapePoints(shape, radius = 0) {
  const cacheKey = shape === 'square' ? `square:${Math.round(radius)}` : shape;
  if (cache.has(cacheKey)) return cache.get(cacheKey);
  let pts;
  if (shape === 'circle') pts = circlePoints(POINTS);
  else if (shape === 'heart') pts = heartPoints(POINTS);
  else if (shape === 'ring') {
    // Внешний контур, возврат в начало, внутренний контур и возврат — «швы»
    // совпадают, а правило evenodd делает из внутреннего контура отверстие.
    const outer = circlePoints(36, 50, 50, 50);
    const inner = circlePoints(34, 50, 50, 28, -Math.PI / 2, true);
    pts = [...outer, outer[0], inner[0], ...inner.slice(1), inner[0]];
  } else {
    const base = baseVertices(shape, radius) ?? baseVertices('square', radius);
    pts = samplePerimeter(base, POINTS);
  }
  cache.set(cacheKey, pts);
  return pts;
}

/** Строка clip-path для фигуры. */
export function clipPathFor(shape, radius = 0) {
  if (!POLYGON_SHAPES.includes(shape)) return 'none';
  const pts = shapePoints(shape, radius).map(([x, y]) => `${x.toFixed(2)}% ${y.toFixed(2)}%`).join(', ');
  return `polygon(evenodd, ${pts})`;
}

export function isPolygonShape(shape) {
  return POLYGON_SHAPES.includes(shape);
}
