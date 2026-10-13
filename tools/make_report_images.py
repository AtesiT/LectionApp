#!/usr/bin/env python3
"""Рисует схемы и макеты интерфейса для отчёта (PNG).

В среде разработки нет браузера и SVG-рендерера, поэтому рисунки
собираются примитивами ImageMagick (MVG) со шрифтом DejaVu.

Запуск:  python3 tools/make_report_images.py
Результат: report/img/*.png (схемы для отчёта и для презентации)
"""
import os
import subprocess
import sys
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "report", "img")

BG = "#ffffff"
INK = "#111827"
MUTED = "#4b5563"
LINE = "#94a3b8"
ACCENT = "#0ea5e9"
ACCENT2 = "#7c3aed"
DARK = "#0b1020"
PANEL = "#f1f5f9"
CARD = "#ffffff"
OK = "#16a34a"
WARN = "#f59e0b"
DANGER = "#dc2626"

# Средние коэффициенты ширины символа для DejaVu Sans (доля от размера шрифта).
_WIDE = set("АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯABCDEFGHIJKLMNOPQRSTUVWXYZ№")
_NARROW = set(" .,:;'|!iíjlтгуузх") if False else set(" .,:;'|!ijlтг")
_MID = set("0123456789-+=/<>%#*")


def text_w(s, size):
    total = 0.0
    for ch in s:
        if ch in _WIDE:
            total += 0.68
        elif ch in _NARROW:
            total += 0.30
        elif ch in _MID:
            total += 0.55
        else:
            total += 0.56
    return total * size


class Canvas:
    def __init__(self, w, h, bg=BG):
        self.w, self.h, self.bg = w, h, bg
        self.shapes = []
        self.text = []          # обычный шрифт
        self.bold = []          # полужирный шрифт

    # --- примитивы -------------------------------------------------------
    def rect(self, x0, y0, x1, y1, fill="none", stroke=None, sw=1, r=0):
        if x1 < x0:
            x0, x1 = x1, x0
        if y1 < y0:
            y0, y1 = y1, y0
        if r:
            r = min(r, max(0.0, (x1 - x0) / 2.0), max(0.0, (y1 - y0) / 2.0))
        cmd = []
        if stroke:
            cmd.append(f"stroke '{stroke}'")
            cmd.append(f"stroke-width {sw}")
        else:
            cmd.append("stroke 'none'")
        if fill and fill != "none":
            cmd.append(f"fill '{fill}'")
        else:
            cmd.append("fill 'none'")
        if r:
            cmd.append(f"roundRectangle {round(x0)},{round(y0)} {round(x1)},{round(y1)} {r},{r}")
        else:
            cmd.append(f"rectangle {round(x0)},{round(y0)} {round(x1)},{round(y1)}")
        self.shapes.append("\n".join(cmd))

    def line(self, x0, y0, x1, y1, color=LINE, sw=1, dash=False):
        self.shapes.append(
            f"stroke '{color}'\nstroke-width {sw}\n"
            + ("stroke-dasharray 6,4\n" if dash else "")
            + f"fill 'none'\nline {round(x0)},{round(y0)} {round(x1)},{round(y1)}"
        )

    def arrow(self, x0, y0, x1, y1, color=LINE, sw=2):
        self.line(x0, y0, x1, y1, color, sw)
        import math
        ang = math.atan2(y1 - y0, x1 - x0)
        size = 8
        for sign in (2.6, -2.6):
            ax = x1 - size * math.cos(ang + sign)
            ay = y1 - size * math.sin(ang + sign)
            self.line(ax, ay, x1, y1, color, sw)

    def circle(self, cx, cy, r, fill="none", stroke=LINE, sw=1):
        self.shapes.append(
            f"stroke '{stroke}'\nstroke-width {sw}\nfill '{fill}'\n"
            f"circle {round(cx)},{round(cy)} {round(cx + r)},{round(cy)}"
        )

    def polygon(self, points, fill="none", stroke=LINE, sw=1):
        pts = " ".join(f"{round(x)},{round(y)}" for x, y in points)
        self.shapes.append(
            f"stroke '{stroke}'\nstroke-width {sw}\nfill '{fill}'\npolygon {pts}"
        )

    # --- текст -----------------------------------------------------------
    def label(self, x, y, s, size=14, color=INK, bold=False, anchor="left", maxw=None, lh=None):
        """y — базовая линия первой строки. Возвращает y следующей строки."""
        lh = lh or int(size * 1.35)
        if maxw:
            lines = self.wrap(s, size, maxw)
        else:
            lines = s.split("\n")
        out = self.bold if bold else self.text
        for i, line in enumerate(lines):
            if anchor == "left":
                tx = x
            elif anchor == "center":
                tx = x - text_w(line, size) / 2
            else:
                tx = x - text_w(line, size)
            out.append(f"fill '{color}'\nfont-size {size}\ntext {round(tx)},{round(y + i * lh)} '{line}'")
        return y + len(lines) * lh

    def wrap(self, s, size, maxw):
        lines, cur = [], ""
        for word in s.split():
            probe = (cur + " " + word).strip()
            if text_w(probe, size) <= maxw or not cur:
                cur = probe
            else:
                lines.append(cur)
                cur = word
        if cur:
            lines.append(cur)
        return lines or [""]

    # --- рендер ----------------------------------------------------------
    def render(self, path):
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with tempfile.TemporaryDirectory() as tmp:
            files = []
            for name, cmds in (("shapes", self.shapes), ("text", self.text), ("bold", self.bold)):
                fpath = os.path.join(tmp, name + ".mvg")
                with open(fpath, "w", encoding="utf-8") as fh:
                    fh.write("\n".join(cmds) + ("\n" if cmds else ""))
                files.append(fpath)
            cmd = ["convert", "-size", f"{self.w}x{self.h}", f"xc:{self.bg}",
                   "-font", "DejaVu-Sans", "-draw", "@" + files[0],
                   "-font", "DejaVu-Sans", "-draw", "@" + files[1],
                   "-font", "DejaVu-Sans-Bold", "-draw", "@" + files[2],
                   "-strip", path]
            res = subprocess.run(cmd, capture_output=True, text=True)
            if res.returncode != 0:
                print("ОШИБКА convert:", res.stderr.strip()[:400], file=sys.stderr)
                return False
        size = os.path.getsize(path)
        print(f"  {os.path.relpath(path, ROOT)}  ({self.w}×{self.h}, {size // 1024} КБ)")
        return True


