// Змейка: игровая логика без DOM (её можно проверять тестами) + отрисовка.
// Управление — стрелки, WASD или кнопки на экране; игра локальная, счёт в localStorage.
import { $, el } from '../core/dom.js';
import { t } from '../core/i18n.js';

export const DIRS = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

/** Новое состояние игры. Змейка стартует в середине и ползёт вправо. */
export function createGame(cols = 22, rows = 16, seed = Math.random) {
  const state = {
    cols,
    rows,
    snake: [{ x: Math.floor(cols / 2), y: Math.floor(rows / 2) }],
    dir: { ...DIRS.right },
    queue: [],
    food: { x: 0, y: 0 },
    score: 0,
    best: 0,
    alive: true,
    paused: false,
    steps: 0,
    rand: typeof seed === 'function' ? seed : Math.random,
  };
  placeFood(state);
  return state;
}

/** Случайная свободная клетка для еды. Возвращает false, если свободных нет. */
export function placeFood(state) {
  const free = [];
  for (let y = 0; y < state.rows; y++) {
    for (let x = 0; x < state.cols; x++) {
      if (!state.snake.some((part) => part.x === x && part.y === y)) free.push({ x, y });
    }
  }
  if (!free.length) {
    state.food = { x: -1, y: -1 };
    state.alive = false;
    state.won = true;
    return false;
  }
  const pick = free[Math.floor(state.rand() * free.length)];
  state.food = pick;
  return true;
}

/** Поворот: нельзя развернуться на 180° за один шаг. */
export function turn(state, dirName) {
  const dir = DIRS[dirName];
  if (!dir || !state.alive) return false;
  const last = state.queue.length ? state.queue[state.queue.length - 1] : state.dir;
  if (last.x === -dir.x && last.y === -dir.y) return false;      // разворот запрещён
  if (last.x === dir.x && last.y === dir.y) return false;        // уже едем туда
  if (state.queue.length < 3) state.queue.push(dir);
  return true;
}

/**
 * Один шаг игры. Возвращает { ate, died } — что произошло на этом шаге.
 */
export function step(state) {
  if (!state.alive || state.paused) return { ate: false, died: false };
  if (state.queue.length) state.dir = state.queue.shift();
  const head = state.snake[0];
  const next = { x: head.x + state.dir.x, y: head.y + state.dir.y };
  // стены
  if (next.x < 0 || next.y < 0 || next.x >= state.cols || next.y >= state.rows) {
    state.alive = false;
    state.steps++;
    return { ate: false, died: true };
  }
  const willEat = next.x === state.food.x && next.y === state.food.y;
  const body = willEat ? state.snake : state.snake.slice(0, -1);
  if (body.some((part) => part.x === next.x && part.y === next.y)) {
    state.alive = false;
    state.steps++;
    return { ate: false, died: true };
  }
  state.snake = [next, ...body];
  state.steps++;
  if (willEat) {
    state.score += 1;
    if (state.score > state.best) state.best = state.score;
    if (!placeFood(state)) return { ate: true, died: false, won: true };
    return { ate: true, died: false };
  }
  return { ate: false, died: false };
}

// --- отрисовка ----------------------------------------------------------------------

let raf = 0;
let timer = 0;
let state = null;
let canvas = null;
let ctx = null;
let speed = 130;
let scoreNode = null;
let keyHandler = null;
let onExitCb = null;

