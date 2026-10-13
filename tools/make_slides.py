#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Собирает презентацию «Motion Playground Web» на 20 слайдов.

Результат:
  report/Prezentaciya_Motion_Playground_Web.pptx — 16:9, со схемами и заметками
                                                   к каждому слайду (нужен python-pptx);
  report/Prezentaciya_Motion_Playground_Web.html — та же презентация для браузера:
                                                   один файл, рисунки внутри, перелистывание
                                                   стрелками, пробелом или щелчком, печать
                                                   в альбомной ориентации.

Содержание слайдов — в списке SLIDES ниже, рисунки — в report/img/
(их собирает tools/make_report_images.py).

Запуск:  python3 tools/make_slides.py
"""

import base64
import html
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG_DIR = os.path.join(ROOT, 'report', 'img')
OUT_DIR = os.path.join(ROOT, 'report')
PPTX_PATH = os.path.join(OUT_DIR, 'Prezentaciya_Motion_Playground_Web.pptx')
HTML_PATH = os.path.join(OUT_DIR, 'Prezentaciya_Motion_Playground_Web.html')

DECK_TITLE = 'Motion Playground Web'

# ---------------------------------------------------------------------------
# Слайды
# ---------------------------------------------------------------------------

SLIDES = [
    dict(kind='title',
         title='Motion Playground Web',
         sub='Интерактивная веб-площадка для создания анимаций и совместной работы',
         meta=['Доклад по учебному проекту',
               'Выполнил: ________________________________  (ФИО)',
               'Группа: __________     Преподаватель: ____________________',
               '2026'],
         note='Доклад о программе, которая работает прямо в браузере: она объединяет редактор '
              'анимаций и среду совместной работы класса. Программа не требует сборки и внешних '
              'библиотек.'),

    dict(kind='bullets', title='Что за программа',
         bullets=[
             'Редактор анимаций в браузере: объекты, анимации, траектории, физика',
             'Среда совместной работы класса: комнаты, чат, доска, опросы, звонок',
             'Учебный стенд: любой приём веб-разработки виден «вживую» и настраивается '
             'непосредственно на занятии',
             '16 032 строки кода: 50 модулей JavaScript и сервер на Python',
             'Ни сборки, ни внешних библиотек — запуск одним файлом room_server.py',
         ],
         note='Программа задумывалась как наглядное пособие: всё, о чём говорится на уроке, '
              'можно тут же показать и изменить. Объём — около 16 тысяч строк.'),

    dict(kind='bullets', title='Три сценария использования',
         bullets=[
             'Урок-демонстрация: показать приём и сразу изменить его параметры',
             'Работа класса: преподаватель открывает комнату, ученики входят по коду или QR-коду',
             'Самостоятельная работа: дома, без сервера и без интернета — приложение '
             'устанавливается на устройство',
             'Интерфейс во всех случаях один и тот же, меняется только состав доступных функций',
         ],
         note='Первый сценарий — объяснение нового материала, второй — практическая работа '
              'группы, третий — домашнее задание. Переход между сценариями не требует '
              'переустановки или новой сборки.'),

    dict(kind='image', title='Главное окно', img='fig2-main.png',
         bullets=[
             'Верхняя панель: код комнаты, язык, тема, кнопка входа',
             'Сцена: объекты — элементы DOM, фон и эффекты — холсты canvas',
             'Правая панель: 12 вкладок со всеми настройками',
             'Нижняя строка: время, состояние соединения, подсказки',
             'Раскладка приспособлена для экранов от 320 пикселей',
         ],
         note='Окно делится на четыре области. Сцена занимает центр: именно на ней видны '
              'объекты, анимации, эффекты и общая доска.'),

    dict(kind='bullets', title='Объекты и сцена',
         bullets=[
             '11 типов: круг, квадрат, треугольник, звезда, сердце, шестиугольник, кольцо, '
             'эмодзи, текст, изображение, видео',
             'Свойства: размер, цвет, прозрачность, свечение, радиус, положение',
             'Несколько объектов сразу, у каждого — свои настройки',
             '12 фонов и сезонные эффекты: снег, дождь, листопад, туман, конфетти, звёзды',
             'Погода на сцене по данным метеосервисов, эффекты курсора',
         ],
         note='Фигуры сделаны на CSS через clip-path, поэтому их можно плавно превращать друг '
              'в друга. Фон, частицы и доска рисуются на отдельных холстах под объектами.'),

    dict(kind='bullets', title='Анимации, траектории, физика',
         bullets=[
             '20 готовых анимаций: pulse, rotate, bounce, heartbeat, spiral, orbit, morph и другие',
             'Настраиваются длительность, задержка, число повторов и скорость',
             'Несколько анимаций одновременно: они складываются, а не заменяют друг друга',
             'Траектории: окружность, восьмёрка или путь, нарисованный мышью',
             'Физика: гравитация, отскок с коэффициентом 0,78, столкновения объектов',
         ],
         note='Анимации работают через Web Animations API с параметром composite add — поэтому '
              'пульсация не отменяет вращение. Траектория задаётся формулой или списком точек.'),

    dict(kind='image', title='Таймлайн: ключевые кадры', img='fig3-timeline.png',
         bullets=[
             'Ключи по семи свойствам: X, Y, размер, прозрачность, свечение, радиус, цвет',
             'Значения между ключами программа считает сама — линейной интерполяцией',
             'Ключ можно выделить и перетащить по шкале времени',
             'Есть воспроизведение, пауза, зацикливание и список всех ключей',
         ],
         note='Таймлайн превращает набор настроек в маленький мультфильм: пользователь ставит '
              'ключи в начале и в конце, а всё, что между ними, рассчитывается автоматически.'),

    dict(kind='bullets', title='Трёхмерные фигуры и WebGL',
         bullets=[
             'CSS 3D без библиотек: куб, пирамида, призма, цилиндр, сфера, тор, кубик Рубика',
             'Настраиваются оси и скорость вращения, перспектива, материал',
             'Камера управляется мышью, а на телефоне — наклоном устройства',
             'Отдельная сцена на Three.js; если библиотека недоступна, работает CSS 3D',
         ],
         note='Трёхмерный режим построен на CSS-трансформациях, поэтому он работает даже без '
              'WebGL и без сети. WebGL-сцена подключается дополнительно.'),

    dict(kind='bullets', title='Звук, микрофон, голос',
         bullets=[
             'Генерация звука на Web Audio: форма волны, частота, громкость, длительность',
             'Визуализатор микрофона: спектр голоса управляет объектами сцены',
             'Синтез речи: программа произносит текст вслух',
             'Голосовое управление: «снег», «тема океан», «стоп» — в Chrome и Edge',
         ],
         note='Звук не хранится в файлах, а вычисляется в браузере, поэтому в проекте нет ни '
              'одной звуковой дорожки и программа остаётся полностью автономной.'),

    dict(kind='image', title='Архитектура', img='fig1-architecture.png',
         bullets=[
             'Клиент — 50 ES-модулей: браузер грузит их напрямую, без сборщика',
             'Сервер — room_server.py на стандартной библиотеке Python 3.10+',
             'Медиаданные звонка идут напрямую между браузерами, сервер только помогает '
             'установить соединение',
             'Состояние программы хранится в одном объекте, модули общаются через шину событий',
         ],
         note='Такое разделение позволяет разбирать на уроке каждую часть отдельно: клиент, '
              'сервер и канал звонка почти не зависят друг от друга.'),

    dict(kind='image', title='Модули клиента', img='fig8-modules.png',
         bullets=[
             'js/core — ядро: состояние, перевод, медиа, кодировщик GIF, плагины',
             'js/scene — сцена: фигуры, анимации, физика, 3D, эффекты, запись',
             'js/ui — интерфейс: панели, таймлайн, палитра команд, горячие клавиши',
             'js/net — сеть: транспорт, сессия, чат, доска, звонок, QR-код',
             'js/features — возможности: звук, погода, игры, песочница, журнал',
         ],
         note='Пять папок, пятьдесят файлов. Один модуль — одна задача: это позволяет '
              'показывать на занятии отдельные части программы, не объясняя всю остальную.'),

    dict(kind='image', title='Схема сети', img='fig6-network.png',
         bullets=[
             'Основной канал — WebSocket: состояния, чат, курсоры, доска, игры',
             'Запасной — SSE, если WebSocket закрыт прокси или антивирусом',
             'REST — вход в комнату, загрузка файлов, журнал, внешние данные',
             'Обмен короткими JSON-сообщениями: у клиента поле kind, у сервера — type',
             'При обрыве связи — переподключение с задержкой до 15 секунд, без перезагрузки',
         ],
         note='Три транспорта нужны для надёжности: если в школьной сети закрыт WebSocket, '
              'программа сама переходит на запасной канал, и урок продолжается.'),

    dict(kind='bullets', title='Комнаты, роли, чат, доска, опросы',
         bullets=[
             'Комната — шестизначный код; войти можно по коду или по QR-коду',
             'Роли: ведущий — первый вошедший, остальные — участники',
             'Чат с реакциями, уведомлениями и индикатором «печатает…»',
             'Общая доска: рисуют все одновременно, можно записать и сохранить',
             'Опросы: создание, голосование, закрытие — результат виден сразу',
         ],
         note='Многопользовательский режим собран вокруг комнаты. Состояние комнаты '
              'сохраняется на диске каждые 15 секунд, поэтому урок переживает перезапуск '
              'сервера.'),

    dict(kind='bullets', title='Звонок, экран, панель ведущего',
         bullets=[
             'Видеозвонок и демонстрация экрана по WebRTC, напрямую между браузерами',
             'Сервер участвует только в установлении соединения и пересылает сигналы',
             'Есть STUN, переподключение и «доезд» новых участников к начатому звонку',
             'Панель ведущего: заморозить комнату, исключить участника, дать объявление',
             'Живые курсоры: видно, кто и где работает на сцене',
         ],
         note='Прямой канал связи разгружает сервер: видео и голос идут между браузерами, '
              'а сервер пересылает только короткие служебные сообщения.'),

    dict(kind='bullets', title='Общая сцена, журнал, плагины',
         bullets=[
             'Общая сцена: один «холст» на всех, правки любого участника видны сразу',
             'Своя сцена при этом сохраняется — вернуться к ней можно в любой момент',
             'Журнал занятия: до 800 событий, выгрузка в Markdown',
             'Плагины: открытое API window.__motion и песочница без доступа к document',
             'Три готовых примера плагина находятся во вкладке «Справка»',
         ],
         note='Общая сцена нужна, когда преподаватель показывает приём: ученики видят ровно '
              'то, что делает учитель, но могут в любой момент вернуться к своей работе.'),

    dict(kind='image', title='Мини-игры', img='fig4-games.png',
         bullets=[
             'Шахматы и крестики-нолики: партия живёт на сервере, игроки — в разных браузерах',
             'Правила и проверка ходов выполняются на сервере, поэтому «схитрить» нельзя',
             'Клиент получает список разрешённых ходов и подсвечивает их на доске',
             'Змейка и «камень, ножницы, бумага» работают локально, без сервера',
             'Результат партии попадает в ленту событий и журнал занятия',
         ],
         note='Шахматный движок написан заново: он поддерживает рокировку, взятие на проходе, '
              'превращение пешки, шах, мат и пат, и покрыт 34 проверками.'),

    dict(kind='image', title='Песочница «Порошок»', img='fig5-powder.png',
         bullets=[
             'Клеточный автомат: 38 элементов в шести группах',
             'Рисуем кистью: песок, вода, огонь, лава, кислота, металл, растения',
             'Реакции: вода гасит огонь, лава в воде становится обсидианом, кислота ест породу',
             'Шесть демонстраций: вулкан, дождь, химия, фейерверк, цепь, пустое поле',
             'Счётчики элементов, пауза и очистка поля',
         ],
         note='Песочница — самая наглядная часть программы: на ней удобно объяснять, что такое '
              'моделирование, состояние клетки и правила перехода между состояниями.'),

    dict(kind='image', title='Шаг клеточного автомата', img='fig7-algorithm.png',
         bullets=[
             'Обход поля снизу вверх; направление меняется каждый кадр',
             'Метка «уже двигалась» не даёт клетке сместиться дважды за кадр',
             'Тяжёлое вытесняет лёгкое: песок тонет в воде, вода топит газы',
             'Пять типизированных массивов: тип, жизнь, метка, прошлое, шум',
             'Поле до 30 тысяч клеток, шаг повторяется 60 раз в секунду',
         ],
         note='Обход снизу вверх — ключевой приём: иначе сыпучие тела проваливались бы за кадр '
              'на несколько клеток. Смена направления убирает «заваливание» куч в одну сторону.'),

    dict(kind='image', title='Путь одного кадра и свои алгоритмы', img='fig9-frame.png',
         bullets=[
             'Кадр: ввод → состояние → расчёт → отрисовка → обмен, 60 раз в секунду',
             'Свой генератор QR-кодов: стандарт ISO/IEC 18004, версии 1–10, уровень M',
             'Свой кодировщик GIF89a: палитра 256 цветов и сжатие LZW',
             'Свой шахматный движок: рокировка, взятие на проходе, мат и пат',
             'QR и GIF проверяются независимыми декодерами — чужими программами',
         ],
         note='Собственные реализации появились не случайно: проект должен работать без '
              'интернета и без библиотек, поэтому кодировщики написаны с нуля и проверены '
              'внешними декодерами.'),

    dict(kind='image', title='Технологии, проверки, запуск', img='fig10-tests.png',
         bullets=[
             'HTML5, CSS3, ES-модули, Canvas 2D, Web Animations, Web Audio, WebRTC, Python 3',
             '11 наборов автоматических проверок: 405 проверок, все проходят',
             'Запуск: python3 room_server.py, затем адрес http://localhost:8080',
             'Работает без интернета: офлайн-кэш, запасные источники погоды и курсов',
             'Спасибо за внимание!',
         ],
         note='Итог: программа собрана из стандартных браузерных и серверных средств, '
              'полностью проверена автоматическими тестами и запускается одним файлом.'),
]


# ---------------------------------------------------------------------------
# Общие helpers
# ---------------------------------------------------------------------------

def plain(text):
    return re.sub(r'\*\*(.+?)\*\*', r'\1', str(text))


def inline(text):
    s = html.escape(str(text), quote=False)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    return s


def figure_names():
    return [s['img'] for s in SLIDES if s.get('img')]


def png_size(path):
    """Размер PNG из заголовка (PIL в проекте нет, да он и не нужен)."""
    with open(path, 'rb') as fh:
        head = fh.read(26)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        return 1240, 700
    w = int.from_bytes(head[16:20], 'big')
    h = int.from_bytes(head[20:24], 'big')
    return w, h


# ---------------------------------------------------------------------------
# PPTX
# ---------------------------------------------------------------------------

def build_pptx():
    try:
        from pptx import Presentation
        from pptx.util import Inches, Pt, Emu
        from pptx.dml.color import RGBColor
        from pptx.enum.text import PP_ALIGN, MSO_ANCHOR
    except ImportError:
        print('  python-pptx не установлен — PPTX пропущен (HTML готов)')
        return False

    DARK = RGBColor(0x0b, 0x10, 0x20)
    TITLE_C = RGBColor(0x0f, 0x17, 0x2a)
    TEXT_C = RGBColor(0x1f, 0x29, 0x37)
    MUTED_C = RGBColor(0x6b, 0x72, 0x80)
    WHITE = RGBColor(0xff, 0xff, 0xff)
    ACCENT = RGBColor(0x0e, 0xa5, 0xe9)

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)
    blank = prs.slide_layouts[6]

    def add_rect(slide, x, y, w, h, color):
        from pptx.enum.shapes import MSO_SHAPE
        shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)
        shape.fill.solid()
        shape.fill.fore_color.rgb = color
        shape.line.fill.background()
        shape.shadow.inherit = False
        return shape

    def add_text(slide, x, y, w, h, size=18, color=None, bold=False, align=PP_ALIGN.LEFT,
                 anchor=MSO_ANCHOR.TOP, spacing=1.0, font='Times New Roman'):
        box = slide.shapes.add_textbox(x, y, w, h)
        tf = box.text_frame
        tf.word_wrap = True
        tf.vertical_anchor = anchor
        tf.margin_left = 0
        tf.margin_right = 0
        tf.margin_top = 0
        tf.margin_bottom = 0
        if tf.paragraphs:
            tf.paragraphs[0].alignment = align
        return box

    def write_lines(box, lines, size, color, bold=False, space_after=8, spacing=1.0,
                    font='Times New Roman', bullet='• ', align=PP_ALIGN.LEFT):
        tf = box.text_frame
        tf.clear()
        for i, line in enumerate(lines):
            p = tf.paragraphs[0] if (i == 0 and tf.paragraphs) else tf.add_paragraph()
            p.text = (bullet + line) if bullet else line
            p.level = 0
            p.space_after = Pt(space_after)
            p.line_spacing = spacing
            p.alignment = align
            for run in p.runs:
                run.font.size = Pt(size)
                run.font.bold = bold
                run.font.color.rgb = color
                run.font.name = font

    for idx, s in enumerate(SLIDES, start=1):
        slide = prs.slides.add_slide(blank)

        if s['kind'] == 'title':
            add_rect(slide, 0, 0, prs.slide_width, prs.slide_height, DARK)
            add_rect(slide, 0, 0, Inches(0.28), prs.slide_height, ACCENT)
            box = add_text(slide, Inches(1.1), Inches(2.0), Inches(11.1), Inches(1.4))
            write_lines(box, [s['title']], 44, WHITE, bold=True, bullet='', space_after=0)
            box = add_text(slide, Inches(1.1), Inches(3.5), Inches(10.5), Inches(1.2))
            write_lines(box, [s['sub']], 22, RGBColor(0x93, 0xc5, 0xfd), bullet='',
                        space_after=0, spacing=1.2)
            box = add_text(slide, Inches(1.1), Inches(5.1), Inches(10.5), Inches(1.6))
            write_lines(box, [plain(x) for x in s['meta']], 16, RGBColor(0xc7, 0xd2, 0xde),
                        bullet='', space_after=8, spacing=1.1)
            continue

        # --- обычный слайд -------------------------------------------------
        add_rect(slide, 0, 0, prs.slide_width, Inches(0.14), DARK)
        box = add_text(slide, Inches(0.75), Inches(0.45), Inches(11.8), Inches(0.9))
        write_lines(box, [s['title']], 30, TITLE_C, bold=True, bullet='', space_after=0)
        add_rect(slide, Inches(0.75), Inches(1.42), Inches(1.9), Inches(0.06), ACCENT)

        bullets = [plain(b) for b in s.get('bullets', [])]
        has_img = bool(s.get('img'))
        size = 17 if len(bullets) >= 5 else 18
        top = Inches(1.75)

        if has_img:
            box = add_text(slide, Inches(0.75), top, Inches(6.35), Inches(4.55))
            write_lines(box, bullets, size, TEXT_C, spacing=1.05, space_after=10)

            path = os.path.join(IMG_DIR, s['img'])
            box_w, box_h = Inches(5.3), Inches(4.55)
            left, top_img = Inches(7.4), Inches(1.75)
            iw, ih = png_size(path)
            scale = min(box_w / iw, box_h / ih)
            w, h = int(iw * scale), int(ih * scale)
            slide.shapes.add_picture(path, left + int((box_w - w) / 2),
                                     top_img + int((box_h - h) / 2), w, h)
        else:
            if len(bullets) > 4:
                half = (len(bullets) + 1) // 2
                box = add_text(slide, Inches(0.75), top, Inches(5.7), Inches(4.55))
                write_lines(box, bullets[:half], size, TEXT_C, spacing=1.05, space_after=12)
                box = add_text(slide, Inches(7.0), top, Inches(5.6), Inches(4.55))
                write_lines(box, bullets[half:], size, TEXT_C, spacing=1.05, space_after=12)
            else:
                box = add_text(slide, Inches(0.75), top, Inches(11.8), Inches(4.55))
                write_lines(box, bullets, 19, TEXT_C, spacing=1.1, space_after=14)

        # --- подвал --------------------------------------------------------
        add_rect(slide, Inches(0.75), Inches(6.95), Inches(11.83), Emu(9525), MUTED_C)
        box = add_text(slide, Inches(0.75), Inches(7.05), Inches(8.0), Inches(0.35))
        write_lines(box, [DECK_TITLE], 11, MUTED_C, bullet='', space_after=0)
        box = add_text(slide, Inches(11.3), Inches(7.05), Inches(1.28), Inches(0.35))
        write_lines(box, [str(idx)], 11, MUTED_C, bullet='', space_after=0, align=PP_ALIGN.RIGHT)

        if s.get('note'):
            slide.notes_slide.notes_text_frame.text = plain(s['note'])

    prs.save(PPTX_PATH)
    return True


# ---------------------------------------------------------------------------
# HTML
# ---------------------------------------------------------------------------

CSS = """
* { box-sizing: border-box; }
html, body { margin:0; padding:0; height:100%; background:#0b1020; overflow:hidden;
             font-family:'Times New Roman',Times,serif; }