def box(c, x, y, w, h, title, lines, fill=CARD, stroke=LINE, title_size=15, body_size=12,
        title_color=INK, body_color=MUTED, accent=None):
    """Прямоугольник с заголовком и списком строк."""
    c.rect(x, y, x + w, y + h, fill, stroke, 1.2, r=8)
    if accent:
        c.rect(x, y, x + 6, y + h, accent, None, 0, r=3)
    ty = c.label(x + 16, y + 28, title, title_size, title_color, bold=True, maxw=w - 28)
    for line in lines:
        ty = c.label(x + 16, ty + 6, line, body_size, body_color, maxw=w - 28)
    return ty


# =====================================================================
# Рисунок 1. Архитектура
# =====================================================================
def fig_architecture(path):
    c = Canvas(1240, 730)
    c.label(40, 44, "Рисунок 1 — Архитектура приложения Motion Playground", 20, INK, bold=True)

    # Клиент
    c.rect(40, 70, 470, 640, "#f8fafc", LINE, 1.2, r=10)
    c.label(60, 104, "Клиент (браузер)", 17, INK, bold=True)
    box(c, 60, 120, 190, 92, "Представление", ["index.html — разметка", "styles.css — темы, адаптив"], accent=ACCENT)
    box(c, 265, 120, 185, 92, "Логика сцены", ["js/scene — фигуры,", "анимации, 3D, эффекты"], accent=ACCENT)
    box(c, 60, 226, 190, 92, "Интерфейс", ["js/ui — панели,", "таймлайн, палитра"], accent=ACCENT)
    box(c, 265, 226, 185, 92, "Сеть", ["js/net — WS/SSE,", "сессия, звонок, игры"], accent=ACCENT)
    box(c, 60, 332, 190, 92, "Ядро", ["js/core — состояние,", "i18n, GIF, плагины"], accent=ACCENT)
    box(c, 265, 332, 185, 92, "Возможности", ["js/features — звук,", "игры, песочница"], accent=ACCENT)
    box(c, 60, 438, 390, 92, "Плагины и PWA", ["window.__motion — открытый API", "sw.js — офлайн-кэш оболочки"], accent=ACCENT2)
    c.label(60, 566, "Никаких сборщиков и внешних библиотек:", 13, MUTED, bold=True, maxw=390)
    c.label(60, 588, "браузер открывает обычные ES-модули.", 13, MUTED, maxw=390)
    c.rect(60, 600, 450, 628, PANEL, LINE, 1, r=6)
    c.label(76, 620, "Canvas 2D · Web Animations · WebAudio · WebRTC · MediaRecorder", 12, MUTED, maxw=360)

    # Сервер
    c.rect(770, 70, 1200, 640, "#f8fafc", LINE, 1.2, r=10)
    c.label(790, 104, "Сервер room_server.py", 17, INK, bold=True)
    box(c, 790, 120, 190, 92, "Транспорт", ["WebSocket (RFC 6455)", "SSE — запасной канал"], accent=ACCENT2)
    box(c, 995, 120, 185, 92, "REST", ["/api/join, /api/room", "/api/journal, /api/upload"], accent=ACCENT2)
    box(c, 790, 226, 190, 92, "Комнаты", ["участники, роли, чат", "опросы, доска, лента"], accent=ACCENT2)
    box(c, 995, 226, 185, 92, "Игры", ["шахматы,", "крестики-нолики"], accent=ACCENT2)
    box(c, 790, 332, 190, 92, "Хранилище", ["data/rooms.json", "uploads/ — медиа"], accent=ACCENT2)
    box(c, 995, 332, 185, 92, "Журнал", ["история занятия", "выгрузка в Markdown"], accent=ACCENT2)
    box(c, 790, 438, 390, 92, "Прокси внешних API", ["погода: Open-Meteo, met.no, wttr.in", "курсы ЦБ РФ, цитаты и факты"], accent=ACCENT2)
    c.label(790, 566, "Только стандартная библиотека Python 3.10+", 13, MUTED, bold=True, maxw=390)
    c.label(790, 588, "http.server + потоки; зависимости не нужны.", 13, MUTED, maxw=390)

    # Связи
    c.arrow(475, 240, 765, 240, ACCENT, 2)
    c.label(500, 226, "WebSocket / SSE — состояния, чат, доска, игры", 12, MUTED, maxw=250)
    c.arrow(765, 300, 475, 300, ACCENT2, 2)
    c.label(500, 322, "ответы сервера, снимки комнаты, журнал", 12, MUTED, maxw=250)
    c.arrow(475, 400, 765, 400, OK, 2)
    c.label(500, 384, "REST: вход, загрузка медиа, журнал", 12, MUTED, maxw=250)

    # Прямой канал звонка
    c.line(150, 660, 1090, 660, DANGER, 2, dash=True)
    c.arrow(150, 660, 620, 660, DANGER, 2)
    c.arrow(1090, 660, 620, 660, DANGER, 2)
    c.label(400, 690, "WebRTC: видео, голос и экран идут напрямую между браузерами (сервер только сигналинг)",
            12, DANGER, bold=True, maxw=680, anchor="center")
    return c.render(path)


