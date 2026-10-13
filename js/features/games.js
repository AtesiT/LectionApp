// Мини-игры: шахматы и крестики-нолики играются вдвоём через сервер комнаты,
// змейка и «камень-ножницы-бумага» — локально (без сервера).
//
// Состояние партий приходит с сервера (snapshot.games / type:"games"),
// поэтому доска у всех участников одинаковая и переживает перезапуск сервера.
import { $, el } from '../core/dom.js';
import { on } from '../core/bus.js';
import { t } from '../core/i18n.js';
import * as transport from '../net/transport.js';
import { session } from '../net/session.js';
import { toast } from '../ui/toast.js';
import * as snake from './snake.js';

const PIECES = {
  wK: '♔', wQ: '♕', wR: '♖', wB: '♗', wN: '♘', wP: '♙',
  bK: '♚', bQ: '♛', bR: '♜', bB: '♝', bN: '♞', bP: '♟',
};
const FILES = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const RPS = ['rock', 'scissors', 'paper'];
const RPS_ICON = { rock: '✊', scissors: '✌', paper: '✋' };
const RPS_BEATS = { rock: 'scissors', scissors: 'paper', paper: 'rock' };

let games = [];
let selected = null;          // выбранная клетка шахмат: { gameId, square }
let local = null;             // 'snake' | 'rps' | null
let unmountLocal = null;
let rpsScore = { me: 0, bot: 0 };

export function init() {
  $('#gameChessBtn')?.addEventListener('click', () => createGame('chess'));
  $('#gameTttBtn')?.addEventListener('click', () => createGame('tictactoe'));
  $('#gameSnakeBtn')?.addEventListener('click', () => openLocal('snake'));
  $('#gameRpsBtn')?.addEventListener('click', () => openLocal('rps'));
  on('session:games', setGames);
  on('session:left', () => setGames([]));
  on('lang', render);
  render();
}

export function setGames(list) {
  games = Array.isArray(list) ? list : [];
  render();
}

export function getGames() {
  return games;
}

// --- команды на сервер ----------------------------------------------------------------

async function createGame(kind) {
  if (!session.connected) { toast(t('games.offlineHint'), { type: 'warn' }); return false; }
  const res = await transport.send({ kind: 'game_create', game: kind });
  if (res?.ok) { toast(t('games.created'), { icon: '🎮' }); return true; }
  if (res?.error === 'too_many_games') toast(t('games.full'), { type: 'warn' });
  return false;
}

async function joinGame(id) {
  const res = await transport.send({ kind: 'game_join', gameId: id });
  if (res?.ok) toast(t('games.joined'), { icon: '🤝' });
  else if (res?.error === 'full') toast(t('games.full'), { type: 'warn' });
}

async function leaveGame(id) {
  await transport.send({ kind: 'game_leave', gameId: id });
}

async function resetGame(id) {
  const res = await transport.send({ kind: 'game_reset', gameId: id });
  if (res?.ok) toast(t('games.restarted'), { icon: '🔄' });
}

async function sendMove(id, move) {
  const res = await transport.send({ kind: 'game_move', gameId: id, move });
  if (res?.ok) return true;
  if (res?.error === 'not_your_turn') toast(t('games.notYourTurn'), { type: 'warn' });
  else if (res?.error === 'waiting') toast(t('games.waiting'), { type: 'warn' });
  else if (res?.error === 'finished') toast(t('games.finished'), { type: 'warn' });
  else toast(t('games.error'), { type: 'warn' });
  return false;
}

// --- локальные игры --------------------------------------------------------------------

