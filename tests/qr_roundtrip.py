#!/usr/bin/env python3
"""Проверка собственного QR-кодера (js/net/qr.js) независимым декодером.

Запуск: python3 tests/qr_roundtrip.py
Проверяются служебные шаблоны (искатели, синхронизация, выравнивание, формат, версия),
нулевые синдромы Рида–Соломона и то, что байтовый payload читается обратно.
"""
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))

EXP = [0] * 512
LOG = [0] * 256
_x = 1
for _i in range(255):
    EXP[_i] = _x
    LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D
for _i in range(255, 512):
    EXP[_i] = EXP[_i - 255]


def mul(a, b):
    return 0 if a == 0 or b == 0 else EXP[LOG[a] + LOG[b]]


def poly_eval(p, x):
    y = 0
    for c in p:
        y = mul(y, x) ^ c
    return y


ECC_PER_BLOCK = {"L": [7, 10, 15, 20, 26, 18, 20, 24, 30, 18], "M": [10, 16, 26, 18, 24, 16, 18, 22, 22, 26],
                 "Q": [13, 22, 18, 26, 18, 24, 18, 22, 20, 24], "H": [17, 28, 22, 16, 22, 28, 26, 26, 24, 28]}
NUM_BLOCKS = {"L": [1, 1, 1, 1, 1, 2, 2, 2, 2, 4], "M": [1, 1, 1, 2, 2, 4, 4, 4, 5, 5],
              "Q": [1, 1, 2, 2, 4, 4, 6, 6, 8, 8], "H": [1, 1, 2, 4, 4, 4, 5, 6, 8, 8]}
ALIGN = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42],
         9: [6, 26, 46], 10: [6, 28, 50]}