# =====================================================================
# Рисунок 2. Главное окно
# =====================================================================
def fig_main(path):
    c = Canvas(1240, 800)
    c.label(40, 40, "Рисунок 2 — Главное окно приложения (схема интерфейса)", 20, INK, bold=True)

    # Верхняя панель
    c.rect(40, 60, 1200, 116, "#0f172a", None, 0, r=10)
    c.circle(70, 88, 14, ACCENT)
    c.label(96, 94, "Motion Playground", 15, "#e2e8f0", bold=True)
    chips = [("Комната MAIN", ACCENT), ("В сети · WS", OK), ("12:45", "#334155"), ("Погода −3", "#334155")]
    x = 280
    for text, color in chips:
        w = text_w(text, 13) + 26
        c.rect(x, 74, x + w, 102, color, None, 0, r=14)
        c.label(x + 13, 93, text, 13, "#04121f", bold=True)
        x += w + 10
    x = 900
    for glyph in ["↶", "↷", "S", "N", "P", "F", "?", "EN"]:
        c.rect(x, 74, x + 32, 102, "#1e293b", None, 0, r=8)
        c.label(x + 16, 94, glyph, 13, "#e2e8f0", bold=True, anchor="center")
        x += 38

    # Сцена
    c.rect(40, 132, 900, 560, DARK, LINE, 1.2, r=14)
    c.rect(52, 144, 888, 548, "#0ea5e9", None, 0, r=10)
    for i in range(24):                        # снег
        import random
        random.seed(7 + i)
        cx0 = 70 + i * 34
        cy0 = 170 + (i * 53) % 330
        c.circle(cx0, cy0, 2.5, "#e8f6ff")
    # объект-звезда
    cx0, cy0 = 470, 360
    import math
    pts = []
    for i in range(10):
        r = 78 if i % 2 == 0 else 34
        a = -math.pi / 2 + i * math.pi / 5
        pts.append((cx0 + r * math.cos(a), cy0 + r * math.sin(a)))
    c.polygon(pts, "#38bdf8", "#e0f2fe", 2)
    c.label(cx0, 366, "объект", 13, "#082f49", bold=True, anchor="center")
    c.rect(300, 300, 640, 420, "#00000000" if False else "none")
    # траектория
    for i in range(40):
        a = i * math.pi / 20
        c.circle(cx0 + 150 * math.cos(a), cy0 + 90 * math.sin(a), 1.5, "#a5f3fc")
    # панель инструментов сцены
    c.rect(240, 500, 660, 542, "#0f172a", None, 0, r=16)
    for i, text in enumerate(["Старт", "Стоп", "Случайно", "Доска", "Микрофон", "Голос"]):
        bx = 252 + i * 68
        c.rect(bx, 508, bx + 62, 534, "#1e293b" if i else ACCENT, None, 0, r=8)
        c.label(bx + 31, 527, text, 11, "#e2e8f0", bold=True, anchor="center")
    c.label(300, 250, "фон сцены, эффекты (снег), погода, слой общей доски", 13, "#0b3b52", bold=True, anchor="center")

    # Витрина участников
    c.rect(916, 132, 1200, 560, CARD, LINE, 1.2, r=14)
    c.label(936, 164, "Участники · 3", 15, INK, bold=True)
    names = ["Алексей (ведущий)", "Мария", "Иван"]
    colors = ["#38bdf8", "#f472b6", "#34d399"]
    for i, (name, color) in enumerate(zip(names, colors)):
        y = 182 + i * 118
        c.rect(932, y, 1184, y + 104, PANEL, LINE, 1, r=10)
        c.rect(944, y + 12, 1072, y + 92, DARK, None, 0, r=8)
        c.circle(1008, y + 52, 24, color)
        c.label(1078, y + 58, name, 12, MUTED, bold=True)
        c.label(1078, y + 76, "сцена участника", 11, MUTED)

    # Вкладки
    c.rect(40, 576, 1200, 620, PANEL, LINE, 1, r=10)
    tabs = ["Объект", "Анимации", "Таймлайн", "3D", "Сцена", "Звук", "Сессия", "Мини-игры", "Песочница", "Виджеты", "Достижения", "Справка"]
    x = 52
    for i, t in enumerate(tabs):
        w = text_w(t, 13) + 26
        if x + w > 1192:
            break
        c.rect(x, 586, x + w, 610, ACCENT if i == 0 else CARD, LINE, 1, r=12)
        c.label(x + 13, 604, t, 13, "#04121f" if i == 0 else INK, bold=(i == 0))
        x += w + 8

    # Карточки панели
    cards = [
        ("Фигура", ["11 типов: круг, квадрат,", "звезда, сердце, текст,", "картинка, видео…"]),
        ("Анимации", ["20 анимаций, скорость,", "избранное, поиск", "и сочетания"]),
        ("Свойства", ["цвет, размер, обводка,", "свечение, скругление,", "прозрачность"]),
        ("Физика", ["гравитация, отскоки,", "столкновения,", "бросок мышью"]),
    ]
    for i, (title, lines) in enumerate(cards):
        x = 40 + i * 292
        box(c, x, 636, 280, 150, title, lines)

    return c.render(path)


