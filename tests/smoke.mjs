// Дымовой тест фронтенда в Node: загружает index.html в мини-DOM, импортирует js/main.js,
// проходит вход в сессию (нужен запущенный room_server.py на :8080) и кликает по основным
// элементам интерфейса. Любая ошибка выполнения — провал теста.
//   node tests/smoke.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { installGlobals, MiniKeyboardEvent, MiniMouseEvent, MiniEvent } from './minidom.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const { document, window } = installGlobals(html);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
process.on('unhandledRejection', (err) => errors.push({ where: 'unhandledRejection', err }));
process.on('uncaughtException', (err) => errors.push({ where: 'uncaughtException', err }));
const origError = console.error;
console.error = (...args) => { errors.push({ where: 'console.error', err: args.map(String).join(' ') }); origError(...args); };
const warnings = [];
console.warn = (...args) => { warnings.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' ')); };
console.info = () => {};

let passed = 0;
function check(name, cond) {
  if (cond) passed += 1; else errors.push({ where: `check: ${name}`, err: 'failed' });
  console.log(`${cond ? '✓' : '✗'} ${name}`);
}
function $(sel) { return document.querySelector(sel); }
function click(sel) { const el = typeof sel === 'string' ? $(sel) : sel; if (!el) { errors.push({ where: `click ${sel}`, err: 'not found' }); return; } el.click(); }
function input(sel, value, type = 'input') { const el = $(sel); el.value = value; el.dispatchEvent(new MiniEvent(type)); }
function change(sel, value) { const el = $(sel); if (typeof value === 'boolean') el.checked = value; else el.value = value; el.dispatchEvent(new MiniEvent('input')); el.dispatchEvent(new MiniEvent('change')); }
function key(k, init = {}) { window.dispatchEvent(new MiniKeyboardEvent('keydown', { key: k, target: document.activeElement, ...init })); }
function pointer(el, type, x, y, extra = {}) {
  el.dispatchEvent(new MiniMouseEvent(type, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1, isPrimary: true, ...extra }));
}

// --- Загрузка приложения ---------------------------------------------------------
await import(pathToFileURL(path.join(root, 'js/main.js')).href);
await sleep(300);
check('приложение загрузилось (body.ready)', document.body.classList.contains('ready'));
check('i18n применён (заголовок входа)', $('#entryTitle').textContent.includes('Motion Playground'));
check('сетка фигур построена (10 + видео)', document.querySelectorAll('#shapeGrid .shape-btn').length === 11);
check('список анимаций построен', document.querySelectorAll('#animationList .anim-card').length === 20);
check('3D-фигуры построены', document.querySelectorAll('#shape3dGrid .shape-btn').length === 9);
check('пресеты фона', document.querySelectorAll('#bgPresetGrid .bg-btn').length === 10);
check('объект на сцене отрисован', document.querySelectorAll('#objectsLayer .obj').length >= 1);
check('достижения отрисованы', document.querySelectorAll('#achievementsGrid .ach').length > 40);
check('таблица горячих клавиш', document.querySelectorAll('#hotkeysTable tr').length > 10);
check('справка отрисована', document.querySelectorAll('#helpContent details').length === 6);
check('фаза Луны', $('#moonBody').textContent.length > 5);
check('часы', $('#clockChip').textContent.includes(':'));
await sleep(700);
check('сервер проверен на экране входа', $('#entryStatus').classList.contains('online'));

// --- Вход в сессию ----------------------------------------------------------------------
input('#entryUserName', 'Smoke');
click('#avatarGrid .avatar-btn:not(.active)');
click('#entryCreateRoom'); // новая комната — тест изолирован от других сессий
await sleep(1500);
check('сессия подключена', document.body.classList.contains('session-active'));
check('экран входа скрыт', $('#entryGate').hidden === true);
check('mainApp активен', !$('#mainApp').inert);
check('комната показана в шапке', $('#roomChip').textContent.trim().length > 0);
check('витрина участников содержит меня', document.querySelectorAll('#usersShowcase .user-model-card').length >= 1);
check('лента получила запись о входе', document.querySelectorAll('#activityFeed .feed-item').length >= 1);
const transport = $('#sessionTransport').textContent;
check(`транспорт: ${transport}`, /WebSocket|SSE/.test(transport));