MASKS = [lambda x, y: (x + y) % 2 == 0, lambda x, y: y % 2 == 0, lambda x, y: x % 3 == 0,
         lambda x, y: (x + y) % 3 == 0, lambda x, y: (x // 3 + y // 2) % 2 == 0,
         lambda x, y: x * y % 2 + x * y % 3 == 0, lambda x, y: (x * y % 2 + x * y % 3) % 2 == 0,
         lambda x, y: ((x + y) % 2 + x * y % 3) % 2 == 0]


def bch_format(data):
    rem = data
    for _ in range(10):
        rem = (rem << 1) ^ ((rem >> 9) * 0x537)
    return ((data << 10) | rem) ^ 0x5412


def bch_version(v):
    rem = v
    for _ in range(12):
        rem = (rem << 1) ^ ((rem >> 11) * 0x1F25)
    return (v << 12) | rem


def raw_modules(v):
    r = (16 * v + 128) * v + 64
    if v >= 2:
        n = v // 7 + 2
        r -= (25 * n - 10) * n - 55
        if v >= 7:
            r -= 36
    return r


def decode(entry):
    m, size = entry["modules"], entry["size"]
    v = (size - 17) // 4
    assert size == 17 + 4 * v, "size"
    for ox, oy in [(0, 0), (size - 7, 0), (0, size - 7)]:
        for dy in range(7):
            for dx in range(7):
                exp = dx in (0, 6) or dy in (0, 6) or (2 <= dx <= 4 and 2 <= dy <= 4)
                assert bool(m[oy + dy][ox + dx]) == exp, f"finder {ox},{oy}"
    for i in range(8):
        assert m[7][i] == 0 and m[i][7] == 0 and m[7][size - 1 - i] == 0 and m[i][size - 8] == 0 \
            and m[size - 8][i] == 0 and m[size - 1 - i][7] == 0, "separator"
    for i in range(8, size - 8):
        assert bool(m[6][i]) == (i % 2 == 0) and bool(m[i][6]) == (i % 2 == 0), "timing"
    bits = [m[8][i] for i in range(6)] + [m[8][7], m[8][8], m[7][8]] + [m[i][8] for i in range(5, -1, -1)]
    fmt = 0
    for b in bits:
        fmt = (fmt << 1) | int(bool(b))
    found = None
    for ecl_bits, ecl in [(1, "L"), (0, "M"), (3, "Q"), (2, "H")]:
        for mask in range(8):
            if bch_format((ecl_bits << 3) | mask) == fmt:
                found = (ecl, mask)
    assert found, f"format info invalid: {fmt:015b}"
    ecl, mask = found
    bits2 = [m[i][8] for i in range(size - 1, size - 8, -1)] + [m[8][i] for i in range(size - 8, size)]
    fmt2 = 0
    for b in bits2:
        fmt2 = (fmt2 << 1) | int(bool(b))
    assert fmt2 == fmt, "format copy 2 mismatch"
    assert m[size - 8][8] == 1, "dark module"
    if v >= 7:
        vb = bch_version(v)
        for i in range(18):
            bit = (vb >> i) & 1
            a, b = i // 3, size - 11 + i % 3
            assert m[b][a] == bit and m[a][b] == bit, "version info"
    func = [[False] * size for _ in range(size)]

    def mark(x0, y0, w, h):
        for y in range(y0, y0 + h):
            for x in range(x0, x0 + w):
                if 0 <= x < size and 0 <= y < size:
                    func[y][x] = True

    mark(0, 0, 9, 9)
    mark(size - 8, 0, 8, 9)
    mark(0, size - 8, 9, 8)
    for i in range(size):
        func[6][i] = True
        func[i][6] = True
    al = ALIGN[v]
    for i, cy in enumerate(al):
        for j, cx in enumerate(al):
            if (i == 0 and j == 0) or (i == 0 and j == len(al) - 1) or (i == len(al) - 1 and j == 0):
                continue
            mark(cx - 2, cy - 2, 5, 5)
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    assert bool(m[cy + dy][cx + dx]) == (max(abs(dx), abs(dy)) != 1), "alignment pattern"
    if v >= 7:
        mark(size - 11, 0, 3, 6)
        mark(0, size - 11, 6, 3)
    mf = MASKS[mask]
    data_bits = []
    right, upward = size - 1, True
    while right >= 1:
        if right == 6:
            right -= 1
        for y in (range(size - 1, -1, -1) if upward else range(size)):
            for x in (right, right - 1):
                if not func[y][x]:
                    b = int(bool(m[y][x]))
                    if mf(x, y):
                        b ^= 1
                    data_bits.append(b)
        upward = not upward
        right -= 2
    total_cw = raw_modules(v) // 8
    cws = [int("".join(map(str, data_bits[i * 8:i * 8 + 8])), 2) for i in range(total_cw)]
    nb, ecc = NUM_BLOCKS[ecl][v - 1], ECC_PER_BLOCK[ecl][v - 1]
    short_len = total_cw // nb - ecc
    num_long = total_cw % nb
    blocks = [[None] * ((short_len + (1 if i >= nb - num_long else 0)) + ecc) for i in range(nb)]
    k = 0
    for col in range(short_len + 1):
        for bi in range(nb):
            if col < len(blocks[bi]) - ecc:
                blocks[bi][col] = cws[k]
                k += 1
    for col in range(ecc):
        for bi in range(nb):
            blocks[bi][len(blocks[bi]) - ecc + col] = cws[k]
            k += 1
    assert k == total_cw, "codeword count"
    data = []
    for blk in blocks:
        for i in range(ecc):
            assert poly_eval(blk, EXP[i]) == 0, "RS syndrome != 0"
        data += blk[:len(blk) - ecc]
    bits = "".join(f"{b:08b}" for b in data)
    assert int(bits[:4], 2) == 4, "mode"
    cl = 8 if v < 10 else 16
    n = int(bits[4:4 + cl], 2)
    raw = bytes(int(bits[4 + cl + i * 8:4 + cl + i * 8 + 8], 2) for i in range(n))
    return raw.decode("utf-8"), v, ecl, mask


def main():
    texts = ["A", "http://192.168.1.10:8080/?room=AB12", "Привет, мир! Motion Playground — совместная сессия",
             "https://example.com/very/long/path/?room=ZZZZ9999&user=someone#fragment-" + "x" * 120, "x" * 260]
    out = subprocess.run(["node", os.path.join(HERE, "qr_dump.mjs"), *texts], capture_output=True, text=True, check=True)
    ok = True
    for entry in json.loads(out.stdout):
        try:
            text, v, ecl, mask = decode(entry)
            good = text == entry["text"]
        except AssertionError as err:
            good, v, ecl, mask, text = False, "?", "?", "?", str(err)
        ok &= good
        print(("OK  " if good else "FAIL"), f"v{v}-{ecl} mask{mask}", repr(entry["text"][:48]))
    print("QR round-trip:", "OK" if ok else "FAILED")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