# =====================================================================
# Рисунок 3. Таймлайн
# =====================================================================
def fig_timeline(path):
    c = Canvas(1240, 660)
    c.label(40, 40, "Рисунок 3 — Панель «Таймлайн»: ключевые кадры объекта", 20, INK, bold=True)

    c.rect(40, 60, 1200, 640, CARD, LINE, 1.2, r=12)
    c.label(64, 96, "Таймлайн (ключевые кадры)", 17, INK, bold=True)
    c.rect(1000, 74, 1176, 104, PANEL, LINE, 1, r=14)
    c.label(1016, 96, "0.00 / 8.0 с", 13, INK, bold=True)

    # панель инструментов
    c.rect(64, 116, 900, 176, PANEL, LINE, 1, r=8)
    c.label(80, 142, "Свойство", 12, MUTED)
    c.rect(80, 148, 250, 170, CARD, LINE, 1, r=6)
    c.label(92, 164, "Размер", 13, INK)
    for i, t in enumerate(["+ Ключ", "Удалить ключ", "Очистить"]):
        bx = 270 + i * 130
        c.rect(bx, 138, bx + 118, 166, CARD, LINE, 1, r=8)
        c.label(bx + 59, 157, t, 12, INK, anchor="center")
    c.label(660, 142, "Длительность: 8.0 с", 12, MUTED)
    c.line(660, 160, 860, 160, LINE, 3)
    c.circle(760, 160, 7, ACCENT, ACCENT, 1)
    c.rect(880, 138, 900, 158, CARD, LINE, 1, r=4)
    c.label(906, 156, "Зациклить", 12, INK)

    # шкала
    c.rect(64, 196, 1130, 226, PANEL, LINE, 1, r=6)
    for i in range(9):
        x = 74 + i * 117
        c.line(x, 226, x, 216, LINE, 1)
        c.label(x, 214, f"{i}.0", 10, MUTED, anchor="center")
    c.line(560, 190, 560, 232, ACCENT, 3)
    c.circle(560, 190, 6, ACCENT, ACCENT, 1)
    c.label(64, 188, "PLAY", 12, INK, bold=True)
    c.label(140, 188, "STOP", 12, INK, bold=True)

    # дорожки
    tracks = [
        ("X", ["#38bdf8", "#38bdf8", "#38bdf8"], [0.05, 0.45, 0.85]),
        ("Размер", ["#7c3aed", "#7c3aed", "#7c3aed", "#7c3aed"], [0.05, 0.3, 0.6, 0.9]),
        ("Цвет", ["#22c55e", "#eab308", "#ef4444"], [0.1, 0.5, 0.85]),
        ("Свечение", ["#f97316", "#f97316"], [0.2, 0.75]),
    ]
    y = 250
    for name, colors, pos in tracks:
        c.rect(64, y, 1130, y + 56, PANEL, LINE, 1, r=8)
        c.label(80, y + 34, name, 13, INK, bold=True)
        x0, x1 = 200, 1110
        c.line(x0, y + 28, x1, y + 28, "#cbd5e1", 2)
        for i in range(len(pos) - 1):
            a = x0 + (x1 - x0) * pos[i]
            b = x0 + (x1 - x0) * pos[i + 1]
            c.line(a, y + 28, b, y + 28, colors[i], 4)
        for i, p in enumerate(pos):
            px = x0 + (x1 - x0) * p
            c.rect(px - 7, y + 21, px + 7, y + 35, colors[min(i, len(colors) - 1)], INK, 1.5, r=2)
        y += 66

    # список ключей
    c.rect(64, y + 6, 1130, y + 100, CARD, LINE, 1, r=8)
    c.label(80, y + 30, "Все ключи", 13, INK, bold=True)
    c.label(80, y + 52, "X · 0.00 с · 0    X · 3.60 с · 180    Размер · 1.20 с · 120    Цвет · 4.00 с · #38BDF8",
            12, MUTED, maxw=1030)
    c.label(80, y + 74, "Щелчок по ключу выделяет его, перетаскивание меняет время, значения между ключами считаются автоматически.",
            12, MUTED, maxw=1030)
    return c.render(path)


# =====================================================================
# Рисунок 4. Мини-игры
# =====================================================================
def fig_games(path):
    c = Canvas(1240, 620)
    c.label(40, 40, "Рисунок 4 — Панель «Мини-игры»: шахматы, крестики-нолики, змейка", 20, INK, bold=True)

    # --- шахматы
    c.rect(40, 60, 560, 600, CARD, LINE, 1.2, r=12)
    c.label(64, 96, "Шахматы", 17, INK, bold=True)
    c.rect(430, 78, 536, 102, PANEL, LINE, 1, r=12)
    c.label(444, 96, "Ход: белые", 12, OK, bold=True)
    size = 46
    x0, y0 = 64, 116
    board = [
        ["♜", "♞", "♝", "♛", "♚", "♝", "♞", "♜"],
        ["♟", "♟", "♟", "♟", "♟", "♟", "♟", "♟"],
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "♟", "", "", "", ""],
        ["", "", "", "", "", "", "", ""],
        ["", "", "", "", "♙", "", "", ""],
        ["♙", "♙", "♙", "♙", "", "♙", "♙", "♙"],
        ["♖", "♘", "♗", "♕", "♔", "♗", "♘", "♖"],
    ]
    for r in range(8):
        for col in range(8):
            bx = x0 + col * size
            by = y0 + r * size
            light = (r + col) % 2 == 0
            c.rect(bx, by, bx + size, by + size, "#e9d5b3" if light else "#9a7b57", None, 0)
            piece = board[r][col]
            if piece:
                c.label(bx + size / 2, by + size / 2 + 11, piece, 30, "#0f172a", anchor="center")
    for i, ch in enumerate("abcdefgh"):
        c.label(x0 + i * size + size / 2, y0 + 8 * size + 18, ch, 12, MUTED, anchor="center")
    c.label(64, y0 + 8 * size + 46, "Легальные ходы подсвечиваются; правила и проверка ходов — на сервере",
            12, MUTED, maxw=470)
    for i, t in enumerate(["Заново", "Выйти"]):
        bx = 64 + i * 130
        c.rect(bx, y0 + 8 * size + 60, bx + 118, y0 + 8 * size + 88, PANEL, LINE, 1, r=8)
        c.label(bx + 59, y0 + 8 * size + 79, t, 12, INK, anchor="center")

    # --- крестики-нолики
    c.rect(580, 60, 900, 380, CARD, LINE, 1.2, r=12)
    c.label(604, 96, "Крестики-нолики", 17, INK, bold=True)
    c.rect(770, 78, 876, 102, PANEL, LINE, 1, r=12)
    c.label(784, 96, "Ход: нолики", 12, OK, bold=True)
    cells = ["X", "", "O", "", "X", "", "O", "", "X"]
    cs = 88
    bx0, by0 = 604, 120
    for i in range(9):
        r, col = divmod(i, 3)
        x = bx0 + col * (cs + 8)
        y = by0 + r * (cs + 8)
        c.rect(x, y, x + cs, y + cs, PANEL, LINE, 1, r=10)
        mark = cells[i]
        if mark == "X":
            c.label(x + cs / 2, y + cs / 2 + 12, "✕", 36, "#dc2626", anchor="center")
        elif mark == "O":
            c.label(x + cs / 2, y + cs / 2 + 12, "○", 40, "#2563eb", anchor="center")
    c.label(604, by0 + 3 * (cs + 8) + 22, "Победа, ничья и повтор партии определяются на сервере", 12, MUTED, maxw=280)

    # --- змейка
    c.rect(920, 60, 1200, 380, CARD, LINE, 1.2, r=12)
    c.label(944, 96, "Змейка (локально)", 17, INK, bold=True)
    cell = 22
    sx, sy = 944, 120
    for r in range(9):
        for col in range(11):
            x = sx + col * cell
            y = sy + r * cell
            c.rect(x, y, x + cell - 2, y + cell - 2, "#0b1020", None, 0)
    snake = [(1, 4), (2, 4), (2, 5), (3, 5), (3, 6), (4, 6)]
    for i, (col, r) in enumerate(snake):
        x = sx + col * cell
        y = sy + r * cell
        c.rect(x, y, x + cell - 2, y + cell - 2, "#34d399" if i else "#10b981", None, 0)
    fx, fy = sx + 7 * cell, sy + 3 * cell
    c.circle(fx + cell / 2, fy + cell / 2, cell / 2 - 2, "#f87171")
    c.label(944, sy + 9 * cell + 26, "Счёт: 5   Рекорд: 12", 13, INK, bold=True)
    c.label(944, sy + 9 * cell + 48, "Управление: стрелки, WASD или кнопки", 12, MUTED, maxw=250)

    # --- КНБ и пояснение
    c.rect(580, 396, 1200, 600, CARD, LINE, 1.2, r=12)
    c.label(604, 432, "Камень-ножницы-бумага и сценарий партии", 17, INK, bold=True)
    for i, t in enumerate(["Камень", "Ножницы", "Бумага"]):
        bx = 604 + i * 150
        c.rect(bx, 452, bx + 136, 486, PANEL, LINE, 1, r=8)
        c.label(bx + 68, 474, t, 13, INK, anchor="center")
    c.label(604, 520, "Как начать партию:", 13, INK, bold=True)
    for i, line in enumerate([
        "1. Ведущий или любой участник нажимает «Шахматы» или «Крестики-нолики».",
        "2. Карточка игры появляется у всех участников комнаты (доска одна на всех).",
        "3. Второй участник нажимает «Присоединиться» — ходы становятся доступны обоим.",
        "4. Ходы, победа и ничья рассылаются сервером; состояние партии хранится в data/rooms.json.",
    ]):
        c.label(604, 544 + i * 24, line, 12, MUTED, maxw=580)
    return c.render(path)