// --- Вкладки -----------------------------------------------------------------------------
for (const tab of ['animations', 'model', 'scene', 'sound', 'session', 'widgets', 'achievements', 'help', 'object']) {
  click(`.tab[data-tab="${tab}"]`);
  check(`вкладка ${tab} активна`, $(`.panel[data-panel="${tab}"]`).classList.contains('active'));
}

// --- Объект -------------------------------------------------------------------------------
const store = await import(pathToFileURL(path.join(root, 'js/core/store.js')).href);
click('#shapeGrid .shape-btn[data-shape="star"]');
check('фигура → star', store.activeObject().shape === 'star');
change('#objColor', '#ff0000');
check('цвет применён', store.activeObject().color === '#ff0000');
change('#objSize', '200');
check('размер применён', store.activeObject().size === 200);
change('#objGlow', '0.5');
change('#objStroke', '4');
change('#objRadius', '30');
change('#objOpacity', '0.8');
input('#objEmoji', '🐱'); await sleep(300);
check('emoji-фигура', store.activeObject().shape === 'emoji' && store.activeObject().emoji === '🐱');
input('#objText', 'Hi'); await sleep(300);
check('текстовая фигура', store.activeObject().shape === 'text');
click('#shapeGrid .shape-btn[data-shape="heart"]');
click('#addObjectBtn');
check('объект добавлен', store.state.objects.length === 2);
input('#objVideoUrl', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'); click('#objVideoUrlBtn');
check('объект-видео с YouTube', store.activeObject().shape === 'video' && store.activeObject().video?.provider === 'youtube');
check('объект-видео отрисован плеером', !!$('#objectsLayer .obj.active iframe') || !!$('#objectsLayer .shape-video'));
input('#objVideoUrl', 'https://rutube.ru/video/3f8c1e2b9a7d5c4e6f0a1b2c3d4e5f6a/'); click('#objVideoUrlBtn');
check('объект-видео с Rutube', store.activeObject().video?.provider === 'rutube');
click('#duplicateObjectBtn');
check('объект продублирован', store.state.objects.length === 3);
check('список объектов', document.querySelectorAll('#objectsList .object-item').length === 3);
click('#layerDownBtn'); click('#layerUpBtn');
click('#objectsList .object-item:last-child');
click('#removeObjectBtn');
check('объект удалён', store.state.objects.length === 2);
click('#resetPosBtn');
// перетаскивание объекта на сцене
const objNode = $('#objectsLayer .obj.active') || $('#objectsLayer .obj');
pointer(objNode, 'pointerdown', 400, 250);
pointer($('#stage'), 'pointermove', 440, 280);
pointer($('#stage'), 'pointerup', 440, 280);
await sleep(100);
check('объект перетащен', store.activeObject().x !== 0 || store.activeObject().y !== 0);

// --- Анимации -----------------------------------------------------------------------------
click('.tab[data-tab="animations"]');
click('#animationList .anim-card[data-key="rotate"]');
click('#animationList .anim-card[data-key="bounce"]');
check('комбинация анимаций', store.activeObject().animations.includes('rotate') && store.activeObject().animations.includes('bounce'));
click('#animationList .anim-card[data-key="rotate"] .anim-fav');
check('избранное', $('#animationList .anim-card[data-key="rotate"]').classList.contains('fav'));
input('#animSearch', 'пульс');
check('поиск фильтрует', document.querySelectorAll('#animationList .anim-card').length === 1);
input('#animSearch', '');
change('#favOnly', true);
check('только избранные', document.querySelectorAll('#animationList .anim-card').length === 1);
change('#favOnly', false);
change('#speed', '2');
check('скорость', store.state.speed === 2 && $('#speedValue').textContent === 'x2.0');
change('#trajectorySelect', 'circle');
check('траектория circle', store.activeObject().trajectory === 'circle');
change('#trajectorySelect', 'eight');
click('#clearAnimsBtn');
check('анимации сняты', store.activeObject().animations.length === 0);
// запись пути
click('#recordPathBtn');
check('режим записи пути', $('#stage').classList.contains('recording-path'));
pointer($('#stage'), 'pointerdown', 100, 100);
for (let i = 0; i < 12; i += 1) pointer($('#stage'), 'pointermove', 100 + i * 20, 100 + i * 10);
pointer($('#stage'), 'pointerup', 340, 220);
await sleep(100);
check('путь записан', store.activeObject().customPath.length > 5 && store.activeObject().trajectory === 'custom');
click('#clearPathBtn');
check('путь очищен', store.activeObject().customPath.length === 0);
click('#stopBtn'); check('стоп', store.state.playing === false);
click('#startBtn'); check('старт', store.state.playing === true);

// --- 3D -----------------------------------------------------------------------------------
click('.tab[data-tab="model"]');
change('#use3d', true);
check('3D включён', store.state.use3d && !$('#model3dWrap').classList.contains('hidden'));
check('CSS-модель построена', document.querySelectorAll('#model3d .m3-face').length >= 6);
for (const s of ['pyramid', 'prism', 'cylinder', 'sphere', 'dodecahedron', 'torus']) {
  click(`#shape3dGrid .shape-btn[data-shape3d="${s}"]`);
  check(`3D-фигура ${s}`, store.state.shape3d === s && document.querySelectorAll('#model3d .m3-face').length > 3);
}
click('#shape3dGrid .shape-btn[data-shape3d="dice"]');
check('кость построена', document.querySelectorAll('#model3d .dice-face').length === 6 && document.querySelectorAll('#model3d .pip.on').length === 21);
click('#diceRollBtn');
await sleep(2200);
check('результат броска', /[1-6]/.test($('#diceResult').textContent));
click('#shape3dGrid .shape-btn[data-shape3d="rubik"]');
check('кубик Рубика построен', document.querySelectorAll('#model3d .cubelet').length === 27);
click('#rubikMoves [data-move="R"]');
await sleep(400);
click('#rubikScrambleBtn');
await sleep(300);
click('#rubikSolveBtn');
change('#modelZoom', '1.5');
check('зум модели', store.state.modelZoom === 1.5);
// вращение мышью
const model = $('#model3d');
pointer(model, 'pointerdown', 400, 250);
pointer($('#stage'), 'pointermove', 450, 260);
pointer($('#stage'), 'pointerup', 450, 260);
await sleep(200);
click('#resetCameraBtn');
check('камера сброшена', store.state.modelZoom === 1);
click('#gyroBtn'); // без DeviceOrientationEvent — должно быть сообщение, не ошибка
change('#webglToggle', true); // без сети three.js не загрузится — ждём отката
await sleep(500);
change('#use3d', false);
check('2D снова', !store.state.use3d);

// --- Сцена -------------------------------------------------------------------------------
click('.tab[data-tab="scene"]');
for (const theme of ['dark', 'pastel', 'light', 'cyberpunk', 'ocean', 'forest', 'retro', 'neon']) {
  change('#themeSelect', theme);
  check(`тема ${theme}`, document.body.classList.contains(`theme-${theme}`));
}
change('#cursorFxSelect', 'sparkles');
click('#bgPresetGrid .bg-btn[data-bg="aurora"]');
check('фон aurora', store.state.background.value === 'aurora');
change('#bgColor', '#123456');
check('фон цвет', store.state.background.type === 'color');
input('#bgUrl', 'https://example.com/video.mp4'); click('#bgUrlBtn');
check('фон видео по URL', store.state.background.type === 'video' && store.state.background.provider === 'file');
input('#bgUrl', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'); click('#bgUrlBtn');
check('фон: YouTube вставляется плеером', store.state.background.provider === 'youtube' && $('#stageVideoFrame').src.includes('youtube-nocookie'));
input('#bgUrl', 'https://rutube.ru/video/3f8c1e2b9a7d5c4e6f0a1b2c3d4e5f6a/'); click('#bgUrlBtn');
check('фон: Rutube вставляется плеером', store.state.background.provider === 'rutube' && $('#stageVideoFrame').src.includes('rutube.ru/play/embed'));
input('#bgUrl', 'https://example.com/pic.png'); click('#bgUrlBtn');
check('фон: картинка по URL', store.state.background.type === 'image');
click('#bgPresetGrid .bg-btn[data-bg="auto"]');
change('#parallaxToggle', true);
check('параллакс', store.state.background.parallax === true);
pointer($('#stage'), 'pointermove', 300, 200);
for (const fx of ['snow', 'rain', 'leaves', 'petals', 'fireflies', 'fog', 'confetti', 'stars', 'matrix']) {
  change('#effectSelect', fx);
  check(`эффект ${fx}`, store.state.effect === fx);
  await sleep(40);
}
change('#effectIntensity', '2');
change('#effectSelect', 'none');
change('#weatherSyncToggle', true);
change('#weatherSyncToggle', false);
change('#physicsToggle', true);
check('физика включена', store.state.physics);
change('#gravity', '2');
click('#kickBtn');
await sleep(400);
change('#physicsToggle', false);

check('кнопки доски на месте', !!$('#boardRecBtn') && !!$('#boardShotBtn') && !!$('#boardReplayBtn'));
click('#boardShotBtn');   // canvas в мини-DOM есть, но без 2D-контекста — ждём предупреждение, не ошибку
click('#boardReplayBtn'); // пустая доска → предупреждение

// --- Просмотр сцены участника ---------------------------------------------------------------
click('#usersShowcase .user-model-card .peek-btn');
check('просмотр чужой сцены открылся', $('#peekModal').hidden === false);
check('в просмотре есть объекты', $('#peekObjects').children.length >= 1);
click('#peekModal [data-close-modal]');
check('просмотр закрылся', $('#peekModal').hidden === true);
key('l'); key('l');
check('после смены языка окно просмотра не открывается само', $('#peekModal').hidden === true);

// --- Звук / голос ---------------------------------------------------------------------------
click('.tab[data-tab="sound"]');
click('#soundTestBtn');
change('#volume', '0.3');
click('#micBtn2'); // нет mediaDevices — ожидаем предупреждение
click('#voiceBtn2'); // нет SpeechRecognition — предупреждение
const voice = await import(pathToFileURL(path.join(root, 'js/features/voice.js')).href);
check('голосовая команда «стоп»', voice.handle('стоп') === 'stop' && store.state.playing === false);
check('голосовая команда «старт»', voice.handle('поехали старт') === 'start');
check('голосовая команда цвет', voice.handle('сделай синий') !== null && store.activeObject().color === '#3b82f6');
check('голосовая команда тема', voice.handle('тема океан') === 'theme ocean');
check('голосовая команда эффект', voice.handle('включи снег') === 'effect snow');
check('голосовая команда анимация', voice.handle('add bounce') === '+ bounce');
check('неизвестная фраза', voice.handle('бла бла') === null);

// --- Сессия: чат, реакции, опросы, доска, админ ---------------------------------------
click('.tab[data-tab="session"]');
check('я — ведущий (первый в комнате)', document.body.classList.contains('is-host') && !$('#adminCard').hidden);
input('#chatInput', 'Привет всем!');
$('#chatForm').dispatchEvent(new MiniEvent('submit'));
await sleep(400);
check('сообщение в чате', document.querySelectorAll('#chatMessages .chat-msg').length >= 1);
click('#emojiBar .emoji-btn');
check('emoji вставлен в поле', $('#chatInput').value.length > 0);
click('#reactionsBar .reaction-btn');
await sleep(300);
check('реакция всплыла', document.querySelectorAll('#reactionsLayer .reaction-float').length >= 1);
input('#pollQuestion', 'Какая анимация лучше?');
input('#pollOptions', 'pulse, rotate, bounce');
click('#createPollBtn');
await sleep(400);
check('опрос создан', document.querySelectorAll('#pollsList .poll').length === 1);
click('#pollsList .poll-option');
await sleep(300);
check('голос учтён', $('#pollsList .poll-option.mine') !== null);
// доска
click('#drawToggle');
check('режим доски', document.body.classList.contains('board-mode'));
const board = $('#boardCanvas');
pointer(board, 'pointerdown', 100, 100);
pointer(board, 'pointermove', 150, 130);
pointer(board, 'pointermove', 200, 160);
pointer(board, 'pointerup', 200, 160);
await sleep(400);
click('#boardClearBtn');
click('#drawToggle');
check('режим доски выключен', !document.body.classList.contains('board-mode'));
// админ
input('#announceInput', 'Тестовое объявление');
click('#announceBtn');
await sleep(400);
check('объявление показано', !$('#announceBar').hidden && $('#announceText').textContent.includes('Тестовое'));
click('#announceClose');
click('#freezeBtn'); await sleep(300);
click('#freezeBtn'); await sleep(300);
click('#pushSceneBtn'); await sleep(300);
click('#clearFeedBtn'); await sleep(300);
click('#clearChatBtn'); await sleep(300);
check('чат очищен', document.querySelectorAll('#chatMessages .chat-msg').length === 0);
click('#copyLinkBtn');
click('#qrBtn');
check('QR-модал открыт', !$('#qrModal').hidden && $('#qrUrl').textContent.includes('room='));
check('QR нарисован на canvas', ($('#qrCanvas').__ctxCalls || []).filter((c) => c === 'fillRect').length > 100);
key('Escape');
check('Esc закрыл модал', $('#qrModal').hidden);
change('#followHostToggle', true);
change('#followHostToggle', false);

// второй участник через WebSocket — проверяем, что UI реагирует на других
const session = await import(pathToFileURL(path.join(root, 'js/net/session.js')).href);
const room = session.session.room;
const joinRes = await (await fetch(`http://localhost:8080/api/join`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Ghost', avatar: '👻', tz: 'Asia/Tokyo', room, state: { theme: 'dark', use3d: true, shape3d: 'torus', objects: [{ shape: 'star', color: '#fff', animations: ['rotate'] }] } }) })).json();
const ghost = new WebSocket(`ws://localhost:8080/ws?room=${room}&userId=${joinRes.userId}`);
await new Promise((r) => { ghost.onopen = r; });
const gsend = (m) => ghost.send(JSON.stringify(m));
gsend({ kind: 'chat', text: 'Boo!' });
gsend({ kind: 'typing', on: true });
gsend({ kind: 'reaction', emoji: '👻' });
gsend({ kind: 'like', target: session.session.userId });
gsend({ kind: 'cursor', x: 0.3, y: 0.6, visible: true });
gsend({ kind: 'action', action: 'theme', vars: { theme: 'dark' } });
gsend({ kind: 'stroke', stroke: { id: 'g1', color: '#0f0', width: 3, erase: false, points: [[0.1, 0.1], [0.5, 0.5]], done: true } });
await sleep(700);
check('второй участник в витрине', document.querySelectorAll('#usersShowcase .user-model-card').length === 2);
check('3D мини-модель участника', $('#usersShowcase .mini-model') !== null);
check('сообщение от участника', Array.from(document.querySelectorAll('#chatMessages .chat-text')).some((n) => n.textContent === 'Boo!'));
check('индикатор набора текста', $('#typingIndicator').textContent.includes('Ghost'));
check('удалённый курсор', document.querySelectorAll('#cursorsLayer .remote-cursor').length === 1);
check('лайк получен', $('#usersShowcase .user-model-card.self .like-btn').textContent.includes('1'));
check('время участника (Токио)', $('#tzList').textContent.includes('Tokyo'));
click('.tab[data-tab="widgets"]');
check('список часовых поясов', document.querySelectorAll('#tzList .tz-row').length === 2);
click('#usersShowcase .user-model-card:not(.self) .like-btn');
await sleep(300);
click('#adminUsers .ghost.danger'); // kick Ghost
await sleep(500);
check('участник исключён', document.querySelectorAll('#usersShowcase .user-model-card').length === 1);
ghost.close();

// --- Горячие клавиши, палитра, случайная сцена, undo/redo -----------------------------
document.activeElement = document.body;
const themeBefore = store.state.theme;
key('t'); check('T → следующая тема', store.state.theme !== themeBefore);
const playingBefore = store.state.playing;
key(' '); check('Space → стоп/старт', store.state.playing === !playingBefore);
if (!store.state.playing) key(' ');
key('d'); check('D → 3D', store.state.use3d === true); key('d');
key('1'); check('1 → pulse', store.activeObject().animations.includes('pulse'));
key('n'); check('N → добавить объект', store.state.objects.length === 3);
key('ArrowRight'); key('ArrowDown', { shiftKey: true });
key('Delete'); check('Delete → удалить объект', store.state.objects.length === 2);
key('r'); check('R → случайная сцена', document.querySelectorAll('#activityFeed .feed-item').length >= 1);
key('z', { ctrlKey: true }); check('Ctrl+Z → undo', store.canRedo());
key('y', { ctrlKey: true }); check('Ctrl+Y → redo', !store.canRedo());
click('#undoBtn'); click('#redoBtn');
key('m'); key('m');
key('l'); check('L → язык переключён', document.documentElement.lang === 'en' && $('.tab[data-tab="object"]').textContent === 'Object');
key('l');
key('?'); check('? → оверлей горячих клавиш', !$('#helpOverlay').hidden);
key('Escape'); check('Esc закрывает оверлей', $('#helpOverlay').hidden);
key('k', { ctrlKey: true }); check('Ctrl+K → палитра', !$('#paletteModal').hidden);
input('#paletteInput', 'снег');
check('палитра фильтрует', document.querySelectorAll('#paletteList .palette-item').length >= 1 && $('#paletteList .palette-item .palette-title').textContent.includes('снег'));
$('#paletteInput').dispatchEvent(new MiniKeyboardEvent('keydown', { key: 'Enter' }));
check('команда палитры выполнена (снег)', store.state.effect === 'snow' && $('#paletteModal').hidden);
key('p'); check('P → презентация', document.body.classList.contains('presenting'));
key('Escape'); check('Esc → выход из презентации', !document.body.classList.contains('presenting'));
key('f'); // fullscreen — заглушка
click('#pipBtn'); // нет documentPictureInPicture — предупреждение
click('#fullscreenBtn');
click('#randomBtn');
// Konami
for (const k of ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a']) key(k);
check('Konami → матрица', store.state.effect === 'matrix');
for (let i = 0; i < 10; i += 1) click('#brandBtn');
check('10 кликов → дискотека', document.body.classList.contains('disco'));
click('#brandBtn');
check('дискотека выключена', !document.body.classList.contains('disco'));

// --- Квиз, достижения -------------------------------------------------------------------
click('.tab[data-tab="help"]');
click('#quizArea button');
check('квиз начался', document.querySelectorAll('#quizArea .quiz-option').length === 4);
for (let i = 0; i < 6; i += 1) {
  click('#quizArea .quiz-option');
  const next = $('#quizFeedback button');
  if (next) next.click();
}
check('квиз завершён', $('#quizArea .quiz-result') !== null);
click('.tab[data-tab="achievements"]');
check('есть открытые достижения', document.querySelectorAll('#achievementsGrid .ach.unlocked').length >= 8);
console.log('   открыто достижений:', document.querySelectorAll('#achievementsGrid .ach.unlocked').length);

// --- Виджеты ----------------------------------------------------------------------------
click('.tab[data-tab="widgets"]');
click('#quoteBtn'); click('#factBtn'); click('#ratesRefreshBtn'); click('#weatherLocateBtn');
input('#weatherCity', 'Paris'); $('#weatherForm').dispatchEvent(new MiniEvent('submit'));
await sleep(800);
check('цитата показана', $('#quoteText').textContent.length > 10);
check('курсы: сообщение офлайн', $('#ratesTable').textContent.length > 5);

// --- Локальное сохранение и выход -------------------------------------------------------
key('s', { ctrlKey: true });
check('сцена сохранена локально', window.localStorage.getItem('mp2:scene') !== null || Array.from(window.localStorage.map.keys()).some((k) => k.startsWith('mp2:')));
click('#leaveBtn');
await sleep(300);
check('выход из сессии', !document.body.classList.contains('session-active') && !$('#entryGate').hidden);

// --- Итог ------------------------------------------------------------------------------------
const domErrors = globalThis.__domErrors || [];
console.log(`\nПроверок пройдено: ${passed}`);
console.log(`Предупреждений (ожидаемы без браузерных API): ${warnings.length}`);
if (process.env.VERBOSE) warnings.forEach((w) => console.log('  warn:', w.slice(0, 160)));
const all = [...errors, ...domErrors];
if (all.length) {
  console.log(`\nОШИБКИ (${all.length}):`);
  all.forEach(({ where, err }) => console.log(` - ${where}:`, err instanceof Error ? `${err.message}\n${err.stack.split('\n').slice(1, 4).join('\n')}` : err));
  process.exit(1);
}
console.log('OK — ошибок нет');
process.exit(0);