#stage { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; }
#scaler { width:1280px; height:720px; transform-origin:center center; position:relative; }
.slide { position:absolute; inset:0; width:1280px; height:720px; background:#ffffff;
         display:none; padding:0; overflow:hidden; box-shadow:0 10px 40px rgba(0,0,0,.5); }
.slide.on { display:block; }
.slide .bar { position:absolute; left:0; top:0; width:1280px; height:14px; background:#0b1020; }
.slide h1 { position:absolute; left:56px; top:38px; width:1170px; margin:0; font-size:40px;
            line-height:1.15; font-weight:bold; color:#0f172a; }
.slide .rule { position:absolute; left:56px; top:118px; width:130px; height:5px;
               background:#0ea5e9; }
.slide ul { position:absolute; left:56px; top:150px; width:590px; margin:0; padding:0;
            list-style:none; }
.slide ul.two { width:560px; }
.slide ul.right { left:650px; width:575px; }
.slide li { font-size:24px; line-height:1.32; color:#1f2937; margin:0 0 16px 26px;
            position:relative; }
.slide li::before { content:"\\2022"; color:#0ea5e9; position:absolute; left:-24px;
                    font-weight:bold; }
.slide .pic { position:absolute; left:660px; top:150px; width:575px; height:490px;
              display:flex; align-items:center; justify-content:center; }
.slide .pic img { max-width:100%; max-height:100%; height:auto; }
.slide .foot { position:absolute; left:56px; bottom:26px; width:1170px; height:1px;
               background:#cbd5e1; }
.slide .footname { position:absolute; left:56px; bottom:8px; font-size:15px; color:#6b7280; }
.slide .num { position:absolute; right:56px; bottom:8px; font-size:15px; color:#6b7280; }
/* титульный слайд */
.slide.title { background:#0b1020; }
.slide.title .accent { position:absolute; left:0; top:0; width:26px; height:720px;
                       background:#0ea5e9; }
.slide.title h1 { top:196px; left:96px; color:#ffffff; font-size:62px; width:1100px; }
.slide.title .sub { position:absolute; left:96px; top:330px; width:1000px; font-size:27px;
                    line-height:1.35; color:#93c5fd; }
.slide.title .meta { position:absolute; left:96px; top:480px; width:1000px; font-size:20px;
                     line-height:1.7; color:#c7d2de; }
/* управление */
#ui { position:fixed; right:18px; bottom:16px; display:flex; gap:8px; align-items:center;
      z-index:10; }
#ui button { font:16px/1 'Times New Roman',serif; padding:8px 14px; border:1px solid #334155;
             background:#111827; color:#e5e7eb; border-radius:6px; cursor:pointer; }
#ui button:hover { background:#1f2937; }
#count { color:#e5e7eb; font:16px/1 'Times New Roman',serif; padding:0 6px; }
#hint { position:fixed; left:18px; bottom:16px; color:#64748b; font:14px/1 'Times New Roman',serif;
        z-index:10; }
@media print {
  html, body { overflow:visible; background:#ffffff; }
  #stage { position:static; display:block; }
  #scaler { transform:none !important; width:auto; height:auto; }
  .slide { display:block !important; position:relative; page-break-after:always;
           box-shadow:none; }
  #ui, #hint { display:none; }
}
@page { size: 1280px 720px; margin:0; }
"""

JS = """
(function () {
  var slides = Array.prototype.slice.call(document.querySelectorAll('.slide'));
  var i = 0;
  var count = document.getElementById('count');
  function show(n) {
    i = Math.max(0, Math.min(slides.length - 1, n));
    slides.forEach(function (s, k) { s.classList.toggle('on', k === i); });
    count.textContent = (i + 1) + ' / ' + slides.length;
    if (location.hash !== '#' + (i + 1)) { history.replaceState(null, '', '#' + (i + 1)); }
  }
  function next() { show(i + 1); }
  function prev() { show(i - 1); }
  document.getElementById('next').addEventListener('click', next);
  document.getElementById('prev').addEventListener('click', prev);
  document.getElementById('first').addEventListener('click', function () { show(0); });
  document.getElementById('print').addEventListener('click', function () { window.print(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ' || e.key === 'Enter') {
      e.preventDefault(); next();
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || e.key === 'Backspace') {
      e.preventDefault(); prev();
    } else if (e.key === 'Home') { show(0); }
    else if (e.key === 'End') { show(slides.length - 1); }
  });
  document.getElementById('stage').addEventListener('click', function (e) {
    if (e.clientX > window.innerWidth * 0.25) { next(); } else { prev(); }
  });
  function fit() {
    var s = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
    document.getElementById('scaler').style.transform = 'scale(' + s + ')';
  }
  window.addEventListener('resize', fit);
  fit();
  var start = parseInt((location.hash || '#1').slice(1), 10);
  show(isNaN(start) ? 0 : start - 1);
})();
"""


def b64(name, cache):
    if name not in cache:
        with open(os.path.join(IMG_DIR, name), 'rb') as fh:
            cache[name] = base64.b64encode(fh.read()).decode('ascii')
    return cache[name]


def slide_html(s, idx, cache):
    parts = [f'<section class="slide{" title" if s["kind"] == "title" else ""}" data-n="{idx}">']
    if s['kind'] == 'title':
        parts.append('<div class="accent"></div>')
        parts.append(f'<h1>{inline(s["title"])}</h1>')
        parts.append(f'<div class="sub">{inline(s["sub"])}</div>')
        parts.append('<div class="meta">' + '<br>'.join(inline(x) for x in s['meta']) + '</div>')
        parts.append(f'<div class="num">{idx}</div>')
        parts.append('</section>')
        return '\n'.join(parts)

    parts.append('<div class="bar"></div>')
    parts.append(f'<h1>{inline(s["title"])}</h1>')
    parts.append('<div class="rule"></div>')
    bullets = s.get('bullets', [])
    if s.get('img'):
        parts.append('<ul>' + ''.join(f'<li>{inline(b)}</li>' for b in bullets) + '</ul>')
        src = 'data:image/png;base64,' + b64(s['img'], cache)
        parts.append(f'<div class="pic"><img src="{src}" alt="{html.escape(s["title"])}"></div>')
    elif len(bullets) > 4:
        half = (len(bullets) + 1) // 2
        parts.append('<ul class="two">' + ''.join(f'<li>{inline(b)}</li>'
                                                  for b in bullets[:half]) + '</ul>')
        parts.append('<ul class="right">' + ''.join(f'<li>{inline(b)}</li>'
                                                    for b in bullets[half:]) + '</ul>')
    else:
        parts.append('<ul style="width:1170px">' + ''.join(f'<li>{inline(b)}</li>'
                                                           for b in bullets) + '</ul>')
    parts.append('<div class="foot"></div>')
    parts.append(f'<div class="footname">{DECK_TITLE}</div>')
    parts.append(f'<div class="num">{idx}</div>')
    parts.append('</section>')
    return '\n'.join(parts)


def build_html():
    cache = {}
    body = '\n'.join(slide_html(s, i, cache) for i, s in enumerate(SLIDES, start=1))
    text = (
        '<!DOCTYPE html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n'
        f'<title>{html.escape(DECK_TITLE)} — презентация</title>\n'
        f'<style>{CSS}</style>\n</head>\n<body>\n'
        '<div id="stage"><div id="scaler">\n' + body + '\n</div></div>\n'
        '<div id="ui">'
        '<button id="first" title="На первый слайд">«</button>'
        '<button id="prev" title="Назад">←</button>'
        '<span id="count">1 / ' + str(len(SLIDES)) + '</span>'
        '<button id="next" title="Вперёд">→</button>'
        '<button id="print" title="Печать">Печать</button>'
        '</div>\n'
        '<div id="hint">стрелки, пробел или щелчок — перелистывание; Home / End — начало и конец'
        '</div>\n'
        f'<script>{JS}</script>\n</body></html>\n'
    )
    with open(HTML_PATH, 'w', encoding='utf-8-sig') as fh:
        fh.write(text)
    return len(text)


# ---------------------------------------------------------------------------

def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    missing = [n for n in figure_names() if not os.path.exists(os.path.join(IMG_DIR, n))]
    if missing:
        print('Нет рисунков:', ', '.join(missing))
        print('Сначала запустите: python3 tools/make_report_images.py')
        return 1
    print(f'Слайдов: {len(SLIDES)}')
    size = build_html()
    print(f'  {os.path.relpath(HTML_PATH, ROOT)}  ({size // 1024} КБ)')
    if build_pptx():
        print(f'  {os.path.relpath(PPTX_PATH, ROOT)}  ({os.path.getsize(PPTX_PATH) // 1024} КБ)')
    print('Презентация собрана.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