# =====================================================================
# Рисунок 5. Песочница
# =====================================================================
def fig_powder(path):
    c = Canvas(1240, 640)
    c.label(40, 40, "Рисунок 5 — Песочница «Порошок»: 38 элементов и их реакции", 20, INK, bold=True)

    # холст
    c.rect(40, 60, 830, 600, CARD, LINE, 1.2, r=12)
    c.label(64, 96, "Холст симуляции", 17, INK, bold=True)
    for i, t in enumerate(["Пауза", "Шаг", "Очистить"]):
        bx = 250 + i * 120
        c.rect(bx, 78, bx + 108, 106, PANEL, LINE, 1, r=8)
        c.label(bx + 54, 97, t, 12, INK, anchor="center")
    c.label(600, 97, "Кисть: 4", 12, MUTED)
    c.line(680, 100, 790, 100, LINE, 3)
    c.circle(720, 100, 7, ACCENT, ACCENT, 1)

    cell = 14
    gx, gy = 64, 120
    cols, rows = 53, 30
    import random
    random.seed(11)
    palette = {
        "air": "#0b1020", "stone": "#7a7a84", "sand": "#dec480", "water": "#3884e6",
        "lava": "#e2541e", "fire": "#ff9628", "wood": "#7c5834", "plant": "#40be6c",
        "ice": "#96d6f4", "smoke": "#5a5a64", "acid": "#96e83c", "metal": "#9ea6b2",
    }
    def fill_rect(r0, r1, c0, c1, key):
        for r in range(r0, r1):
            for col in range(c0, c1):
                x = gx + col * cell
                y = gy + r * cell
                c.rect(x, y, x + cell - 1, y + cell - 1, palette[key], None, 0)
    fill_rect(28, 30, 0, cols, "stone")
    fill_rect(20, 26, 12, 24, "stone")
    fill_rect(14, 18, 15, 21, "lava")
    fill_rect(12, 14, 17, 19, "fire")
    fill_rect(10, 12, 16, 20, "smoke")
    fill_rect(24, 27, 30, 44, "water")
    fill_rect(22, 24, 31, 43, "water")
    fill_rect(26, 28, 2, 10, "sand")
    fill_rect(23, 25, 26, 32, "sand")
    fill_rect(27, 28, 44, 50, "sand")
    fill_rect(25, 26, 44, 52, "wood")
    fill_rect(21, 24, 45, 52, "plant")
    fill_rect(10, 12, 30, 38, "ice")
    fill_rect(16, 18, 34, 40, "metal")
    fill_rect(18, 20, 33, 41, "acid")
    # отдельные крупицы
    for i in range(60):
        r = random.randint(0, 11)
        col = random.randint(0, cols - 1)
        x = gx + col * cell
        y = gy + r * cell
        c.rect(x, y, x + cell - 1, y + cell - 1, palette["sand"], None, 0)
    c.label(64, gy + rows * cell + 26,
            "Сыпучие падают и образуют горки, жидкости растекаются, газы поднимаются; огонь держится на горючем материале",
            12, MUTED, maxw=740)
    c.label(64, gy + rows * cell + 48, "и поджигает соседей, вода тушит огонь, а при встрече с лавой даёт обсидиан и пар.",
            12, MUTED, maxw=740)

    # палитра
    c.rect(850, 60, 1200, 600, CARD, LINE, 1.2, r=12)
    c.label(874, 96, "Элементы", 17, INK, bold=True)
    groups = [
        ("Основное", [("Стена", "#78808c"), ("Песок", "#dec480"), ("Вода", "#3884e6"), ("Камень", "#7a7a84"), ("Земля", "#6e5238")]),
        ("Огонь", [("Огонь", "#ff9628"), ("Дым", "#5a5a64"), ("Пар", "#c8d6ec"), ("Лава", "#e2541e"), ("Факел", "#946c3e")]),
        ("Жидкости", [("Масло", "#5c4a34"), ("Кислота", "#96e83c"), ("Ртуть", "#bec4d0"), ("Магия", "#ba78ff")]),
        ("Природа", [("Дерево", "#7c5834"), ("Растение", "#40be6c"), ("Снег", "#eef6ff"), ("Лёд", "#96d6f4"), ("Облако", "#ced8e8")]),
        ("Химия", [("Соль", "#eeeeF6"), ("Порох", "#48484e"), ("Газ", "#bce278"), ("Губка", "#eed85c")]),
        ("Разное", [("Металл", "#9ea6b2"), ("Стекло", "#b0d6ec"), ("Ток", "#82d2ff"), ("Пустота", "#100c1a")]),
    ]
    y = 116
    for gname, items in groups:
        c.label(874, y + 6, gname, 12, MUTED, bold=True)
        x = 874
        yy = y + 14
        for name, color in items:
            w = text_w(name, 11) + 34
            if x + w > 1176:
                x = 874
                yy += 30
            c.rect(x, yy, x + w, yy + 26, PANEL, LINE, 1, r=13)
            c.rect(x + 6, yy + 8, x + 18, yy + 18, color, None, 0)
            c.label(x + 24, yy + 19, name, 11, INK)
            x += w + 6
        y = yy + 40
    c.label(874, y + 10, "Всего 38 элементов: кислота растворяет почти всё,", 12, MUTED, maxw=320)
    c.label(874, y + 30, "порох и газ взрываются, растения растут в воде,", 12, MUTED, maxw=320)
    c.label(874, y + 50, "ток бежит по металлу, пустота стирает соседей.", 12, MUTED, maxw=320)
    return c.render(path)


