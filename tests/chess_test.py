# Юнит-тесты шахматного движка сервера (без сети и без запуска сервера).
#   python3 tests/chess_test.py
import importlib.util
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
spec = importlib.util.spec_from_file_location("room_server", os.path.join(ROOT, "room_server.py"))
rs = importlib.util.module_from_spec(spec)
sys.modules["room_server"] = rs
spec.loader.exec_module(rs)

failures = []
passed = 0


def check(name, cond):
    global passed
    if cond:
        passed += 1
        print(f"✓ {name}")
    else:
        failures.append(name)
        print(f"✗ {name}")


# --- старт и базовые ходы -----------------------------------------------------
st = rs.new_chess()
check("стартовая доска: 32 фигуры", sum(1 for p in st["board"] if p) == 32)
check("короли на месте", st["board"][60] == "wK" and st["board"][4] == "bK")
check("белые ходят первыми", st["turn"] == "w")
check("у белых 20 ходов в дебюте", len(rs.legal_moves(st)) == 20)

ok, err = rs.chess_move(st, "e2e4")
check("ход e2e4 принят", ok and st["board"][rs.sq_index("e4")] == "wP")
check("ход передан чёрным", st["turn"] == "b")
check("ход в истории", st["history"] == ["e2e4"])

bad = rs.new_chess()
ok, err = rs.chess_move(bad, "e2e5")
check("ход пешкой на 3 поля запрещён", not ok and err == "illegal")
ok, err = rs.chess_move(bad, "e1e2")
check("нельзя ходить чужой фигурой", not ok)

# --- взятие, шах, мат ----------------------------------------------------------
st2 = rs.new_chess()
for uci in ("e2e4", "d7d5", "f1b5"):
    ok, _ = rs.chess_move(st2, uci)
check("слон вышел на b5", st2["board"][rs.sq_index("b5")] == "wB")
check("слон с b5 объявляет шах", rs.in_check(st2, "b"))
check("под шахом только ходы, закрывающие линию", len(rs.legal_moves(st2)) == 5)
ok, _ = rs.chess_move(st2, "c7c6")
check("чёрные закрываются пешкой", ok and not rs.in_check(st2, "b"))
check("пешка e4 может забрать пешку d5", "e4d5" in rs.legal_moves(st2))

# дурацкий мат: f3 e5 g4 Qh4#
mate = rs.new_chess()
for uci in ("f2f3", "e7e5", "g2g4", "d8h4"):
    ok, _ = rs.chess_move(mate, uci)
check("дурацкий мат определён", mate["result"] == "b" and mate["reason"] == "mate")
check("после мата ходить нельзя", not rs.legal_moves(mate))

# --- рокировка ----------------------------------------------------------------
castle = rs.new_chess()
castle["board"] = [None] * 64
castle["board"][60] = "wK"
castle["board"][63] = "wR"
castle["board"][4] = "bK"
castle["castling"] = "K"
legal = rs.legal_moves(castle)
check("короткая рокировка доступна", "e1g1" in legal)
rs.chess_move(castle, "e1g1")
check("король на g1", castle["board"][rs.sq_index("g1")] == "wK")
check("ладья на f1", castle["board"][rs.sq_index("f1")] == "wR")

# рокировка под шахом запрещена
castle2 = rs.new_chess()
castle2["board"] = [None] * 64
castle2["board"][60] = "wK"
castle2["board"][63] = "wR"
castle2["board"][4] = "bK"
castle2["board"][36] = "bR"        # bR на e4 → бьёт e1
castle2["castling"] = "K"
check("рокировка под шахом запрещена", "e1g1" not in rs.legal_moves(castle2))

# --- взятие на проходе --------------------------------------------------------
ep = rs.new_chess()
ep["board"] = [None] * 64
ep["board"][52] = "wP"             # e2
ep["board"][11] = "bP"             # d7 → d5 (индекс 43)
ep["board"][60] = "wK"
ep["board"][4] = "bK"
ep["castling"] = ""
ep["turn"] = "b"
rs.chess_move(ep, "d7d5")
check("поле для взятия на проходе появилось", ep["ep"] == rs.sq_index("d6"))
rs.chess_move(ep, "e2e3")
rs.chess_move(ep, "d5d4")
ok, _ = rs.chess_move(ep, "e3d4")
check("взятие на проходе работает", ok and ep["board"][rs.sq_index("d4")] == "wP")
check("взятая пешка убрана", ep["board"][rs.sq_index("d5")] is None)

# --- превращение пешки --------------------------------------------------------
promo = rs.new_chess()
promo["board"] = [None] * 64
promo["board"][8] = "wP"           # a7
promo["board"][60] = "wK"
promo["board"][4] = "bK"
promo["castling"] = ""
ok, _ = rs.chess_move(promo, "a7a8q")
check("превращение в ферзя", ok and promo["board"][0] == "wQ")
promo2 = rs.new_chess()
promo2["board"] = [None] * 64
promo2["board"][8] = "wP"
promo2["board"][60] = "wK"
promo2["board"][4] = "bK"
promo2["castling"] = ""
rs.chess_move(promo2, "a7a8n")
check("превращение в коня", promo2["board"][0] == "wN")

# --- пат ----------------------------------------------------------------------
stale = rs.new_chess()
stale["board"] = [None] * 64
stale["board"][0] = "bK"           # a8
stale["board"][10] = "wQ"          # c7 — отрезает a7, b7, b8, но не бьёт a8
stale["board"][63] = "wK"          # h1
stale["turn"] = "b"
stale["castling"] = ""
check("пат: ходов нет, но шаха нет", not rs.legal_moves(stale) and not rs.in_check(stale, "b"))

# --- крестики-нолики ----------------------------------------------------------
ttt = rs.new_chess_ttt = rs.new_tictactoe()
check("крестики: пустое поле", all(c is None for c in ttt["board"]) and ttt["turn"] == "x")
ok, err = rs.ttt_move(ttt, 0)
check("крестики: первый ход", ok and ttt["turn"] == "o")
ok, err = rs.ttt_move(ttt, 0)
check("крестики: занятая клетка", not ok and err == "occupied")
for cell in (3, 1, 4, 2):              # x: 0,1,2 — верхняя линия
    if not ttt["winner"]:
        rs.ttt_move(ttt, cell)
check("крестики: победа по линии", ttt["winner"] == "x" and ttt["line"] == [0, 1, 2])
ok, err = rs.ttt_move(ttt, 7)
check("крестики: после победы ходить нельзя", not ok and err == "finished")

draw = rs.new_tictactoe()
for cell in (0, 1, 2, 4, 3, 5, 7, 6, 8):
    rs.ttt_move(draw, cell)
check("крестики: ничья на заполненном поле", draw["winner"] == "draw")

# --- публичное состояние ------------------------------------------------------
pub = rs.chess_public(rs.new_chess(), {"w": {"id": "a", "name": "A"}})
check("публичное состояние: доска и ходы", len(pub["board"]) == 64 and sum(len(v) for v in pub["legal"].values()) == 20)
check("публичное состояние: нет шаха", pub["check"] is False)

print(f"\nПроверок пройдено: {passed}")
if failures:
    print(f"ОШИБКИ ({len(failures)}):")
    for f in failures:
        print(" - " + f)
    sys.exit(1)
print("OK — ошибок нет")
