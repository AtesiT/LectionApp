# Проверка GIF-кодировщика: свой декодер на Python читает то, что написал JS.
#   python3 tests/gif_test.py
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "tests", "out", "test.gif")

failures = []
passed = 0
warnings = []


def check(name, cond, detail=""):
    global passed
    if cond:
        passed += 1
        print(f"✓ {name}")
    else:
        failures.append(f"{name} {detail}".strip())
        print(f"✗ {name} {detail}")


# --- генерация файла ------------------------------------------------------------
proc = subprocess.run(
    ["node", os.path.join(ROOT, "tests", "gif_dump.mjs"), OUT],
    capture_output=True, text=True, cwd=ROOT,
)
if proc.returncode != 0:
    print("Не удалось собрать GIF:", proc.stderr[-500:])
    sys.exit(1)
info = json.loads(proc.stdout.strip().splitlines()[-1])
data = open(OUT, "rb").read()
check("файл создан", len(data) > 100, f"({len(data)} байт)")


# --- минимальный декодер GIF (только то, что пишет我们的 кодировщик) -------------
def u16(buf, off):
    return buf[off] | (buf[off + 1] << 8)


def read_bits(buf, bit_pos, size):
    value = 0
    for i in range(size):
        byte = buf[(bit_pos + i) // 8]
        bit = (byte >> ((bit_pos + i) % 8)) & 1
        value |= bit << i
    return value


def lzw_decode(chunk, min_code_size, expected):
    """Возвращает список индексов пикселей."""
    clear = 1 << min_code_size
    eoi = clear + 1
    code_size = min_code_size + 1
    table = {i: [i] for i in range(clear)}
    next_code = eoi + 1
    out = []
    bit_pos = 0
    prev = None
    total_bits = len(chunk) * 8
    while bit_pos + code_size <= total_bits:
        code = read_bits(chunk, bit_pos, code_size)
        bit_pos += code_size
        if code == clear:
            table = {i: [i] for i in range(clear)}
            next_code = eoi + 1
            code_size = min_code_size + 1
            prev = None
            continue
        if code == eoi:
            break
        if code in table:
            entry = table[code]
        elif prev is not None:
            entry = prev + [prev[0]]
        else:
            raise ValueError(f"битый код {code}")
        out.extend(entry)
        if prev is not None:
            table[next_code] = prev + [entry[0]]
            next_code += 1
            if next_code > (1 << code_size) and code_size < 12:
                code_size += 1
        prev = entry
    return out


def decode_gif(buf):
    assert buf[:6] == b"GIF89a", "заголовок должен быть GIF89a"
    width, height = u16(buf, 6), u16(buf, 8)
    flags = buf[10]
    gct_size = 2 ** ((flags & 7) + 1)
    pos = 13
    palette = []
    if flags & 0x80:
        for _ in range(gct_size):
            palette.append(tuple(buf[pos:pos + 3]))
            pos += 3
    frames = []
    delay = None
    loop = None
    while pos < len(buf):
        block = buf[pos]
        if block == 0x21:                      # расширение
            label = buf[pos + 1]
            pos += 2
            parts = []
            while buf[pos] != 0:
                n = buf[pos]
                parts.append(buf[pos + 1:pos + 1 + n])
                pos += 1 + n
            pos += 1
            if label == 0xF9 and parts:
                delay = u16(parts[0], 1)
            if label == 0xFF and parts and parts[0][:11] == b"NETSCAPE2.0":
                loop = u16(parts[1], 1) if len(parts) > 1 and len(parts[1]) >= 3 else None
        elif block == 0x2C:                    # кадр
            left, top = u16(buf, pos + 1), u16(buf, pos + 3)
            w, h = u16(buf, pos + 5), u16(buf, pos + 7)
            lflags = buf[pos + 9]
            pos += 10
            if lflags & 0x80:
                pos += 3 * (2 ** ((lflags & 7) + 1))
            min_code_size = buf[pos]
            pos += 1
            chunks = bytearray()
            while buf[pos] != 0:
                n = buf[pos]
                chunks += buf[pos + 1:pos + 1 + n]
                pos += 1 + n
            pos += 1
            indices = lzw_decode(bytes(chunks), min_code_size, w * h)
            frames.append({"left": left, "top": top, "w": w, "h": h,
                           "indices": indices, "delay": delay})
            delay = None
        elif block == 0x3B:                    # трейлер
            break
        else:
            raise ValueError(f"неизвестный блок 0x{block:02x} на позиции {pos}")
    return {"width": width, "height": height, "palette": palette, "frames": frames, "loop": loop}


gif = decode_gif(data)
check("размер кадра", (gif["width"], gif["height"]) == (info["width"], info["height"]),
      f"{gif['width']}x{gif['height']}")
check("палитра 256 цветов", len(gif["palette"]) == 256, str(len(gif["palette"])))
check("количество кадров", len(gif["frames"]) == info["frames"], str(len(gif["frames"])))
check("задержка кадра 12 (0.12 с)", all(f["delay"] == 12 for f in gif["frames"]))
check("бесконечный цикл (NETSCAPE)", gif["loop"] == 0, str(gif["loop"]))

# --- содержимое кадров -----------------------------------------------------------
palette = gif["palette"]


def nearest(rgb):
    best, dist = 0, None
    for i, p in enumerate(palette):
        d = sum((a - b) ** 2 for a, b in zip(p, rgb))
        if dist is None or d < dist:
            best, dist = i, d
    return best


expected_colors = [(255, 0, 0), (0, 0, 255), (0, 255, 0)]
for idx, color in enumerate(expected_colors):
    frame = gif["frames"][idx]
    want = nearest(color)
    got = set(frame["indices"])
    check(f"кадр {idx + 1}: однородный цвет {color}", got == {want}, f"получено {len(got)} индексов")
    check(f"кадр {idx + 1}: столько же пикселей, сколько в кадре",
          len(frame["indices"]) == gif["width"] * gif["height"], str(len(frame["indices"])))
    check(f"кадр {idx + 1}: цвет палитры близок к исходному",
          max(abs(a - b) for a, b in zip(palette[want], color)) <= 26,
          f"{palette[want]} vs {color}")

grad = gif["frames"][3]
check("градиент: разные индексы в разных столбцах", len(set(grad["indices"])) >= 4,
      str(len(set(grad["indices"]))))
left_top = grad["indices"][0]
right_top = grad["indices"][gif["width"] - 1]
check("градиент: слева темнее, чем справа", palette[left_top][0] < palette[right_top][0],
      f"{palette[left_top]} → {palette[right_top]}")

# трейлер на месте
check("файл заканчивается трейлером 0x3B", data[-1] == 0x3B)

print(f"\nПроверок пройдено: {passed}")
if failures:
    print(f"ОШИБКИ ({len(failures)}):")
    for f in failures:
        print(" - " + f)
    sys.exit(1)
print("OK — GIF читается независимым декодером")