# =====================================================================
# Рисунок 6. Сетевой протокол
# =====================================================================
def fig_network(path):
    c = Canvas(1240, 560)
    c.label(40, 40, "Рисунок 6 — Сетевое взаимодействие: WebSocket, SSE и REST", 20, INK, bold=True)

    c.rect(40, 70, 230, 250, CARD, LINE, 1.2, r=10)
    c.label(60, 106, "Клиент 1", 16, INK, bold=True)
    c.label(60, 130, "ведущий комнаты", 12, MUTED, maxw=160)
    c.rect(60, 150, 210, 236, PANEL, LINE, 1, r=6)
    c.label(74, 172, "сцена, объекты,", 12, MUTED, maxw=130)
    c.label(74, 190, "доска, чат, курсор", 12, MUTED, maxw=130)

    c.rect(40, 330, 230, 510, CARD, LINE, 1.2, r=10)
    c.label(60, 366, "Клиент 2", 16, INK, bold=True)
    c.label(60, 390, "участник", 12, MUTED, maxw=160)
    c.rect(60, 410, 210, 496, PANEL, LINE, 1, r=6)
    c.label(74, 432, "своя сцена или", 12, MUTED, maxw=130)
    c.label(74, 450, "общая сцена комнаты", 12, MUTED, maxw=130)

    c.rect(1010, 70, 1200, 510, CARD, LINE, 1.2, r=10)
    c.label(1030, 106, "Сервер", 16, INK, bold=True)
    c.label(1030, 130, "room_server.py", 12, MUTED, maxw=160)
    c.rect(1030, 150, 1180, 300, PANEL, LINE, 1, r=6)
    for i, t in enumerate(["комнаты и роли", "игры и журнал", "опросы и доска", "лимиты и блоклисты"]):
        c.label(1044, 176 + i * 26, "• " + t, 12, MUTED, maxw=130)

    # сообщения
    msgs = [
        (230, 140, 1010, 140, "join / state / chat / stroke / action", ACCENT),
        (1010, 175, 230, 175, "snapshot / users / feed / poll", ACCENT2),
        (230, 215, 1010, 215, "game_create / game_move / shared_update / rtc", OK),
        (230, 390, 1010, 390, "join / game_join / poll_vote", ACCENT),
        (1010, 430, 230, 430, "games / shared / announce / frozen", ACCENT2),
    ]
    for x0, y0, x1, y1, text, color in msgs:
        c.arrow(x0, y0, x1, y1, color, 2)
        mx = (x0 + x1) / 2
        my = min(y0, y1) - 10
        c.label(mx, my, text, 12, MUTED, anchor="center", maxw=700)

    # запасной канал
    c.rect(300, 250, 980, 320, PANEL, LINE, 1, r=8)
    c.label(640, 274, "Если WebSocket недоступен: SSE (/api/events) + POST /api/message", 13, INK, bold=True, anchor="center")
    c.label(640, 298, "Автопереподключение с увеличивающейся задержкой, индикатор состояния в шапке",
            12, MUTED, anchor="center")

    # REST
    c.rect(300, 440, 980, 510, CARD, LINE, 1, r=8)
    c.label(320, 466, "REST-запросы", 13, INK, bold=True)
    c.label(320, 488, "POST /api/join — вход в комнату;  POST /api/upload — загрузка медиа;", 12, MUTED, maxw=620)
    c.label(320, 506, "GET /api/journal — журнал занятия;  GET /api/room, /api/rooms, /api/health", 12, MUTED, maxw=620)
    return c.render(path)