/** Показывает игру внутри узла host. Возвращает функцию остановки. */
export function mount(host, { onExit } = {}) {
  stop();
  onExitCb = onExit || null;
  state = createGame();
  try { state.best = Number(localStorage.getItem('mp2:snakeBest') || 0) || 0; } catch { state.best = 0; }

  host.textContent = '';
  scoreNode = el('p', { class: 'snake-score', text: scoreText() });
  canvas = el('canvas', { class: 'snake-canvas', width: String(state.cols * 18), height: String(state.rows * 18) });
  const pad = el('div', { class: 'snake-pad' }, [
    el('button', { type: 'button', class: 'secondary', text: '↑', onClick: () => turn(state, 'up') }),
    el('div', { class: 'snake-pad-row' }, [
      el('button', { type: 'button', class: 'secondary', text: '←', onClick: () => turn(state, 'left') }),
      el('button', { type: 'button', class: 'secondary', text: '↓', onClick: () => turn(state, 'down') }),
      el('button', { type: 'button', class: 'secondary', text: '→', onClick: () => turn(state, 'right') }),
    ]),
  ]);
  const controls = el('div', { class: 'btn-row' }, [
    el('button', { type: 'button', class: 'secondary', id: 'snakePauseBtn', text: t('snake.pause'), onClick: togglePause }),
    el('button', { type: 'button', class: 'secondary', text: t('snake.restart'), onClick: restart }),
    el('button', { type: 'button', class: 'secondary', text: t('games.close'), onClick: () => stop() }),
  ]);
  host.append(scoreNode, canvas, pad, controls);
  ctx = canvas.getContext('2d');
  draw();

  keyHandler = (e) => {
    const map = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right' };
    const dir = map[e.key] || map[e.key?.toLowerCase?.()];
    if (!dir) return;
    e.preventDefault();
    turn(state, dir);
  };
  window.addEventListener('keydown', keyHandler);
  timer = setInterval(tick, speed);
  return stop;
}

export function stop() {
  const cb = onExitCb;
  onExitCb = null;
  cb?.();
  cancelAnimationFrame(raf);
  clearInterval(timer);
  timer = 0;
  if (keyHandler) window.removeEventListener('keydown', keyHandler);
  keyHandler = null;
  canvas = null;
  ctx = null;
  scoreNode = null;
  state = null;
}

function restart() {
  if (!state) return;
  const best = state.best;
  state = createGame();
  state.best = best;
  speed = 130;
  clearInterval(timer);
  timer = setInterval(tick, speed);
  draw();
  updateScore();
}

function togglePause() {
  if (!state) return;
  state.paused = !state.paused;
  const btn = $('#snakePauseBtn');
  if (btn) btn.textContent = state.paused ? t('snake.play') : t('snake.pause');
  draw();
}

function tick() {
  if (!state) return;
  const res = step(state);
  if (res.ate) {
    speed = Math.max(60, speed - 3);
    clearInterval(timer);
    timer = setInterval(tick, speed);
  }
  updateScore();
  draw();
  if (!state.alive) {
    clearInterval(timer);
    timer = 0;
    try { localStorage.setItem('mp2:snakeBest', String(state.best)); } catch { /* ignore */ }
    draw();
  }
}

function scoreText() {
  if (!state) return '';
  return `${t('snake.score', { n: state.score })} · ${t('snake.best', { n: state.best })}`
    + (state.alive ? '' : ` · ${t('snake.gameover')}`);
}

function updateScore() {
  if (scoreNode) scoreNode.textContent = scoreText();
}

function draw() {
  if (!ctx || !state) return;
  const cellPx = 18;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#0b1020';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // сетка
  ctx.strokeStyle = 'rgba(148,163,184,.12)';
  for (let x = 0; x <= state.cols; x++) {
    ctx.beginPath();
    ctx.moveTo(x * cellPx, 0);
    ctx.lineTo(x * cellPx, state.rows * cellPx);
    ctx.stroke();
  }
  for (let y = 0; y <= state.rows; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * cellPx);
    ctx.lineTo(state.cols * cellPx, y * cellPx);
    ctx.stroke();
  }
  // еда
  if (state.food.x >= 0) {
    ctx.fillStyle = '#f87171';
    ctx.beginPath();
    ctx.arc(state.food.x * cellPx + cellPx / 2, state.food.y * cellPx + cellPx / 2, cellPx / 2 - 2, 0, Math.PI * 2);
    ctx.fill();
  }
  // змейка
  state.snake.forEach((part, i) => {
    const shade = Math.max(0.45, 1 - i / (state.snake.length + 4));
    ctx.fillStyle = i === 0 ? '#34d399' : `rgba(52,211,153,${shade.toFixed(2)})`;
    ctx.fillRect(part.x * cellPx + 1, part.y * cellPx + 1, cellPx - 2, cellPx - 2);
  });
  if (!state.alive || state.paused) {
    ctx.fillStyle = 'rgba(2,6,23,.6)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e2e8f0';
    ctx.font = '600 20px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(state.paused ? t('snake.paused') : t('snake.gameover'), canvas.width / 2, canvas.height / 2);
    ctx.font = '14px system-ui, sans-serif';
    ctx.fillText(t('snake.restartHint'), canvas.width / 2, canvas.height / 2 + 26);
  }
}