function openLocal(kind) {
  const card = $('#localGameCard');
  const body = $('#localGameBody');
  const title = $('#localGameTitle');
  if (!card || !body) return;
  if (local === kind && !card.hidden) { closeLocal(); return; }
  closeLocal();
  local = kind;
  card.hidden = false;
  body.textContent = '';
  if (kind === 'snake') {
    title.textContent = `🐍 ${t('snake.title')}`;
    unmountLocal = snake.mount(body, { onExit: () => { unmountLocal = null; } });
  } else {
    title.textContent = `✊ ${t('rps.title')}`;
    renderRps(body);
  }
  card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

export function closeLocal() {
  if (typeof unmountLocal === 'function') unmountLocal();
  unmountLocal = null;
  local = null;
  const card = $('#localGameCard');
  if (card) card.hidden = true;
  const body = $('#localGameBody');
  if (body) body.textContent = '';
}

function renderRps(host) {
  const out = el('p', { class: 'rps-result', text: t('rps.pick') });
  const score = el('p', { class: 'hint', text: t('rps.score', { a: rpsScore.me, b: rpsScore.bot }) });
  const row = el('div', { class: 'btn-row' }, RPS.map((pick) => el('button', {
    type: 'button',
    class: 'secondary rps-btn',
    text: `${RPS_ICON[pick]} ${t(`rps.${pick}`)}`,
    onClick: () => {
      const bot = RPS[Math.floor(Math.random() * RPS.length)];
      let text = t('rps.tie');
      if (RPS_BEATS[pick] === bot) { rpsScore.me++; text = t('rps.win'); }
      else if (RPS_BEATS[bot] === pick) { rpsScore.bot++; text = t('rps.lose'); }
      out.textContent = `${t('rps.you', { v: t(`rps.${pick}`) })} · ${t('rps.bot', { v: t(`rps.${bot}`) })} — ${text}`;
      score.textContent = t('rps.score', { a: rpsScore.me, b: rpsScore.bot });
    },
  })));
  host.append(out, row, score, el('div', { class: 'btn-row' }, [
    el('button', { type: 'button', class: 'secondary', text: t('games.close'), onClick: closeLocal }),
  ]));
}

// --- отрисовка списка игр ----------------------------------------------------------------

function render() {
  const host = $('#gamesList');
  if (!host) return;
  if (!games.length) {
    host.replaceChildren(el('p', { class: 'hint', text: t('games.empty') }));
    return;
  }
  host.replaceChildren(...games.map(gameCard));
}

function gameCard(game) {
  const myId = session.userId;
  const players = Array.isArray(game.players) ? game.players : [];
  const mine = players.find((p) => p.id === myId) || null;
  const mark = mine?.mark || null;
  const st = game.state || {};
  const card = el('div', { class: `game-card ${game.kind}` });

  const head = el('div', { class: 'game-head' }, [
    el('h4', { text: game.kind === 'chess' ? `♟ ${t('games.chess')}` : `⭕ ${t('games.ttt')}` }),
    el('span', { class: 'game-status', text: statusText(game, st, mine) }),
  ]);
  card.append(head);

  if (game.kind === 'chess') card.append(chessBoard(game, st, mark));
  else card.append(tttBoard(game, st, mark));

  const row = el('div', { class: 'btn-row' });
  if (!mine) {
    row.append(el('button', {
      type: 'button',
      class: 'secondary',
      text: players.length < 2 ? `🤝 ${t('games.join')}` : `👁 ${t('games.watch')}`,
      disabled: players.length >= 2,
      onClick: () => joinGame(game.id),
    }));
  } else {
    row.append(el('button', { type: 'button', class: 'secondary', text: `🔄 ${t('games.reset')}`, onClick: () => resetGame(game.id) }));
    row.append(el('button', { type: 'button', class: 'secondary', text: t('games.leave'), onClick: () => leaveGame(game.id) }));
  }
  if (st.history?.length) {
    card.append(el('p', { class: 'hint', text: `${t('games.moves')}: ${st.history.length}` }));
  }
  card.append(row);
  return card;
}

function statusText(game, st, mine) {
  if (game.kind === 'chess') {
    if (st.result === 'draw') return `🤝 ${t('games.draw')}`;
    if (st.result) {
      const winner = st.colors?.[st.result]?.name || '';
      return `🏆 ${t('games.win', { name: winner })}`;
    }
    if (st.check) return `⚠️ ${t('games.check')}`;
    const turnName = st.colors?.[st.turn]?.name || (st.turn === 'w' ? t('games.white') : t('games.black'));
    return `${t('games.turn', { name: mine && mine.mark === st.turn ? `${turnName} (${t('games.you')})` : turnName })}`;
  }
  if (st.winner === 'draw') return `🤝 ${t('games.draw')}`;
  if (st.winner) {
    const winner = st.colors?.[st.winner]?.name || '';
    return `🏆 ${t('games.win', { name: winner })}`;
  }
  if (game.waiting) return `⏳ ${t('games.waiting')}`;
  const turnName = st.colors?.[st.turn]?.name || '';
  return mine && mine.mark === st.turn
    ? `${t('games.turn', { name: `${turnName} (${t('games.you')})` })}`
    : t('games.turn', { name: turnName });
}

// --- шахматы -----------------------------------------------------------------------------

function chessBoard(game, st, mark) {
  const board = el('div', { class: 'chess-board', dataset: { gameId: game.id } });
  const legal = (st.legal && typeof st.legal === 'object') ? st.legal : {};
  const lastMove = st.history?.length ? st.history[st.history.length - 1] : null;
  const canMove = Boolean(mark) && st.turn === mark && !st.result;

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 8; col++) {
      const index = row * 8 + col;
      const piece = st.board?.[index] || null;
      const square = `${FILES[col]}${8 - row}`;
      const isLight = (row + col) % 2 === 0;
      const classes = ['chess-cell', isLight ? 'light' : 'dark'];
      if (selected?.gameId === game.id && selected.square === square) classes.push('selected');
      if (selected?.gameId === game.id && legal[selected.square]?.some((m) => m.slice(2, 4) === square)) classes.push('target');
      if (lastMove && (lastMove.slice(0, 2) === square || lastMove.slice(2, 4) === square)) classes.push('last');
      if (piece && piece[1] === 'K' && st.check && piece[0] === st.turn) classes.push('check');

      const cell = el('button', {
        type: 'button',
        class: classes.join(' '),
        dataset: { square },
        text: piece ? PIECES[piece] || '' : '',
      });
      cell.addEventListener('click', () => onChessClick(game, st, square, piece, canMove, legal));
      board.append(cell);
    }
  }
  return el('div', { class: 'chess-wrap' }, [board, el('div', { class: 'chess-files' }, FILES.map((f) => el('span', { text: f })))]);
}