# =====================================================================
# Рисунок 7. Алгоритм песочницы
# =====================================================================
def fig_algorithm(path):
    c = Canvas(1000, 720)
    c.label(40, 40, "Рисунок 7 — Один шаг клеточного автомата (песочница «Порошок»)", 20, INK, bold=True)

    def step_box(x, y, w, h, title, lines, color=ACCENT):
        c.rect(x, y, x + w, y + h, "#f8fafc", color, 1.6, r=10)
        c.rect(x, y, x + 6, y + h, color, None, 0, r=3)
        ty = c.label(x + 20, y + 28, title, 14, INK, bold=True, maxw=w - 36)
        for line in lines:
            ty = c.label(x + 20, ty + 4, line, 12, MUTED, maxw=w - 36)

    cx = 380
    step_box(cx, 70, 240, 88, "1. Обход клеток", ["снизу вверх, слева направо", "со сменой направления каждый", "шаг — чтобы не было «залипания»"], ACCENT)
    c.arrow(cx + 120, 158, cx + 120, 190, LINE, 2)
    step_box(cx, 190, 240, 104, "2. Реакции", ["огонь ↔ вода, лава ↔ лёд,", "кислота ↔ порода, растения", "и вода, ток и металл, взрывы"], WARN)
    c.arrow(cx + 120, 294, cx + 120, 326, LINE, 2)
    step_box(cx, 326, 240, 90, "3. Движение", ["сыпучие — вниз и по диагонали;", "жидкости — вниз и в стороны;", "газы — вверх и в стороны"], OK)
    c.arrow(cx + 120, 416, cx + 120, 448, LINE, 2)
    step_box(cx, 448, 240, 88, "4. Обмен клетками", ["тяжёлое вытесняет лёгкое:", "песок тонет в воде,", "вода топит газы"], ACCENT2)
    c.arrow(cx + 120, 536, cx + 120, 568, LINE, 2)
    step_box(cx, 568, 240, 92, "5. Отрисовка", ["цвет по типу и «шуму» клетки,", "свечение — отдельным слоем", "с размытием"], DANGER)
    c.line(cx + 240, 612, 960, 612, LINE, 2)
    c.arrow(960, 612, 960, 114, LINE, 2)
    c.arrow(960, 114, cx + 240, 114, LINE, 2)
    c.label(800, 606, "следующий кадр (60 раз в секунду)", 12, MUTED, anchor="center")

    # пояснения слева
    c.rect(40, 70, 340, 300, CARD, LINE, 1.2, r=10)
    c.label(64, 106, "Как устроены данные", 16, INK, bold=True)
    for i, line in enumerate([
        "type — тип элемента (Uint8Array)",
        "life — таймер жизни (Uint8Array)",
        "orig — что было до искры",
        "moved — метка «уже двигалась»",
        "noise — стабильный шум для оттенков",
        "Поле: клетка 4–5 пикселей, до 30 тысяч клеток.",
    ]):
        c.label(64, 136 + i * 24, "• " + line, 12, MUTED, maxw=300)

    c.rect(40, 400, 340, 660, CARD, LINE, 1.2, r=10)
    c.label(64, 436, "Правила реакций (примеры)", 16, INK, bold=True)
    for i, line in enumerate([
        "вода + огонь = пар",
        "лава + вода = обсидиан + пар",
        "лава + лёд/снег = вода",
        "кислота + порода = пустота (кислота тратится)",
        "порох/газ + огонь = взрыв",
        "растение + вода = рост растения",
        "соль + вода = солёная вода",
        "губка + вода = впитывание",
    ]):
        c.label(64, 466 + i * 22, "• " + line, 12, MUTED, maxw=300)
    return c.render(path)


# =====================================================================
# Рисунок 8. Структура модулей
# =====================================================================
def fig_modules(path):
    c = Canvas(1240, 620)
    c.label(40, 40, "Рисунок 8 — Структура модулей js/ (50 файлов, без сборщика)", 20, INK, bold=True)

    groups = [
        ("core", ["bus.js — шина событий", "dom.js — утилиты DOM", "store.js — состояние, undo/redo",
                  "i18n.js — RU / EN (720 ключей)", "media.js — ссылки и медиа",
                  "gif.js — кодировщик GIF89a", "plugins.js — API плагинов"], ACCENT),
        ("scene", ["shapes.js — фигуры clip-path", "animations.js — 20 анимаций, траектории",
                   "objects.js — объекты, drag, слои", "physics.js — гравитация, столкновения",
                   "model3d.js — CSS 3D, кость, Рубик", "webgl.js — Three.js с CDN",
                   "effects.js — частицы на canvas", "backgrounds.js — фон и видео-фон",
                   "cursorfx.js — эффекты курсора", "preview.js — мини-сцены участников",
                   "recorder.js — видео, GIF, CSS/HTML"], OK),
        ("ui", ["panels.js — все панели", "view.js — экран, презентация, PiP",
                "timeline.js — ключевые кадры", "shortcuts.js — горячие клавиши",
                "palette.js — командная палитра", "peek.js — просмотр чужой сцены",
                "toast.js — уведомления", "commands.js — реестр команд"], ACCENT2),
        ("net", ["transport.js — WS + SSE", "session.js — комнаты, роли, журнал",
                 "chat.js — чат, реакции, лайки", "polls.js — опросы",
                 "cursors.js — живые курсоры", "whiteboard.js — общая доска",
                 "admin.js — панель ведущего", "qr.js — свой QR-кодер",
                 "rtc.js — звонок и экран", "shared.js — общая сцена"], WARN),
        ("features", ["audio.js — звуки и микрофон", "voice.js — голосовое управление",
                      "weather.js — каскад погоды", "widgets.js — часы, Луна, курсы",
                      "achievements.js — достижения", "easter.js, quiz.js — пасхалки и квиз",
                      "pwa.js, gestures.js — PWA и жесты", "games.js, snake.js — мини-игры",
                      "powder.js — песочница", "journal.js — журнал занятия"], "#8b5cf6"),
    ]
    x = 40
    w = 228
    for name, files, color in groups:
        c.rect(x, 70, x + w, 596, CARD, LINE, 1.2, r=10)
        c.rect(x, 70, x + w, 108, color, None, 0, r=0)
        c.rect(x, 88, x + w, 108, color, None, 0)
        c.label(x + w / 2, 96, f"js/{name}/", 16, "#04121f", bold=True, anchor="center")
        y = 140
        for f in files:
            yy = c.label(x + 14, y, f, 11, MUTED, maxw=w - 24, lh=15)
            y = yy + 6
        x += w + 12
    c.label(40, 616, "main.js — точка входа: состояние → локализация → сцена → сеть → панели → возможности",
            12, INK, bold=True)
    return c.render(path)


