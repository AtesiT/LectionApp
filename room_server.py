#!/usr/bin/env python3
"""Motion Playground — статический сайт + сервер совместных комнат.

Только стандартная библиотека Python 3.10+:
  * статика (index.html, js/, styles.css, ...);
  * комнаты (код комнаты), участники, роли (ведущий/участник);
  * лента действий, чат, реакции, лайки, опросы, общая доска, курсоры;
  * транспорт: WebSocket (/ws) с запасным вариантом SSE (/api/events) + REST;
  * прокси к внешним API (цитаты, курсы валют) с кэшем и запасными данными.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
import queue
import random
import socket
import string
import struct
import atexit
import re
import shutil
import signal
import threading
import time
import urllib.parse
import urllib.request
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "8080"))

MAX_FEED = 200
MAX_CHAT = 200
MAX_STROKES = 600
MAX_STROKE_POINTS = 2500
MAX_POLLS = 20
MAX_JOURNAL = 800          # записей в журнале занятия
MAX_STATE_BYTES = 64_000

# --- Файлы и постоянство ---------------------------------------------------
DATA_DIR = os.path.join(ROOT, "data")
UPLOAD_DIR = os.path.join(ROOT, "uploads")
PERSIST_FILE = os.path.join(DATA_DIR, "rooms.json")
MAX_UPLOAD_BYTES = 25 * 1024 * 1024      # один файл
MAX_UPLOAD_TOTAL = 300 * 1024 * 1024     # всё хранилище
UPLOAD_TYPES = {
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif",
    ".webp": "image/webp", ".bmp": "image/bmp", ".ico": "image/x-icon",
    ".mp4": "video/mp4", ".webm": "video/webm", ".ogg": "audio/ogg", ".ogv": "video/ogg",
    ".mov": "video/quicktime", ".m4v": "video/mp4", ".mp3": "audio/mpeg", ".wav": "audio/wav",
}
PERSIST_INTERVAL = 15.0
for _dir in (DATA_DIR, UPLOAD_DIR):
    try:
        os.makedirs(_dir, exist_ok=True)
    except OSError:
        pass
USER_TTL = 90           # секунд без ping → участник считается отключившимся
ROOM_TTL = 60 * 60 * 6  # пустая комната удаляется через 6 часов
WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"

DEFAULT_STATE = {
    "theme": "neon",
    "speed": 1,
    "playing": True,
    "use3d": False,
    "shape3d": "cube",
    "modelRotX": -18,
    "modelRotY": 28,
    "modelZoom": 1,
    "objects": [],
    "background": {"type": "preset", "value": "auto"},
    "effect": "none",
    "physics": False,
}

USER_COLORS = [
    "#22d3ee", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#60a5fa",
    "#fb7185", "#f97316", "#84cc16", "#e879f9", "#2dd4bf", "#facc15",
]

FALLBACK_QUOTES = {
    "ru": [
        {"text": "Движение — это жизнь.", "author": "Аристотель"},
        {"text": "Простота — залог надёжности.", "author": "Эдсгер Дейкстра"},
        {"text": "Сначала реши задачу, потом пиши код.", "author": "Джон Джонсон"},
        {"text": "Лучший способ предсказать будущее — создать его.", "author": "Алан Кей"},
        {"text": "Программы должны писаться для людей, а не для машин.", "author": "Гарольд Абельсон"},
        {"text": "Любая достаточно развитая технология неотличима от магии.", "author": "Артур Кларк"},
        {"text": "Работает — не трогай. Не работает — рефактори.", "author": "Народная мудрость"},
        {"text": "Учиться никогда не поздно, а забывать — никогда не рано.", "author": "Неизвестный автор"},
        {"text": "Совершенство достигается не тогда, когда нечего добавить, а когда нечего убрать.", "author": "Антуан де Сент-Экзюпери"},
        {"text": "Говори — и я забуду. Покажи — и я запомню. Дай сделать — и я пойму.", "author": "Конфуций"},
    ],
    "en": [
        {"text": "Simplicity is prerequisite for reliability.", "author": "Edsger Dijkstra"},
        {"text": "The best way to predict the future is to invent it.", "author": "Alan Kay"},
        {"text": "Programs must be written for people to read.", "author": "Harold Abelson"},
        {"text": "Any sufficiently advanced technology is indistinguishable from magic.", "author": "Arthur C. Clarke"},
        {"text": "First, solve the problem. Then, write the code.", "author": "John Johnson"},
        {"text": "Talk is cheap. Show me the code.", "author": "Linus Torvalds"},
        {"text": "Perfection is achieved when there is nothing left to take away.", "author": "Antoine de Saint-Exupéry"},
        {"text": "Make it work, make it right, make it fast.", "author": "Kent Beck"},
    ],
}

FALLBACK_FACTS = {
    "ru": [
        "CSS-анимации выполняются на compositor-потоке, если анимировать только transform и opacity.",
        "Web Animations API появился в браузерах в 2016 году и позволяет управлять анимациями из JavaScript.",
        "Функция cubic-bezier(.34,1.56,.64,1) даёт эффект «перелёта» — объект чуть проскакивает конечную точку.",
        "Глаз человека воспринимает движение плавным примерно от 24 кадров в секунду; браузеры стремятся к 60.",
        "Осьминоги имеют три сердца, а у медузы сердца нет вовсе.",
        "Свет от Солнца до Земли идёт примерно 8 минут 20 секунд.",
        "Первый в мире веб-сайт до сих пор работает: info.cern.ch.",
        "Снежинки почти всегда шестиугольные из-за структуры кристаллической решётки льда.",
    ],
    "en": [
        "CSS animations of transform and opacity can run entirely on the compositor thread.",
        "The Web Animations API lets JavaScript control CSS-like animations directly.",
        "Honey never spoils — edible honey was found in ancient Egyptian tombs.",
        "Sunlight takes about 8 minutes and 20 seconds to reach Earth.",
        "The first website ever created is still online at info.cern.ch.",
        "Snowflakes are almost always six-sided because of the crystal structure of ice.",
    ],
}


def now_ms() -> int:
    return int(time.time() * 1000)


def local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except OSError:
        return "127.0.0.1"


LAN_IP = local_ip()
lock = threading.RLock()


# --------------------------------------------------------------------------- #
# Модель данных
# --------------------------------------------------------------------------- #

# --------------------------------------------------------------------------- #
# Мини-игры: шахматы и крестики-нолики.
# Правила живут на сервере: так нельзя «схитрить» и рассинхронизация невозможна.
# --------------------------------------------------------------------------- #

FILES = "abcdefgh"


def sq_name(idx: int) -> str:
    """Индекс 0..63 → имя клетки, 0 = a8 (верхний левый угол доски)."""
    return f"{FILES[idx % 8]}{8 - idx // 8}"


def sq_index(name: str) -> int:
    col = FILES.find(name[0])
    row = int(name[1])
    return (8 - row) * 8 + col


def initial_board() -> list:
    """Стартовая расстановка: элементы — 'wP', 'bK' и т. п., пусто — None."""
    back = ["R", "N", "B", "Q", "K", "B", "N", "R"]
    board = [None] * 64
    for col, piece in enumerate(back):
        board[col] = "b" + piece              # 8-й ряд (чёрные)
        board[8 + col] = "bP"                 # 7-й ряд
        board[48 + col] = "wP"                # 2-й ряд
        board[56 + col] = "w" + piece         # 1-й ряд (белые)
    return board


def new_chess() -> dict:
    return {
        "board": initial_board(),
        "turn": "w",
        "castling": "KQkq",
        "ep": None,               # клетка для взятия на проходе (индекс)
        "halfmove": 0,
        "fullmove": 1,
        "history": [],            # UCI-ходы
        "result": None,           # None | 'w' | 'b' | 'draw'
        "reason": "",
    }


def new_tictactoe() -> dict:
    return {"board": [None] * 9, "turn": "x", "moves": 0, "winner": None, "line": None}


def opponent(color: str) -> str:
    return "b" if color == "w" else "w"


def on_board(col: int, row: int) -> bool:
    return 0 <= col < 8 and 0 <= row < 8


def gen_pseudo(board: list, idx: int, castling: str, ep) -> list:
    """Ходы фигуры без проверки шаха собственному королю."""
    piece = board[idx]
    if not piece:
        return []
    color, kind = piece[0], piece[1]
    col, row = idx % 8, idx // 8
    moves = []                                  # (to, special)

    def slide(deltas):
        for dc, dr in deltas:
            c, r = col + dc, row + dr
            while on_board(c, r):
                target = board[r * 8 + c]
                if target is None:
                    moves.append((r * 8 + c, None))
                else:
                    if target[0] != color:
                        moves.append((r * 8 + c, None))
                    break
                c += dc
                r += dr

    def jump(deltas):
        for dc, dr in deltas:
            c, r = col + dc, row + dr
            if not on_board(c, r):
                continue
            target = board[r * 8 + c]
            if target is None or target[0] != color:
                moves.append((r * 8 + c, None))

    if kind == "P":
        direction = -1 if color == "w" else 1
        start_row = 6 if color == "w" else 1
        last_row = 0 if color == "w" else 7
        one = row + direction
        if on_board(col, one) and board[one * 8 + col] is None:
            moves.append((one * 8 + col, "promo" if one == last_row else None))
            two = row + 2 * direction
            if row == start_row and board[two * 8 + col] is None:
                moves.append((two * 8 + col, "double"))
        for dc in (-1, 1):
            c, r = col + dc, row + direction
            if not on_board(c, r):
                continue
            target = board[r * 8 + c]
            if target and target[0] != color:
                moves.append((r * 8 + c, "promo" if r == last_row else None))
            elif ep is not None and r * 8 + c == ep:
                moves.append((r * 8 + c, "ep"))
    elif kind == "N":
        jump([(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)])
    elif kind == "K":
        jump([(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)])
        # рокировки
        home = 7 if color == "w" else 0
        if row == home and col == 4:
            rights = ("KQ" if color == "w" else "kq")
            if rights[0] in castling and board[home * 8 + 5] is None and board[home * 8 + 6] is None:
                rook = board[home * 8 + 7]
                if rook == color + "R":
                    moves.append((home * 8 + 6, "castle-k"))
            if rights[1] in castling and all(board[home * 8 + c] is None for c in (1, 2, 3)):
                rook = board[home * 8 + 0]
                if rook == color + "R":
                    moves.append((home * 8 + 2, "castle-q"))
    elif kind == "B":
        slide([(1, 1), (1, -1), (-1, 1), (-1, -1)])
    elif kind == "R":
        slide([(1, 0), (-1, 0), (0, 1), (0, -1)])
    elif kind == "Q":
        slide([(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)])
    return moves


def find_king(board: list, color: str):
    target = color + "K"
    for i, piece in enumerate(board):
        if piece == target:
            return i
    return None


def attacked(board: list, idx: int, by_color: str) -> bool:
    """Бьётся ли клетка idx фигурами цвета by_color (без учёта рокировок)."""
    col, row = idx % 8, idx // 8
    # пешки
    direction = 1 if by_color == "w" else -1     # откуда могла прийти пешка
    for dc in (-1, 1):
        c, r = col + dc, row + direction
        if on_board(c, r) and board[r * 8 + c] == by_color + "P":
            return True
    # конь
    for dc, dr in [(1, 2), (2, 1), (2, -1), (1, -2), (-1, -2), (-2, -1), (-2, 1), (-1, 2)]:
        c, r = col + dc, row + dr
        if on_board(c, r) and board[r * 8 + c] == by_color + "N":
            return True
    # король
    for dc, dr in [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]:
        c, r = col + dc, row + dr
        if on_board(c, r) and board[r * 8 + c] == by_color + "K":
            return True
    # скользящие
    rays = {
        "B": [(1, 1), (1, -1), (-1, 1), (-1, -1)],
        "R": [(1, 0), (-1, 0), (0, 1), (0, -1)],
        "Q": [(1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (1, -1), (-1, 1), (-1, -1)],
    }
    for kind, deltas in rays.items():
        for dc, dr in deltas:
            c, r = col + dc, row + dr
            while on_board(c, r):
                piece = board[r * 8 + c]
                if piece:
                    if piece == by_color + kind:
                        return True
                    break
                c += dc
                r += dr
    return False


def apply_move(state: dict, frm: int, to: int, promo: str = "q") -> dict:
    """Применяет ход к копии состояния (без проверки легальности)."""
    board = list(state["board"])
    piece = board[frm]
    color, kind = piece[0], piece[1]
    captured = board[to]
    board[frm] = None
    board[to] = piece

    special = None
    for mv, sp in gen_pseudo(state["board"], frm, state["castling"], state["ep"]):
        if mv == to:
            special = sp
            break

    if special == "ep":
        victim_row = (to // 8) + (1 if color == "w" else -1)
        board[victim_row * 8 + (to % 8)] = None
    elif special == "castle-k":
        home = (to // 8) * 8
        board[home + 5] = board[home + 7]
        board[home + 7] = None
    elif special == "castle-q":
        home = (to // 8) * 8
        board[home + 3] = board[home + 0]
        board[home + 0] = None
    if special == "promo" and kind == "P":
        board[to] = color + (promo.upper() if promo else "Q")

    castling = state["castling"]
    if kind == "K":
        castling = castling.replace("K", "").replace("Q", "") if color == "w" else castling.replace("k", "").replace("q", "")
    for idx, letter in ((0, "Q"), (7, "K"), (56, "q"), (63, "k")):
        if frm == idx or to == idx:
            castling = castling.replace(letter, "")

    return {
        "board": board,
        "turn": opponent(color),
        "castling": castling,
        "ep": (frm + to) // 2 if special == "double" else None,
        "halfmove": 0 if (kind == "P" or captured) else state["halfmove"] + 1,
        "fullmove": state["fullmove"] + (1 if color == "b" else 0),
        "history": state["history"] + [sq_name(frm) + sq_name(to) + (promo if special == "promo" else "")],
        "result": None,
        "reason": "",
    }


def legal_moves(state: dict) -> list:
    """Все легальные ходы в формате UCI (с учётом шаха и рокировок)."""
    color = state["turn"]
    out = []
    for frm in range(64):
        piece = state["board"][frm]
        if not piece or piece[0] != color:
            continue
        for to, special in gen_pseudo(state["board"], frm, state["castling"], state["ep"]):
            for promo in ("q", "r", "b", "n") if special == "promo" else (None,):
                nxt = apply_move(state, frm, to, promo or "q")
                king = find_king(nxt["board"], color)
                if king is None or attacked(nxt["board"], king, opponent(color)):
                    continue
                if special and special.startswith("castle"):
                    # Рокировка: король не под шахом и не проходит через битое поле.
                    transit = frm + (1 if special == "castle-k" else -1)
                    if attacked(state["board"], frm, opponent(color)) or attacked(state["board"], transit, opponent(color)):
                        continue
                out.append(sq_name(frm) + sq_name(to) + (promo or ""))
    return out


def in_check(state: dict, color: str) -> bool:
    king = find_king(state["board"], color)
    return king is not None and attacked(state["board"], king, opponent(color))


def chess_move(state: dict, uci: str) -> tuple[bool, str]:
    """Ход в формате UCI ('e2e4', 'e7e8q'). Возвращает (ok, ошибка)."""
    uci = (uci or "").strip().lower()
    if len(uci) not in (4, 5) or uci[:2] not in [sq_name(i) for i in range(64)]:
        return False, "bad_move"
    try:
        frm = sq_index(uci[:2])
        to = sq_index(uci[2:4])
    except (ValueError, IndexError):
        return False, "bad_move"
    promo = uci[4] if len(uci) == 5 else "q"
    if uci[:4] + (uci[4] if len(uci) == 5 else "") not in legal_moves(state):
        return False, "illegal"
    nxt = apply_move(state, frm, to, promo)
    side = opponent(nxt["turn"])
    if not legal_moves(nxt):
        nxt["result"] = side if in_check(nxt, nxt["turn"]) else "draw"
        nxt["reason"] = "mate" if in_check(nxt, nxt["turn"]) else "stalemate"
    elif nxt["halfmove"] >= 100:
        nxt["result"] = "draw"
        nxt["reason"] = "fifty"
    state.clear()
    state.update(nxt)
    return True, ""


def ttt_move(state: dict, cell: int) -> tuple[bool, str]:
    if state.get("winner"):
        return False, "finished"
    if not isinstance(cell, int) or not 0 <= cell < 9:
        return False, "bad_move"
    if state["board"][cell]:
        return False, "occupied"
    mark = state["turn"]
    state["board"][cell] = mark
    state["moves"] += 1
    lines = [(0, 1, 2), (3, 4, 5), (6, 7, 8), (0, 3, 6), (1, 4, 7), (2, 5, 8), (0, 4, 8), (2, 4, 6)]
    for a, b, c in lines:
        if state["board"][a] and state["board"][a] == state["board"][b] == state["board"][c]:
            state["winner"] = mark
            state["line"] = [a, b, c]
            return True, ""
    if state["moves"] >= 9:
        state["winner"] = "draw"
        return True, ""
    state["turn"] = "o" if mark == "x" else "x"
    return True, ""


def chess_public(state: dict, colors: dict) -> dict:
    """Состояние для клиента: доска, чей ход, подсветка легальных ходов, шах."""
    legal: dict[str, list[str]] = {}
    for uci in legal_moves(state):
        legal.setdefault(uci[:2], []).append(uci)
    return {
        "board": state["board"],
        "turn": state["turn"],
        "legal": legal,
        "check": in_check(state, state["turn"]),
        "history": state["history"][-20:],
        "result": state["result"],
        "reason": state["reason"],
        "colors": colors,
    }


def ttt_public(state: dict, colors: dict) -> dict:
    return {
        "board": state["board"],
        "turn": state["turn"] if not state["winner"] else None,
        "winner": state["winner"],
        "line": state["line"],
        "colors": colors,
    }


class Game:
    def __init__(self, game_id: str, kind: str, host_id: str, host_name: str):
        self.id = game_id
        self.kind = kind                       # chess | tictactoe
        self.players: list[str] = [host_id]
        self.names: dict[str, str] = {host_id: host_name}
        self.marks: dict[str, str] = {host_id: "w" if kind == "chess" else "x"}
        self.created = time.time()
        self.finished = False
        self.state = new_chess() if kind == "chess" else new_tictactoe()
        self.spectators: list[str] = []

    def mark_for(self, uid: str):
        return self.marks.get(uid)

    def public(self) -> dict:
        colors = {mark: {"id": uid, "name": self.names.get(uid, "")} for uid, mark in self.marks.items()}
        state = chess_public(self.state, colors) if self.kind == "chess" else ttt_public(self.state, colors)
        return {
            "id": self.id,
            "kind": self.kind,
            "players": [{"id": uid, "name": self.names.get(uid, ""), "mark": self.marks.get(uid)} for uid in self.players],
            "created": int(self.created * 1000),
            "waiting": len(self.players) < 2,
            "finished": bool(self.state.get("result") or self.state.get("winner")),
            "state": state,
        }


class WSClient:
    """Соединение WebSocket с очередью исходящих сообщений и потоком-отправителем."""

    def __init__(self, wfile, uid=""):
        self.wfile = wfile
        self.uid = uid
        self.q: queue.Queue = queue.Queue(maxsize=500)
        self.alive = True
        self.lock = threading.Lock()
        self.thread = threading.Thread(target=self._writer, daemon=True)
        self.thread.start()

    def put(self, data: str) -> None:
        if not self.alive:
            return
        try:
            self.q.put_nowait(("text", data))
        except queue.Full:
            self.alive = False

    def send_frame(self, opcode: int, payload: bytes) -> bool:
        header = bytearray([0x80 | opcode])
        n = len(payload)
        if n < 126:
            header.append(n)
        elif n < 65536:
            header.append(126)
            header += struct.pack(">H", n)
        else:
            header.append(127)
            header += struct.pack(">Q", n)
        try:
            with self.lock:
                self.wfile.write(bytes(header) + payload)
                self.wfile.flush()
            return True
        except (BrokenPipeError, ConnectionResetError, OSError):
            self.alive = False
            return False

    def _writer(self) -> None:
        while self.alive:
            try:
                kind, data = self.q.get(timeout=20)
            except queue.Empty:
                if not self.send_frame(0x9, b"mp"):
                    break
                continue
            if kind == "text":
                if not self.send_frame(0x1, data.encode("utf-8")):
                    break
            elif kind == "close":
                self.send_frame(0x8, data)
                break
        self.alive = False

    def close(self) -> None:
        try:
            self.q.put_nowait(("close", struct.pack(">H", 1000)))
        except queue.Full:
            pass
        self.alive = False


class SSEClient:
    """Клиент SSE: очередь + uid, чтобы можно было слать сообщение адресно."""

    def __init__(self, q: "queue.Queue", uid: str = ""):
        self.q = q
        self.uid = uid

    def put(self, data: str) -> bool:
        try:
            self.q.put_nowait(data)
            return True
        except queue.Full:
            return False


class Room:
    def __init__(self, code: str):
        self.code = code
        self.users: dict[str, dict] = {}
        self.feed: list[dict] = []
        self.chat: list[dict] = []
        self.strokes: list[dict] = []
        self.polls: list[dict] = []
        self.frozen = False
        self.announcement = ""
        self.host_id: str | None = None
        self.created = time.time()
        self.last_activity = time.time()
        self.sse: list[SSEClient] = []
        self.ws: list[WSClient] = []
        self.games: dict[str, Game] = {}
        # Журнал занятия: что происходило в комнате, переживает перезапуск сервера.
        self.journal: list[dict] = []
        # Общая сцена: когда включена, все участники управляют одной и той же сценой.
        self.shared: dict = {"enabled": False, "state": None, "by": None}

    # --- участники ---------------------------------------------------------
    def pick_color(self) -> str:
        used = {u["color"] for u in self.users.values()}
        for color in USER_COLORS:
            if color not in used:
                return color
        return USER_COLORS[len(self.users) % len(USER_COLORS)]

    def ensure_host(self) -> bool:
        """Назначает ведущего, если его нет. Возвращает True, если ведущий сменился."""
        if self.host_id in self.users:
            return False
        if not self.users:
            self.host_id = None
            return False
        oldest = min(self.users.items(), key=lambda kv: kv[1]["joinedAt"])
        self.host_id = oldest[0]
        return True

    def public_user(self, uid: str, u: dict) -> dict:
        return {
            "id": uid,
            "name": u["name"],
            "avatar": u.get("avatar", ""),
            "color": u["color"],
            "tz": u.get("tz", ""),
            "status": u.get("status", "active"),
            "likes": u.get("likes", 0),
            "role": "host" if uid == self.host_id else "member",
            "follow": bool(u.get("follow", False)),
            "joinedAt": int(u["joinedAt"] * 1000),
            "state": u.get("state", dict(DEFAULT_STATE)),
        }

    def users_public(self) -> list[dict]:
        return [self.public_user(uid, u) for uid, u in self.users.items()]

    def games_public(self) -> list[dict]:
        return [g.public() for g in self.games.values()]

    def snapshot(self) -> dict:
        return {
            "multiplayer": True,
            "room": self.code,
            "hostId": self.host_id,
            "frozen": self.frozen,
            "announcement": self.announcement,
            "users": self.users_public(),
            "feed": self.feed[-MAX_FEED:],
            "chat": self.chat[-80:],
            "strokes": self.strokes,
            "polls": self.polls[-MAX_POLLS:],
            "games": self.games_public(),
            "shared": {"enabled": self.shared["enabled"], "by": self.shared["by"],
                       "state": self.shared["state"] if self.shared["enabled"] else None},
            "serverTime": now_ms(),
        }

    # --- лента и рассылка ---------------------------------------------------
    def push_feed(self, user_id: str, user_name: str, action_type: str, text: str,
                  text_key: str | None = None, vars_: dict | None = None) -> dict:
        entry = {
            "id": str(uuid.uuid4()),
            "ts": now_ms(),
            "userId": user_id,
            "userName": user_name,
            "type": action_type,
            "text": text,
        }
        if text_key:
            entry["textKey"] = text_key
            entry["vars"] = vars_ or {}
        self.feed.append(entry)
        if len(self.feed) > MAX_FEED:
            del self.feed[: len(self.feed) - MAX_FEED]
        self.journal_entry(action_type, user_name, text, text_key, vars_)
        self.last_activity = time.time()
        return entry

    def journal_entry(self, kind: str, user_name: str, text: str,
                      text_key: str | None = None, vars_: dict | None = None) -> None:
        """Журнал занятия: краткая история комнаты (переживает перезапуск)."""
        entry = {
            "ts": now_ms(),
            "type": kind,
            "user": clean_text(user_name, 40),
            "text": clean_text(text, 200),
        }
        if text_key:
            entry["textKey"] = text_key
            entry["vars"] = vars_ or {}
        self.journal.append(entry)
        if len(self.journal) > MAX_JOURNAL:
            del self.journal[: len(self.journal) - MAX_JOURNAL]

    def broadcast(self, message: dict) -> None:
        data = json.dumps(message, ensure_ascii=False)
        for client in list(self.sse):
            if not client.put(data):
                if client in self.sse:
                    self.sse.remove(client)
        for client in list(self.ws):
            if not client.alive:
                self.ws.remove(client)
                continue
            client.put(data)

    def broadcast_except(self, uid: str, message: dict) -> None:
        """Рассылает сообщение всем, кроме uid (используется для WebRTC-сигналинга)."""
        data = json.dumps(message, ensure_ascii=False)
        for client in list(self.ws):
            if not client.alive:
                self.ws.remove(client)
                continue
            if client.uid == uid:
                continue
            client.put(data)
        for client in list(self.sse):
            if client.uid == uid:
                continue
            if not client.put(data) and client in self.sse:
                self.sse.remove(client)

    def broadcast_to(self, uid: str, message: dict) -> None:
        data = json.dumps(message, ensure_ascii=False)
        for client in list(self.ws):
            if client.uid == uid and client.alive:
                client.put(data)
        for client in list(self.sse):
            if client.uid == uid:
                client.put(data)

    def broadcast_users(self) -> None:
        self.broadcast({"type": "users", "users": self.users_public(), "hostId": self.host_id})

    def remove_user(self, uid: str, reason: str = "leave") -> None:
        user = self.users.pop(uid, None)
        if not user:
            return
        entry = self.push_feed(
            uid, user["name"], reason,
            f"{user['name']} отключился" if reason == "leave" else f"{user['name']} исключён ведущим",
            "feed.leave" if reason == "leave" else "feed.kicked", {"name": user["name"]},
        )
        host_changed = self.ensure_host()
        self.broadcast({"type": "feed", "entry": entry, "users": self.users_public(), "hostId": self.host_id})
        if host_changed and self.host_id:
            host_name = self.users[self.host_id]["name"]
            entry = self.push_feed(self.host_id, host_name, "host", f"{host_name} стал ведущим",
                                   "feed.newHost", {"name": host_name})
            self.broadcast({"type": "feed", "entry": entry, "users": self.users_public(), "hostId": self.host_id})

    def prune(self) -> None:
        now = time.time()
        stale = [uid for uid, u in self.users.items() if now - u["lastSeen"] > USER_TTL]
        for uid in stale:
            self.remove_user(uid, "leave")


rooms: dict[str, Room] = {}


def normalize_room_code(raw: str) -> str:
    code = "".join(ch for ch in str(raw or "").upper() if ch.isalnum())[:8]
    return code or "MAIN"


def generate_room_code() -> str:
    alphabet = string.ascii_uppercase + string.digits
    while True:
        code = "".join(random.choice(alphabet) for _ in range(4))
        if code not in rooms:
            return code


def get_room(code: str, create: bool = True) -> Room | None:
    code = normalize_room_code(code)
    room = rooms.get(code)
    if room is None and create:
        room = Room(code)
        rooms[code] = room
    return room


def rooms_summary() -> list[dict]:
    return [
        {"code": r.code, "users": len(r.users), "host": r.users.get(r.host_id, {}).get("name", "") if r.host_id else ""}
        for r in rooms.values()
    ]


def housekeeping() -> None:
    """Фоновая очистка: неактивные участники и пустые комнаты."""
    while True:
        time.sleep(15)
        with lock:
            for code, room in list(rooms.items()):
                room.prune()
                if not room.users and not room.sse and not room.ws and time.time() - room.last_activity > ROOM_TTL:
                    del rooms[code]


# --------------------------------------------------------------------------- #
# Обработка сообщений (общая для WebSocket и REST)
# --------------------------------------------------------------------------- #

class RateLimiter:
    def __init__(self):
        self.buckets: dict[tuple[str, str], list[float]] = {}

    def allow(self, uid: str, kind: str, per_second: float) -> bool:
        key = (uid, kind)
        now = time.time()
        bucket = self.buckets.setdefault(key, [now, per_second])
        elapsed = now - bucket[0]
        bucket[0] = now
        bucket[1] = min(per_second, bucket[1] + elapsed * per_second)
        if bucket[1] >= 1:
            bucket[1] -= 1
            return True
        return False


limiter = RateLimiter()


def clean_text(value, limit: int) -> str:
    return str(value if value is not None else "").strip()[:limit]


def apply_state_patch(user: dict, patch) -> bool:
    if not isinstance(patch, dict):
        return False
    try:
        raw = json.dumps(patch, ensure_ascii=False)
    except (TypeError, ValueError):
        return False
    if len(raw) > MAX_STATE_BYTES:
        return False
    state = user.setdefault("state", dict(DEFAULT_STATE))
    for key, value in patch.items():
        if isinstance(key, str) and len(key) <= 40:
            state[key] = value
    return True


def handle_message(room: Room, uid: str, msg: dict) -> dict:
    """Возвращает JSON-ответ для отправителя. Вызывается под lock."""
    kind = str(msg.get("kind", ""))
    user = room.users.get(uid)
    if not user:
        return {"ok": False, "error": "unknown_user"}
    user["lastSeen"] = time.time()
    is_host = uid == room.host_id

    if kind == "ping":
        return {"ok": True}

    if kind == "leave":
        room.remove_user(uid, "leave")
        return {"ok": True}

    if kind in ("action", "state", "stroke", "board_clear") and room.frozen and not is_host:
        return {"ok": False, "error": "frozen"}

    if kind == "action":
        text = clean_text(msg.get("text"), 240)
        action_type = clean_text(msg.get("type"), 32) or "update"
        text_key = clean_text(msg.get("textKey"), 64) or None
        vars_ = msg.get("vars") if isinstance(msg.get("vars"), dict) else {}
        apply_state_patch(user, msg.get("state"))
        if not text and not text_key:
            room.broadcast_users()
            return {"ok": True}
        entry = room.push_feed(uid, user["name"], action_type, text, text_key, vars_)
        room.broadcast({"type": "action", "entry": entry, "users": room.users_public(), "hostId": room.host_id})
        return {"ok": True, "entry": entry}

    if kind == "state":
        if not limiter.allow(uid, "state", 25):
            return {"ok": True, "dropped": True}
        apply_state_patch(user, msg.get("state"))
        room.broadcast_users()
        return {"ok": True}

    if kind == "cursor":
        if not limiter.allow(uid, "cursor", 40):
            return {"ok": True, "dropped": True}
        try:
            x = round(float(msg.get("x", 0)), 4)
            y = round(float(msg.get("y", 0)), 4)
        except (TypeError, ValueError):
            return {"ok": False, "error": "bad_cursor"}
        room.broadcast({"type": "cursor", "userId": uid, "x": x, "y": y, "visible": bool(msg.get("visible", True))})
        return {"ok": True}

    if kind == "chat":
        text = clean_text(msg.get("text"), 500)
        if not text:
            return {"ok": False, "error": "empty"}
        if not limiter.allow(uid, "chat", 3):
            return {"ok": False, "error": "too_fast"}
        message = {
            "id": str(uuid.uuid4()),
            "ts": now_ms(),
            "userId": uid,
            "userName": user["name"],
            "avatar": user.get("avatar", ""),
            "color": user["color"],
            "text": text,
        }
        room.chat.append(message)
        if len(room.chat) > MAX_CHAT:
            del room.chat[: len(room.chat) - MAX_CHAT]
        room.last_activity = time.time()
        room.broadcast({"type": "chat", "message": message})
        return {"ok": True, "message": message}

    if kind == "typing":
        room.broadcast({"type": "typing", "userId": uid, "name": user["name"], "on": bool(msg.get("on"))})
        return {"ok": True}

    if kind == "reaction":
        emoji = clean_text(msg.get("emoji"), 8)
        if not emoji or not limiter.allow(uid, "reaction", 4):
            return {"ok": False, "error": "too_fast"}
        room.broadcast({"type": "reaction", "userId": uid, "name": user["name"], "emoji": emoji, "ts": now_ms()})
        return {"ok": True}

    if kind == "like":
        target_id = str(msg.get("target", ""))
        target = room.users.get(target_id)
        if not target or target_id == uid:
            return {"ok": False, "error": "bad_target"}
        last = user.setdefault("likedAt", {})
        if time.time() - last.get(target_id, 0) < 10:
            return {"ok": False, "error": "too_fast"}
        last[target_id] = time.time()
        target["likes"] = target.get("likes", 0) + 1
        entry = room.push_feed(uid, user["name"], "like", f"лайкнул сцену {target['name']}",
                               "feed.like", {"target": target["name"]})
        room.broadcast({"type": "action", "entry": entry, "users": room.users_public(), "hostId": room.host_id,
                        "like": {"from": uid, "target": target_id}})
        return {"ok": True}

    if kind == "status":
        status = "afk" if msg.get("status") == "afk" else "active"
        if user.get("status") != status:
            user["status"] = status
            room.broadcast_users()
        return {"ok": True}

    if kind == "follow":
        user["follow"] = bool(msg.get("on"))
        room.broadcast_users()
        return {"ok": True}

    if kind == "profile":
        avatar = clean_text(msg.get("avatar"), 8)
        tz = clean_text(msg.get("tz"), 64)
        if avatar:
            user["avatar"] = avatar
        if tz:
            user["tz"] = tz
        room.broadcast_users()
        return {"ok": True}

    if kind == "stroke":
        stroke = msg.get("stroke")
        if not isinstance(stroke, dict):
            return {"ok": False, "error": "bad_stroke"}
        sid = clean_text(stroke.get("id"), 40)
        points = stroke.get("points")
        if not sid or not isinstance(points, list):
            return {"ok": False, "error": "bad_stroke"}
        points = [[round(float(p[0]), 4), round(float(p[1]), 4)] for p in points[:400]
                  if isinstance(p, (list, tuple)) and len(p) == 2]
        existing = next((s for s in reversed(room.strokes) if s["id"] == sid and s["userId"] == uid), None)
        if existing:
            if len(existing["points"]) < MAX_STROKE_POINTS:
                existing["points"].extend(points)
            existing["done"] = bool(stroke.get("done", False))
        else:
            existing = {
                "id": sid,
                "userId": uid,
                "color": clean_text(stroke.get("color"), 24) or user["color"],
                "width": max(1, min(30, int(stroke.get("width", 4) or 4))),
                "erase": bool(stroke.get("erase", False)),
                "points": points,
                "done": bool(stroke.get("done", False)),
            }
            room.strokes.append(existing)
            if len(room.strokes) > MAX_STROKES:
                del room.strokes[: len(room.strokes) - MAX_STROKES]
        room.broadcast({"type": "stroke", "stroke": {**existing, "points": points, "append": True}})
        return {"ok": True}

    if kind == "board_clear":
        room.strokes.clear()
        room.broadcast({"type": "board_clear", "by": user["name"]})
        return {"ok": True}

    if kind == "poll_create":
        if not is_host:
            return {"ok": False, "error": "host_only"}
        question = clean_text(msg.get("question"), 160)
        options = [clean_text(o, 60) for o in (msg.get("options") or []) if clean_text(o, 60)][:6]
        if not question or len(options) < 2:
            return {"ok": False, "error": "bad_poll"}
        for p in room.polls:
            p["open"] = False
        poll = {
            "id": str(uuid.uuid4())[:8],
            "question": question,
            "options": options,
            "votes": {},
            "open": True,
            "createdBy": user["name"],
            "ts": now_ms(),
        }
        room.polls.append(poll)
        if len(room.polls) > MAX_POLLS:
            del room.polls[: len(room.polls) - MAX_POLLS]
        entry = room.push_feed(uid, user["name"], "poll", f"создал опрос: {question}", "feed.poll", {"question": question})
        room.broadcast({"type": "poll", "poll": poll, "entry": entry})
        return {"ok": True, "poll": poll}

    if kind == "poll_vote":
        poll = next((p for p in room.polls if p["id"] == msg.get("pollId")), None)
        if not poll or not poll["open"]:
            return {"ok": False, "error": "poll_closed"}
        try:
            option = int(msg.get("option"))
        except (TypeError, ValueError):
            return {"ok": False, "error": "bad_option"}
        if not 0 <= option < len(poll["options"]):
            return {"ok": False, "error": "bad_option"}
        poll["votes"][uid] = option
        room.broadcast({"type": "poll", "poll": poll})
        return {"ok": True}

    if kind == "poll_close":
        poll = next((p for p in room.polls if p["id"] == msg.get("pollId")), None)
        if not poll:
            return {"ok": False, "error": "no_poll"}
        if not is_host:
            return {"ok": False, "error": "host_only"}
        poll["open"] = False
        room.broadcast({"type": "poll", "poll": poll})
        return {"ok": True}

    if kind == "admin":
        if not is_host:
            return {"ok": False, "error": "host_only"}
        op = str(msg.get("op", ""))
        if op == "kick":
            target = str(msg.get("target", ""))
            if target in room.users and target != uid:
                room.broadcast({"type": "kicked", "userId": target, "by": user["name"]})
                room.remove_user(target, "kicked")
                return {"ok": True}
            return {"ok": False, "error": "bad_target"}
        if op == "clear_feed":
            room.feed.clear()
            room.broadcast({"type": "feed_cleared", "by": user["name"]})
            return {"ok": True}
        if op == "clear_chat":
            room.chat.clear()
            room.broadcast({"type": "chat_cleared", "by": user["name"]})
            return {"ok": True}
        if op in ("freeze", "unfreeze"):
            room.frozen = op == "freeze"
            entry = room.push_feed(uid, user["name"], "freeze",
                                   "заморозил сцену для участников" if room.frozen else "разморозил сцену",
                                   "feed.freeze" if room.frozen else "feed.unfreeze", {})
            room.broadcast({"type": "frozen", "frozen": room.frozen, "entry": entry})
            return {"ok": True}
        if op == "announce":
            room.announcement = clean_text(msg.get("text"), 200)
            room.journal_entry("announce", user["name"], room.announcement)
            room.broadcast({"type": "announce", "text": room.announcement, "by": user["name"]})
            return {"ok": True}
        if op == "push_scene":
            state = msg.get("state")
            if not isinstance(state, dict):
                return {"ok": False, "error": "bad_state"}
            room.journal_entry("push", user["name"], "применил свою сцену ко всем")
            entry = room.push_feed(uid, user["name"], "push", "применил свою сцену ко всем участникам",
                                   "feed.pushScene", {})
            room.broadcast({"type": "apply_state", "state": state, "from": uid, "fromName": user["name"], "entry": entry})
            return {"ok": True}
        if op == "transfer_host":
            target = str(msg.get("target", ""))
            if target not in room.users:
                return {"ok": False, "error": "bad_target"}
            room.host_id = target
            name = room.users[target]["name"]
            entry = room.push_feed(uid, user["name"], "host", f"передал роль ведущего: {name}",
                                   "feed.transferHost", {"name": name})
            room.broadcast({"type": "feed", "entry": entry, "users": room.users_public(), "hostId": room.host_id})
            return {"ok": True}
        return {"ok": False, "error": "unknown_op"}

    # --- общая сцена ----------------------------------------------------------
    if kind == "shared_enable":
        if not is_host:
            return {"ok": False, "error": "host_only"}
        state = msg.get("state") if isinstance(msg.get("state"), dict) else dict(user.get("state", DEFAULT_STATE))
        if len(json.dumps(state, ensure_ascii=False)) > MAX_STATE_BYTES * 2:
            return {"ok": False, "error": "too_big"}
        room.shared = {"enabled": True, "state": state, "by": uid}
        entry = room.push_feed(uid, user["name"], "shared", f"{user['name']} включил общую сцену",
                               "feed.sharedOn", {"name": user["name"]})
        room.broadcast({"type": "shared", "enabled": True, "state": state, "by": uid, "byName": user["name"],
                        "entry": entry, "users": room.users_public(), "hostId": room.host_id})
        return {"ok": True}

    if kind == "shared_disable":
        if not is_host:
            return {"ok": False, "error": "host_only"}
        room.shared = {"enabled": False, "state": room.shared.get("state"), "by": None}
        entry = room.push_feed(uid, user["name"], "shared", f"{user['name']} вернул каждому свою сцену",
                               "feed.sharedOff", {"name": user["name"]})
        room.broadcast({"type": "shared", "enabled": False, "by": uid, "byName": user["name"],
                        "entry": entry, "users": room.users_public(), "hostId": room.host_id})
        return {"ok": True}

    if kind == "shared_update":
        if not room.shared["enabled"]:
            return {"ok": False, "error": "not_shared"}
        if room.frozen and not is_host:
            return {"ok": False, "error": "frozen"}
        if not limiter.allow(uid, "shared", 20):
            return {"ok": True, "dropped": True}
        patch = msg.get("state") if isinstance(msg.get("state"), dict) else None
        if patch is None:
            return {"ok": False, "error": "bad_state"}
        if len(json.dumps(patch, ensure_ascii=False)) > MAX_STATE_BYTES * 2:
            return {"ok": False, "error": "too_big"}
        room.shared["state"] = patch
        room.last_activity = time.time()
        room.broadcast({"type": "shared", "enabled": True, "state": patch, "from": uid,
                        "fromName": user.get("name", ""), "textKey": msg.get("textKey"),
                        "vars": msg.get("vars") if isinstance(msg.get("vars"), dict) else {}})
        return {"ok": True}

    # --- мини-игры ------------------------------------------------------------
    if kind == "game_create":
        kind_game = clean_text(msg.get("game"), 16)
        if kind_game not in ("chess", "tictactoe"):
            return {"ok": False, "error": "bad_game"}
        if len(room.games) >= 12:
            return {"ok": False, "error": "too_many_games"}
        game = Game(str(uuid.uuid4())[:8], kind_game, uid, user["name"])
        room.games[game.id] = game
        entry = room.push_feed(uid, user["name"], "game", f"{user['name']} создал игру",
                               "feed.gameCreate" if kind_game == "chess" else "feed.gameCreateTTT",
                               {"name": user["name"]})
        room.broadcast({"type": "games", "games": room.games_public(), "entry": entry, "users": room.users_public()})
        return {"ok": True, "gameId": game.id}

    if kind == "game_join":
        game = room.games.get(clean_text(msg.get("gameId"), 12))
        if not game:
            return {"ok": False, "error": "bad_game"}
        if uid in game.players:
            return {"ok": True}
        if len(game.players) >= 2:
            return {"ok": False, "error": "full"}
        game.players.append(uid)
        game.names[uid] = user["name"]
        game.marks[uid] = "b" if game.kind == "chess" else "o"
        entry = room.push_feed(uid, user["name"], "game", f"{user['name']} присоединился к игре",
                               "feed.gameJoin", {"name": user["name"]})
        room.broadcast({"type": "games", "games": room.games_public(), "entry": entry, "users": room.users_public()})
        return {"ok": True}

    if kind == "game_leave":
        game = room.games.get(clean_text(msg.get("gameId"), 12))
        if not game:
            return {"ok": False, "error": "bad_game"}
        if uid in game.players:
            game.players.remove(uid)
        if not game.players:
            room.games.pop(game.id, None)
        room.broadcast({"type": "games", "games": room.games_public(), "users": room.users_public()})
        return {"ok": True}

    if kind == "game_move":
        game = room.games.get(clean_text(msg.get("gameId"), 12))
        if not game:
            return {"ok": False, "error": "bad_game"}
        if len(game.players) < 2:
            return {"ok": False, "error": "waiting"}
        mark = game.mark_for(uid)
        if mark is None:
            return {"ok": False, "error": "not_player"}
        state = game.state
        if game.kind == "chess":
            if state["result"]:
                return {"ok": False, "error": "finished"}
            if (state["turn"] == "w") != (mark == "w"):
                return {"ok": False, "error": "not_your_turn"}
            move = msg.get("move")
            if not isinstance(move, str):
                return {"ok": False, "error": "bad_move"}
            ok, err = chess_move(state, move)
            if not ok:
                return {"ok": False, "error": err}
            if state["result"]:
                entry = room.push_feed(uid, user["name"], "game", "партия завершена",
                                       "feed.gameWin" if state["result"] in ("w", "b") else "feed.gameDraw",
                                       {"name": game.names.get(
                                           next((p for p, m in game.marks.items() if m == state["result"]), ""), "")}
                                       if state["result"] in ("w", "b") else {})
                room.broadcast({"type": "games", "games": room.games_public(), "entry": entry,
                                "users": room.users_public()})
                return {"ok": True}
        else:
            if state["winner"]:
                return {"ok": False, "error": "finished"}
            if state["turn"] != mark:
                return {"ok": False, "error": "not_your_turn"}
            cell = msg.get("move")
            try:
                cell = int(cell)
            except (TypeError, ValueError):
                return {"ok": False, "error": "bad_move"}
            ok, err = ttt_move(state, cell)
            if not ok:
                return {"ok": False, "error": err}
            if state["winner"]:
                winner_id = next((p for p, m in game.marks.items() if m == state["winner"]), "")
                entry = room.push_feed(uid, user["name"], "game", "партия завершена",
                                       "feed.gameDraw" if state["winner"] == "draw" else "feed.gameWin",
                                       {"name": game.names.get(winner_id, "")})
                room.broadcast({"type": "games", "games": room.games_public(), "entry": entry,
                                "users": room.users_public()})
                return {"ok": True}
        room.broadcast({"type": "games", "games": room.games_public()})
        return {"ok": True}

    if kind == "game_reset":
        game = room.games.get(clean_text(msg.get("gameId"), 12))
        if not game:
            return {"ok": False, "error": "bad_game"}
        if uid not in game.players:
            return {"ok": False, "error": "not_player"}
        game.state = new_chess() if game.kind == "chess" else new_tictactoe()
        game.finished = False
        room.broadcast({"type": "games", "games": room.games_public()})
        return {"ok": True}

    # --- сигналинг звонка (WebRTC) -------------------------------------------
    if kind == "rtc":
        payload = msg.get("payload")
        if not isinstance(payload, dict):
            return {"ok": False, "error": "bad_payload"}
        target = clean_text(msg.get("target"), 40)
        if len(json.dumps(payload, ensure_ascii=False)) > 60_000:
            return {"ok": False, "error": "too_big"}
        out = {"type": "rtc", "from": uid, "fromName": user["name"], "payload": payload, "target": target}
        if target and target in room.users:
            room.broadcast_to(target, out)
            return {"ok": True}
        room.broadcast_except(uid, out)
        return {"ok": True}

    return {"ok": False, "error": "unknown_kind"}


# --------------------------------------------------------------------------- #
# Постоянство: комнаты переживают перезапуск сервера
# --------------------------------------------------------------------------- #

def room_to_json(room: Room) -> dict:
    return {
        "code": room.code,
        "created": room.created,
        "lastActivity": room.last_activity,
        "hostId": room.host_id,
        "frozen": room.frozen,
        "announcement": room.announcement,
        "feed": room.feed[-MAX_FEED:],
        "chat": room.chat[-MAX_CHAT:],
        "strokes": room.strokes[-MAX_STROKES:],
        "polls": room.polls[-MAX_POLLS:],
        "journal": room.journal[-MAX_JOURNAL:],
        "shared": {"enabled": False, "state": room.shared.get("state"), "by": None},
    }


def save_rooms() -> None:
    """Пишет комнаты в data/rooms.json атомарно (через временный файл)."""
    payload = {"saved": now_ms(), "rooms": [room_to_json(r) for r in rooms.values()]}
    try:
        tmp = PERSIST_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(payload, fh, ensure_ascii=False)
        os.replace(tmp, PERSIST_FILE)
    except OSError as err:
        print(f"[warn] не удалось сохранить комнаты: {err}")


def load_rooms() -> int:
    """Восстанавливает комнаты из data/rooms.json. Возвращает количество комнат."""
    if not os.path.exists(PERSIST_FILE):
        return 0
    try:
        with open(PERSIST_FILE, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError) as err:
        print(f"[warn] не удалось прочитать сохранённые комнаты: {err}")
        return 0
    count = 0
    for item in data.get("rooms", []):
        code = normalize_room_code(item.get("code", ""))
        if not code:
            continue
        room = Room(code)
        room.created = float(item.get("created", time.time()))
        room.last_activity = float(item.get("lastActivity", time.time()))
        room.host_id = item.get("hostId")
        room.frozen = bool(item.get("frozen"))
        room.announcement = str(item.get("announcement", ""))[:200]
        room.feed = [e for e in item.get("feed", []) if isinstance(e, dict)][-MAX_FEED:]
        room.chat = [m for m in item.get("chat", []) if isinstance(m, dict)][-MAX_CHAT:]
        room.strokes = [s for s in item.get("strokes", []) if isinstance(s, dict)][-MAX_STROKES:]
        room.polls = [p for p in item.get("polls", []) if isinstance(p, dict)][-MAX_POLLS:]
        room.journal = [j for j in item.get("journal", []) if isinstance(j, dict)][-MAX_JOURNAL:]
        shared = item.get("shared") if isinstance(item.get("shared"), dict) else None
        if shared:
            room.shared = {"enabled": False, "state": shared.get("state"), "by": None}
        rooms[code] = room
        count += 1
    return count


def persist_worker() -> None:
    while True:
        time.sleep(PERSIST_INTERVAL)
        with lock:
            save_rooms()


# --------------------------------------------------------------------------- #
# Загрузка медиа на сервер
# --------------------------------------------------------------------------- #

def uploads_size() -> int:
    total = 0
    try:
        for name in os.listdir(UPLOAD_DIR):
            path = os.path.join(UPLOAD_DIR, name)
            if os.path.isfile(path):
                total += os.path.getsize(path)
    except OSError:
        pass
    return total


def prune_uploads() -> None:
    """Если хранилище переполнено — удаляем самые старые файлы."""
    try:
        files = [(os.path.getmtime(os.path.join(UPLOAD_DIR, n)), n)
                 for n in os.listdir(UPLOAD_DIR) if os.path.isfile(os.path.join(UPLOAD_DIR, n))]
    except OSError:
        return
    files.sort()
    total = sum(os.path.getsize(os.path.join(UPLOAD_DIR, n)) for _, n in files)
    for _, name in files:
        if total <= MAX_UPLOAD_TOTAL:
            break
        path = os.path.join(UPLOAD_DIR, name)
        try:
            total -= os.path.getsize(path)
            os.remove(path)
        except OSError:
            pass


def save_upload(data: bytes, filename: str) -> dict:
    ext = os.path.splitext(filename.lower())[1]
    if ext not in UPLOAD_TYPES:
        return {"ok": False, "error": "bad_type"}
    if not data or len(data) > MAX_UPLOAD_BYTES:
        return {"ok": False, "error": "too_big"}
    name = f"{uuid.uuid4().hex}{ext}"
    path = os.path.join(UPLOAD_DIR, name)
    try:
        with open(path, "wb") as fh:
            fh.write(data)
    except OSError as err:
        return {"ok": False, "error": f"io: {err}"}
    prune_uploads()
    return {"ok": True, "url": f"/uploads/{name}", "name": filename[:120],
            "size": len(data), "type": UPLOAD_TYPES[ext], "uploaded": now_ms()}


# --------------------------------------------------------------------------- #
# Внешние API (прокси с кэшем)
# --------------------------------------------------------------------------- #

ext_cache: dict[str, tuple[float, dict]] = {}


def http_get_json(url: str, timeout: float = 6.0):
    req = urllib.request.Request(url, headers={"User-Agent": "MotionPlayground/2.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8", "replace"))


def fetch_quote(lang: str) -> dict:
    lang = "ru" if lang == "ru" else "en"
    sources = []
    if lang == "ru":
        sources.append(("forismatic", f"https://api.forismatic.com/api/1.0/?method=getQuote&format=json&lang=ru&key={random.randint(1, 999999)}"))
    sources.append(("quotable", "https://api.quotable.io/random"))
    sources.append(("zenquotes", "https://zenquotes.io/api/random"))
    for name, url in sources:
        try:
            data = http_get_json(url, timeout=5)
            if name == "forismatic":
                text, author = data.get("quoteText", "").strip(), data.get("quoteAuthor", "").strip()
            elif name == "quotable":
                text, author = data.get("content", ""), data.get("author", "")
            else:
                text, author = data[0].get("q", ""), data[0].get("a", "")
            if text:
                return {"ok": True, "source": name, "text": text, "author": author or "—"}
        except Exception:  # noqa: BLE001 — любая сетевая ошибка → следующий источник
            continue
    quote = random.choice(FALLBACK_QUOTES[lang])
    return {"ok": True, "source": "offline", **quote}


def fetch_fact(lang: str) -> dict:
    lang = "ru" if lang == "ru" else "en"
    if lang == "en":
        try:
            data = http_get_json("https://uselessfacts.jsph.pl/api/v2/facts/random?language=en", timeout=5)
            if data.get("text"):
                return {"ok": True, "source": "uselessfacts", "text": data["text"]}
        except Exception:  # noqa: BLE001
            pass
    return {"ok": True, "source": "offline", "text": random.choice(FALLBACK_FACTS[lang])}


# --- Коды погоды WMO, к которым мы приводим ответы всех источников -------

METNO_SYMBOLS = {
    "clearsky": 0, "fair": 1, "partlycloudy": 2, "cloudy": 3, "fog": 45,
    "lightrain": 61, "rain": 63, "heavyrain": 65, "lightsleet": 66, "sleet": 66,
    "heavysleet": 67, "lightsnow": 71, "snow": 73, "heavysnow": 75,
    "lightrainshowers": 80, "rainshowers": 80, "heavyrainshowers": 81,
    "lightsnowshowers": 85, "snowshowers": 85, "heavysnowshowers": 86,
    "lightrainandthunder": 95, "rainandthunder": 95, "heavyrainandthunder": 95,
    "snowandthunder": 95, "sleetandthunder": 95, "thunder": 95,
}

WTTR_KEYWORDS = [
    ("thunder", 95), ("blizzard", 75), ("hail", 96), ("sleet", 67),
    ("torrential rain", 82), ("heavy snow", 75), ("heavy rain", 65),
    ("moderate snow", 73), ("moderate rain", 63), ("patchy snow", 71),
    ("patchy rain", 61), ("light snow", 71), ("light rain", 61),
    ("drizzle", 51), ("shower", 80), ("snow showers", 85), ("snow", 73),
    ("rain", 63), ("mist", 45), ("fog", 45), ("haze", 45), ("overcast", 3),
    ("cloudy", 3), ("partly cloudy", 2), ("sunny", 0), ("clear", 0),
]


def metno_code(symbol: str) -> int:
    """Код погоды met.no (symbol_code) → код WMO."""
    symbol = (symbol or "").lower()
    if not symbol:
        return 3
    if "thunder" in symbol:
        return 95
    base = symbol.split("_")[0]
    return METNO_SYMBOLS.get(base, METNO_SYMBOLS.get(symbol, 3))


def wttr_code(text: str) -> int:
    """Текстовое описание wttr.in → код WMO."""
    low = (text or "").lower()
    for word, code in WTTR_KEYWORDS:
        if word in low:
            return code
    return 3


def _daily_from_metno(timeseries: list) -> list:
    """Суточный прогноз из почасового ряда met.no."""
    days: dict[str, dict] = {}
    for row in timeseries:
        when = row.get("time", "")[:10]
        if not when:
            continue
        temp = row.get("data", {}).get("instant", {}).get("details", {}).get("air_temperature")
        if temp is None:
            continue
        day = days.setdefault(when, {"date": when, "code": 3, "max": -100.0, "min": 100.0})
        day["max"] = max(day["max"], temp)
        day["min"] = min(day["min"], temp)
        symbol = (row.get("data", {}).get("next_6_hours", {}) or {}).get("summary", {}).get("symbol_code")
        if symbol and day["code"] == 3:
            day["code"] = metno_code(symbol)
    out = []
    for day in sorted(days.values(), key=lambda d: d["date"])[:5]:
        out.append({"date": day["date"], "code": day["code"],
                    "max": round(day["max"]), "min": round(day["min"])})
    return out


def weather_open_meteo(lat: float, lon: float, place: str, lang: str) -> dict:
    params = urllib.parse.urlencode({
        "latitude": f"{lat:.4f}", "longitude": f"{lon:.4f}",
        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,"
                   "precipitation,weather_code,wind_speed_10m",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min",
        "timezone": "auto", "forecast_days": "5",
    })
    data = http_get_json(f"https://api.open-meteo.com/v1/forecast?{params}", timeout=6)
    c = data["current"]
    return {
        "place": place or f"{lat:.2f}, {lon:.2f}",
        "temp": round(c["temperature_2m"]),
        "feels": round(c["apparent_temperature"]),
        "humidity": round(c["relative_humidity_2m"]),
        "wind": round(c["wind_speed_10m"]),
        "code": int(c["weather_code"]),
        "isDay": c.get("is_day") == 1,
        "daily": [{"date": d, "code": int(data["daily"]["weather_code"][i]),
                   "max": round(data["daily"]["temperature_2m_max"][i]),
                   "min": round(data["daily"]["temperature_2m_min"][i])}
                  for i, d in enumerate(data["daily"]["time"][:5])],
    }


def weather_metno(lat: float, lon: float, place: str) -> dict:
    """api.met.no — бесплатный прогноз Норвежского метеоинститута (нужен User-Agent)."""
    params = urllib.parse.urlencode({"lat": f"{lat:.4f}", "lon": f"{lon:.4f}"})
    data = http_get_json(f"https://api.met.no/weatherapi/locationforecast/2.0/compact?{params}", timeout=8)
    rows = data["properties"]["timeseries"]
    if not rows:
        raise ValueError("empty_metno")
    now = rows[0]
    details = now["data"]["instant"]["details"]
    symbol = (now["data"].get("next_1_hours") or now["data"].get("next_6_hours") or {}).get(
        "summary", {}).get("symbol_code", "cloudy")
    return {
        "place": place or f"{lat:.2f}, {lon:.2f}",
        "temp": round(details.get("air_temperature", 0)),
        "feels": round(details.get("air_temperature", 0)),
        "humidity": round(details.get("relative_humidity", 0)),
        "wind": round((details.get("wind_speed", 0) or 0) * 3.6),   # м/с → км/ч
        "code": metno_code(symbol),
        "isDay": "day" in symbol or "fair" in symbol or "clearsky" in symbol,
        "daily": _daily_from_metno(rows),
    }


def weather_wttr(lat: float, lon: float, place: str, city: str) -> dict:
    """wttr.in — ещё один бесплатный источник без ключа; работает и по названию города."""
    target = urllib.parse.quote(city) if city else f"{lat:.4f},{lon:.4f}"
    data = http_get_json(f"https://wttr.in/{target}?format=j1&lang=en", timeout=8)
    cur = (data.get("current_condition") or [{}])[0]
    if not cur:
        raise ValueError("empty_wttr")
    desc = ((cur.get("weatherDesc") or [{}])[0]).get("value", "")
    area = ((data.get("nearest_area") or [{}])[0])
    area_name = ((area.get("areaName") or [{}])[0]).get("value", "")
    country = ((area.get("country") or [{}])[0]).get("value", "")
    hour = 12
    match = re.search(r"(\d{2}):(\d{2})", str(cur.get("localObsDateTime", "")))
    if match:
        hour = int(match.group(1))
    daily = []
    for day in (data.get("weather") or [])[:5]:
        hourly = day.get("hourly") or []
        mid = hourly[4] if len(hourly) > 4 else (hourly[0] if hourly else {})
        mid_desc = ((mid.get("weatherDesc") or [{}])[0]).get("value", "")
        daily.append({
            "date": day.get("date", ""),
            "code": wttr_code(mid_desc or desc),
            "max": round(float(day.get("maxtempC", 0))),
            "min": round(float(day.get("mintempC", 0))),
        })
    return {
        "place": place or ", ".join(x for x in (area_name, country) if x) or f"{lat:.2f}, {lon:.2f}",
        "temp": round(float(cur.get("temp_C", 0))),
        "feels": round(float(cur.get("FeelsLikeC", cur.get("temp_C", 0)))),
        "humidity": round(float(cur.get("humidity", 0))),
        "wind": round(float(cur.get("windspeedKmph", 0))),
        "code": wttr_code(desc),
        "isDay": 6 <= hour < 21,
        "daily": daily,
    }


def geocode(query: str, lang: str) -> tuple[float, float, str]:
    """Координаты города: сначала Open-Meteo, потом Nominatim (OpenStreetMap)."""
    try:
        params = urllib.parse.urlencode({"name": query, "count": 1, "language": lang, "format": "json"})
        data = http_get_json(f"https://geocoding-api.open-meteo.com/v1/search?{params}", timeout=6)
        hit = (data.get("results") or [])[0]
        place = ", ".join(x for x in (hit.get("name"), hit.get("country_code")) if x)
        return float(hit["latitude"]), float(hit["longitude"]), place
    except Exception:  # noqa: BLE001
        pass
    params = urllib.parse.urlencode({"q": query, "format": "json", "limit": 1, "accept-language": lang})
    data = http_get_json(f"https://nominatim.openstreetmap.org/search?{params}", timeout=8)
    hit = data[0]
    name = (hit.get("display_name") or "").split(",")[0]
    return float(hit["lat"]), float(hit["lon"]), name


def fetch_weather(query: dict) -> dict:
    """Погода с каскадом источников: Open-Meteo → met.no → wttr.in.

    Если геокодеры недоступны, координаты могут остаться неизвестными — тогда
    wttr.in спрашиваем сразу по названию города (ему координаты не нужны).
    """
    lang = "ru" if query.get("lang", ["ru"])[0] == "ru" else "en"
    city = (query.get("q") or [""])[0].strip()
    lat_raw = (query.get("lat") or [""])[0]
    lon_raw = (query.get("lon") or [""])[0]
    place = (query.get("place") or [""])[0].strip()
    lat = lon = None
    try:
        lat, lon = float(lat_raw), float(lon_raw)
    except (TypeError, ValueError):
        lat = lon = None
    errors: list[str] = []
    if lat is None and city:
        try:
            lat, lon, place = geocode(city, lang)
        except Exception as exc:  # noqa: BLE001 — координаты не обязательны, есть wttr.in
            errors.append(f"geocode: {type(exc).__name__}")
    if lat is None and not city:
        return {"ok": False, "error": "bad_request"}

    key = "city:" + city.lower() if lat is None else f"{lat:.3f},{lon:.3f}"
    cached = ext_cache.get(f"weather:{key}")
    if cached and time.time() - cached[0] < 600:
        payload = dict(cached[1])
        payload["cached"] = True
        return payload

    if lat is not None:
        sources = [
            ("open-meteo", lambda: weather_open_meteo(lat, lon, place, lang)),
            ("met.no", lambda: weather_metno(lat, lon, place)),
            ("wttr.in", lambda: weather_wttr(lat, lon, place, city)),
        ]
    else:
        sources = [("wttr.in", lambda: weather_wttr(0.0, 0.0, place, city))]

    for name, call in sources:
        try:
            payload = call()
            payload.update({"ok": True, "source": name, "place": payload.get("place") or place or city,
                            "updated": now_ms(), "lat": lat, "lon": lon})
            ext_cache[f"weather:{key}"] = (time.time(), payload)
            return payload
        except Exception as exc:  # noqa: BLE001 — пробуем следующий источник
            errors.append(f"{name}: {type(exc).__name__}")
    return {"ok": False, "error": "offline", "tried": errors}


def fetch_rates() -> dict:
    cached = ext_cache.get("rates")
    if cached and time.time() - cached[0] < 600:
        return cached[1]
    result: dict = {"ok": True, "fiat": {}, "crypto": {}, "updated": now_ms(), "sources": []}
    try:
        data = http_get_json("https://www.cbr-xml-daily.ru/daily_json.js", timeout=6)
        valute = data.get("Valute", {})
        for code in ("USD", "EUR", "CNY", "GBP", "JPY", "KZT"):
            item = valute.get(code)
            if item:
                nominal = item.get("Nominal", 1) or 1
                result["fiat"][code] = {
                    "value": round(item["Value"] / nominal, 4),
                    "previous": round(item.get("Previous", item["Value"]) / nominal, 4),
                }
        result["sources"].append("cbr")
    except Exception:  # noqa: BLE001
        pass
    if not result["fiat"]:
        try:
            data = http_get_json("https://open.er-api.com/v6/latest/USD", timeout=6)
            rates = data.get("rates", {})
            rub = rates.get("RUB")
            if rub:
                result["fiat"]["USD"] = {"value": round(rub, 4), "previous": round(rub, 4)}
                for code in ("EUR", "CNY", "GBP"):
                    if rates.get(code):
                        v = rub / rates[code]
                        result["fiat"][code] = {"value": round(v, 4), "previous": round(v, 4)}
                result["sources"].append("er-api")
        except Exception:  # noqa: BLE001
            pass
    try:
        data = http_get_json(
            "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,the-open-network"
            "&vs_currencies=usd,rub&include_24hr_change=true", timeout=6)
        for key, label in (("bitcoin", "BTC"), ("ethereum", "ETH"), ("the-open-network", "TON")):
            item = data.get(key)
            if item:
                result["crypto"][label] = {
                    "usd": item.get("usd"),
                    "rub": item.get("rub"),
                    "change": round(item.get("usd_24h_change", 0) or 0, 2),
                }
        result["sources"].append("coingecko")
    except Exception:  # noqa: BLE001
        pass
    if not result["fiat"] and not result["crypto"]:
        result["ok"] = False
        result["error"] = "offline"
    ext_cache["rates"] = (time.time(), result)
    return result


# --------------------------------------------------------------------------- #
# HTTP-обработчик
# --------------------------------------------------------------------------- #

class RoomHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".webmanifest": "application/manifest+json",
        ".svg": "image/svg+xml",
        ".json": "application/json; charset=utf-8",
    }

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def handle(self) -> None:
        # Клиент может закрыть соединение раньше ответа (например, ушёл со страницы,
        # пока сервер ждал внешний API) — это не ошибка сервера, трассировку не печатаем.
        try:
            super().handle()
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError, TimeoutError):
            pass

    def log_message(self, format, *args):  # noqa: A002 — сигнатура stdlib
        if args and isinstance(args[0], str) and ("/api/" in args[0] or "/ws" in args[0]):
            return
        super().log_message(format, *args)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        if not self.path.startswith("/api/"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    # --- GET -----------------------------------------------------------------
    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        if path == "/api/room":
            with lock:
                room = get_room(query.get("room", ["MAIN"])[0], create=False)
                payload = room.snapshot() if room else {"multiplayer": True, "room": None, "users": [], "feed": []}
                payload["rooms"] = rooms_summary()
                payload["lanUrl"] = f"http://{LAN_IP}:{PORT}/"
            self._json_response(payload)
            return
        if path == "/api/rooms":
            with lock:
                self._json_response({"rooms": rooms_summary(), "lanUrl": f"http://{LAN_IP}:{PORT}/"})
            return
        if path == "/api/health":
            with lock:
                self._json_response({"ok": True, "rooms": len(rooms), "users": sum(len(r.users) for r in rooms.values()),
                                     "time": now_ms()})
            return
        if path == "/api/journal":
            code = normalize_room_code(query.get("room", ["MAIN"])[0])
            try:
                limit = max(1, min(MAX_JOURNAL, int(query.get("limit", ["200"])[0])))
            except (TypeError, ValueError):
                limit = 200
            with lock:
                room = get_room(code, create=False)
                entries = room.journal[-limit:] if room else []
            self._json_response({"ok": True, "room": code, "entries": entries})
            return
        if path == "/api/events":
            self._sse_stream(query.get("room", ["MAIN"])[0], query.get("userId", [""])[0])
            return
        if path == "/ws":
            self._websocket(query.get("room", ["MAIN"])[0], query.get("userId", [""])[0])
            return
        if path == "/api/ext/quote":
            self._json_response(fetch_quote(query.get("lang", ["ru"])[0]))
            return
        if path == "/api/ext/fact":
            self._json_response(fetch_fact(query.get("lang", ["ru"])[0]))
            return
        if path == "/api/ext/rates":
            self._json_response(fetch_rates())
            return
        if path == "/api/ext/weather":
            self._json_response(fetch_weather(query))
            return
        if path == "/":
            self.path = "/index.html"
        # Не отдаём наружу исходники сервера, скрипты запуска и скрытые файлы/папки (.git и т. п.).
        parts = [p for p in path.split("/") if p]
        name = parts[-1] if parts else ""
        if any(p.startswith(".") for p in parts) or name.endswith((".py", ".sh", ".ps1", ".bat", ".txt")):
            self.send_error(404, "Not found")
            return
        super().do_GET()

    # --- POST ----------------------------------------------------------------
    def do_POST(self):
        path = urlparse(self.path).path
        if path == "/api/upload":
            self._handle_upload()
            return
        body = self._read_json()
        if path == "/api/join":
            self._handle_join(body)
            return
        if path == "/api/message":
            room_code = body.get("room", "MAIN")
            uid = str(body.get("userId", ""))
            with lock:
                room = get_room(room_code, create=False)
                if not room:
                    self._json_response({"ok": False, "error": "no_room"}, 404)
                    return
                resp = handle_message(room, uid, body)
            self._json_response(resp, 200 if resp.get("ok") else 400)
            return
        # Совместимость со старым клиентом
        if path == "/api/ping":
            with lock:
                room = get_room(body.get("room", "MAIN"), create=False)
                if room:
                    handle_message(room, str(body.get("userId", "")), {"kind": "ping"})
            self._json_response({"ok": True})
            return
        if path == "/api/action":
            with lock:
                room = get_room(body.get("room", "MAIN"), create=False)
                if not room:
                    self._json_response({"ok": False, "error": "no_room"}, 404)
                    return
                resp = handle_message(room, str(body.get("userId", "")), {**body, "kind": "action"})
            self._json_response(resp, 200 if resp.get("ok") else 400)
            return
        self.send_error(404)

    # --- утилиты -------------------------------------------------------------
    def _handle_upload(self) -> None:
        """Принимает файл «сырым» телом (fetch POST с X-File-Name) — multipart не нужен."""
        try:
            length = int(self.headers.get("Content-Length", 0) or 0)
        except (TypeError, ValueError):
            length = 0
        if length <= 0:
            self._json_response({"ok": False, "error": "empty"}, 400)
            return
        if length > MAX_UPLOAD_BYTES:
            self._json_response({"ok": False, "error": "too_big"}, 413)
            return
        data = self.rfile.read(length)
        filename = unquote(self.headers.get("X-File-Name", "file") or "file")
        self._json_response(save_upload(data, filename), 200 if True else 200)

    def _read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", 0) or 0)
        if length <= 0 or length > 2_000_000:
            return {}
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
            return data if isinstance(data, dict) else {}
        except (json.JSONDecodeError, UnicodeDecodeError):
            return {}

    def _json_response(self, payload: dict, code: int = 200) -> None:
        data = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def _handle_join(self, body: dict) -> None:
        name = clean_text(body.get("name"), 32)
        if not name:
            self._json_response({"ok": False, "error": "name_required"}, 400)
            return
        avatar = clean_text(body.get("avatar"), 8) or "🙂"
        tz = clean_text(body.get("tz"), 64)
        wanted_id = clean_text(body.get("userId"), 40)
        with lock:
            code = body.get("room")
            if body.get("createRoom"):
                code = generate_room_code()
            room = get_room(code or "MAIN", create=True)
            room.prune()
            user_id = wanted_id if (wanted_id and wanted_id not in room.users and len(wanted_id) >= 8) else str(uuid.uuid4())
            state = dict(DEFAULT_STATE)
            if isinstance(body.get("state"), dict):
                apply_state_patch({"state": state}, body["state"])
            room.users[user_id] = {
                "name": name,
                "avatar": avatar,
                "tz": tz,
                "color": room.pick_color(),
                "lastSeen": time.time(),
                "joinedAt": time.time(),
                "status": "active",
                "likes": 0,
                "follow": False,
                "state": state,
            }
            room.ensure_host()
            entry = room.push_feed(user_id, name, "join", f"{name} подключился", "feed.join", {"name": name})
            room.broadcast({"type": "feed", "entry": entry, "users": room.users_public(), "hostId": room.host_id})
            snap = room.snapshot()
            payload = {
                "ok": True,
                "userId": user_id,
                "userName": name,
                "role": "host" if room.host_id == user_id else "member",
                "lanUrl": f"http://{LAN_IP}:{PORT}/",
                **snap,
            }
        self._json_response(payload)

    # --- SSE -----------------------------------------------------------------
    def _sse_stream(self, room_code: str, uid: str = "") -> None:
        client_q: queue.Queue = queue.Queue(maxsize=300)
        client = SSEClient(client_q, uid)
        with lock:
            room = get_room(room_code, create=True)
            room.sse.append(client)
            first = {"type": "snapshot", **room.snapshot()}

        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream; charset=utf-8")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        def send_obj(obj) -> bool:
            try:
                data = obj if isinstance(obj, str) else json.dumps(obj, ensure_ascii=False)
                self.wfile.write(f"data: {data}\n\n".encode("utf-8"))
                self.wfile.flush()
                return True
            except (BrokenPipeError, ConnectionResetError, OSError):
                return False

        try:
            if not send_obj(first):
                return
            while True:
                try:
                    payload = client_q.get(timeout=25)
                    if not send_obj(payload):
                        break
                except queue.Empty:
                    if not send_obj({"type": "ping"}):
                        break
        finally:
            with lock:
                if client in room.sse:
                    room.sse.remove(client)

    # --- WebSocket -----------------------------------------------------------
    def _websocket(self, room_code: str, uid: str) -> None:
        key = self.headers.get("Sec-WebSocket-Key")
        if self.headers.get("Upgrade", "").lower() != "websocket" or not key:
            self._json_response({"ok": False, "error": "not_websocket"}, 400)
            return
        accept = base64.b64encode(hashlib.sha1((key + WS_GUID).encode("ascii")).digest()).decode("ascii")
        self.send_response(101, "Switching Protocols")
        self.send_header("Upgrade", "websocket")
        self.send_header("Connection", "Upgrade")
        self.send_header("Sec-WebSocket-Accept", accept)
        self.end_headers()
        self.wfile.flush()
        self.connection.settimeout(None)

        client = WSClient(self.wfile, uid)
        with lock:
            room = get_room(room_code, create=True)
            room.ws.append(client)
            client.put(json.dumps({"type": "snapshot", **room.snapshot()}, ensure_ascii=False))

        buffer = bytearray()
        try:
            while client.alive:
                frame = self._ws_read_frame()
                if frame is None:
                    break
                fin, opcode, payload = frame
                if opcode == 0x8:
                    break
                if opcode == 0x9:
                    client.send_frame(0xA, payload)
                    continue
                if opcode == 0xA:
                    continue
                if opcode in (0x1, 0x2, 0x0):
                    buffer += payload
                    if not fin:
                        continue
                    raw, buffer = bytes(buffer), bytearray()
                    try:
                        msg = json.loads(raw.decode("utf-8"))
                    except (ValueError, UnicodeDecodeError):
                        continue
                    if not isinstance(msg, dict):
                        continue
                    with lock:
                        resp = handle_message(room, str(msg.get("userId") or uid), msg)
                    req_id = msg.get("reqId")
                    if req_id is not None or not resp.get("ok"):
                        client.put(json.dumps({"type": "reply", "reqId": req_id, **resp}, ensure_ascii=False))
        except (ConnectionResetError, BrokenPipeError, OSError, struct.error):
            pass
        finally:
            client.close()
            with lock:
                if client in room.ws:
                    room.ws.remove(client)

    def _ws_read_exact(self, n: int) -> bytes | None:
        chunks = bytearray()
        while len(chunks) < n:
            part = self.rfile.read(n - len(chunks))
            if not part:
                return None
            chunks += part
        return bytes(chunks)

    def _ws_read_frame(self):
        head = self._ws_read_exact(2)
        if head is None:
            return None
        fin = bool(head[0] & 0x80)
        opcode = head[0] & 0x0F
        masked = bool(head[1] & 0x80)
        length = head[1] & 0x7F
        if length == 126:
            raw = self._ws_read_exact(2)
            if raw is None:
                return None
            length = struct.unpack(">H", raw)[0]
        elif length == 127:
            raw = self._ws_read_exact(8)
            if raw is None:
                return None
            length = struct.unpack(">Q", raw)[0]
        if length > 2_000_000:
            return None
        mask = self._ws_read_exact(4) if masked else None
        payload = self._ws_read_exact(length) if length else b""
        if payload is None:
            return None
        if mask:
            payload = bytes(b ^ mask[i & 3] for i, b in enumerate(payload))
        return fin, opcode, payload


class ReuseHTTPServer(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True


def raise_system_exit():
    raise SystemExit(0)


def main() -> None:
    try:
        server = ReuseHTTPServer(("0.0.0.0", PORT), RoomHandler)
    except OSError as err:
        if err.errno in (48, 98):
            print(f"Ошибка: порт {PORT} уже занят.")
            print("Выполните: ./stop-server.sh  (или закройте другое окно терминала с сервером)")
            raise SystemExit(1) from err
        raise

    restored = 0
    with lock:
        restored = load_rooms()
    threading.Thread(target=housekeeping, daemon=True).start()
    threading.Thread(target=persist_worker, daemon=True).start()
    atexit.register(lambda: save_rooms())
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            signal.signal(sig, lambda *_: (save_rooms(), raise_system_exit()))
        except (ValueError, OSError):
            pass
    print("Motion Playground — совместный режим (комнаты, чат, WebSocket, игры)")
    print(f"  На этом компьютере:  http://127.0.0.1:{PORT}")
    print(f"  В локальной сети:    http://{LAN_IP}:{PORT}")
    print(f"  Восстановлено комнат из data/rooms.json: {restored}")
    print("  Остановка: Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nСервер остановлен.")


if __name__ == "__main__":
    main()