function onChessClick(game, st, square, piece, canMove, legal) {
  if (!canMove) {
    if (!game.players?.some((p) => p.id === session.userId)) toast(t('games.watching'), { type: 'warn' });
    else toast(t('games.notYourTurn'), { type: 'warn' });
    return;
  }
  if (selected?.gameId === game.id && selected.square) {
    const from = selected.square;
    const moves = legal[from] || [];
    const promotion = piece && piece[1] === 'P' && square[1] === '8';
    const uci = `${from}${square}`;
    const variants = promotion ? [`${uci}q`, `${uci}r`, `${uci}b`, `${uci}n`] : [uci];
    const ok = variants.find((m) => moves.includes(m));
    if (ok) {
      selected = null;
      sendMove(game.id, ok);
      return;
    }
  }
  if (piece && piece[0] === st.turn) {
    selected = { gameId: game.id, square };
    render();
  } else {
    selected = null;
    render();
  }
}

// --- крестики-нолики --------------------------------------------------------------------------

function tttBoard(game, st, mark) {
  const board = el('div', { class: 'ttt-board' });
  const cells = Array.isArray(st.board) ? st.board : [null, null, null, null, null, null, null, null, null];
  cells.forEach((value, index) => {
    const inLine = Array.isArray(st.line) && st.line.includes(index);
    const cell = el('button', {
      type: 'button',
      class: `ttt-cell ${value ? 'filled' : ''} ${inLine ? 'win' : ''}`,
      dataset: { index: String(index) },
      text: value === 'x' ? '❌' : value === 'o' ? '⭕' : '',
    });
    cell.addEventListener('click', () => {
      if (!mark) { toast(t('games.watching'), { type: 'warn' }); return; }
      if (st.winner || cells[index]) return;
      if (mark !== st.turn) { toast(t('games.notYourTurn'), { type: 'warn' }); return; }
      sendMove(game.id, index);
    });
    board.append(cell);
  });
  return board;
}