# =====================================================================
# Рисунок 9. Путь одного кадра сцены (для презентации)
# =====================================================================
def fig_frame(path):
    c = Canvas(1240, 520)
    stages = [
        ("1. Ввод", ACCENT,
         ["мышь и касание, панели,", "таймлайн, голос,", "сообщения из комнаты"]),
        ("2. Состояние", ACCENT2,
         ["store.js: объекты, фон,", "эффекты, настройки;", "история для отмены"]),
        ("3. Расчёт", OK,
         ["шаг времени dt, траектория,", "физика, значения", "между ключами"]),
        ("4. Отрисовка", WARN,
         ["transform и стили объектов,", "слои canvas: фон,", "эффекты, доска"]),
        ("5. Обмен", DANGER,
         ["снимок сцены участникам,", "запись видео и GIF,", "экспорт CSS/HTML"]),
    ]
    x = 30
    y = 70
    w = 212
    h = 190
    gap = 22
    for i, (title, color, lines) in enumerate(stages):
        c.rect(x, y, x + w, y + h, CARD, color, 1.6, r=10)
        c.rect(x, y, x + w, y + 8, color, None, 0, r=4)
        ty = c.label(x + 16, y + 40, title, 16, INK, bold=True, maxw=w - 32)
        for line in lines:
            ty = c.label(x + 16, ty + 6, line, 12, MUTED, maxw=w - 32)
        if i < len(stages) - 1:
            c.arrow(x + w + 3, y + h // 2, x + w + gap - 3, y + h // 2, LINE, 2)
        x += w + gap
    # возврат к следующему кадру
    c.line(30, 300, 1210, 300, LINE, 2, dash=True)
    c.arrow(1210, 300, 1210, 330, LINE, 2)
    c.arrow(1210, 330, 30, 330, LINE, 2)
    c.arrow(30, 330, 30, 300, LINE, 2)
    c.label(620, 322, "следующий кадр — 60 раз в секунду", 13, MUTED, bold=True, anchor="center")

    c.rect(30, 360, 1210, 500, PANEL, LINE, 1.2, r=10)
    c.label(56, 396, "Почему сцена остаётся плавной", 16, INK, bold=True)
    for i, line in enumerate([
        "• расчёт привязан к кадру браузера: requestAnimationFrame, а не таймер с фиксированной задержкой;",
        "• шаг времени ограничен 0,033 с — при «заморозке» вкладки объекты не улетают за границу сцены;",
        "• объекты двигаются через transform, поэтому браузер перерисовывает их на видеокарте;",
        "• частицы, доска и свечение песочницы считаются отдельно и не мешают основному кадру.",
    ]):
        c.label(56, 424 + i * 20, line, 12, MUTED, maxw=1140)
    return c.render(path)


# =====================================================================
# Рисунок 10. Проверки программы (для презентации)
# =====================================================================
def fig_tests(path):
    c = Canvas(1240, 700)
    data = [
        ("smoke.mjs — интерфейс целиком", 181, ACCENT),
        ("server_e2e.mjs — сервер и протокол", 78, ACCENT2),
        ("powder_test.mjs — песочница", 38, OK),
        ("chess_test.py — шахматный движок", 34, WARN),
        ("gif_test.py — свой кодировщик GIF", 18, DANGER),
        ("media_test.mjs — видео и файлы", 14, ACCENT),
        ("plugins_test.mjs — плагины", 12, ACCENT2),
        ("snake_test.mjs — змейка", 11, OK),
        ("timeline_test.mjs — ключевые кадры", 10, WARN),
        ("export_test.mjs — экспорт CSS/HTML", 9, DANGER),
    ]
    total = sum(v for _, v, _ in data)
    x0 = 400
    max_w = 700
    scale = max_w / max(v for _, v, _ in data)
    y = 70
    for name, value, color in data:
        c.label(40, y + 20, name, 14, INK, maxw=340)
        bw = max(6, value * scale)
        c.rect(x0, y, x0 + bw, y + 30, color, None, 0, r=5)
        c.label(x0 + bw + 12, y + 22, str(value), 14, INK, bold=True)
        y += 44
    c.line(40, y + 4, 1210, y + 4, LINE, 2)
    c.label(40, y + 40, "Итого", 16, INK, bold=True, maxw=340)
    c.label(x0, y + 40, f"{total} проверок, все проходят успешно", 16, INK, bold=True)
    c.rect(40, y + 66, 1210, y + 140, PANEL, LINE, 1.2, r=10)
    for i, line in enumerate([
        "Дополнительно: синтаксис всех 50 модулей, компиляция room_server.py, совпадение словарей RU/EN (720 ключей),",
        "список кэша сервис-воркера и сверка QR-кодов независимым декодером (qr_roundtrip.py).",
    ]):
        c.label(64, y + 100 + i * 22, line, 12, MUTED, maxw=1140)
    return c.render(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    print("Рисуем схемы для отчёта:")
    jobs = [
        ("fig1-architecture.png", fig_architecture),
        ("fig2-main.png", fig_main),
        ("fig3-timeline.png", fig_timeline),
        ("fig4-games.png", fig_games),
        ("fig5-powder.png", fig_powder),
        ("fig6-network.png", fig_network),
        ("fig7-algorithm.png", fig_algorithm),
        ("fig8-modules.png", fig_modules),
        ("fig9-frame.png", fig_frame),
        ("fig10-tests.png", fig_tests),
    ]
    ok = True
    for name, fn in jobs:
        ok = fn(os.path.join(OUT, name)) and ok
    print("Готово." if ok else "Были ошибки.")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
