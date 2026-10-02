// Сквозной тест сервера room_server.py (комнаты, WebSocket, роли, чат, опросы, доска, админ-операции, SSE).
// Запуск: сервер должен работать на :8080 (или задайте BASE=http://host:port), затем
//   node tests/server_e2e.mjs
// Не требует зависимостей: используется встроенные fetch и WebSocket Node 22+.

const base = process.env.BASE || 'http://localhost:8080';
const wsBase = base.replace(/^http/, 'ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const post = async (path, body) => (await fetch(base + path, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
})).json();

let passed = 0;
const failures = [];
function check(name, cond, extra = '') {
  if (cond) { passed += 1; console.log(`✓ ${name}`); } else { failures.push(name); console.log(`✗ ${name} ${extra}`); }
}

function connect(user, room) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`${wsBase}/ws?room=${room}&userId=${user.userId}`);
    const got = [];
    ws.onopen = () => resolve({ ws, got });
    ws.onerror = (e) => reject(e);
    ws.onmessage = (ev) => { got.push(JSON.parse(ev.data)); };
  });
}
const send = (c, msg) => c.ws.send(JSON.stringify(msg));
const replies = (c) => c.got.filter((m) => m.type === 'reply');
const replyFor = (c, reqId) => replies(c).find((m) => m.reqId === reqId);

// --- вход в комнату -----------------------------------------------------------
const a = await post('/api/join', { name: 'Alice', avatar: '😎', tz: 'Europe/Moscow', createRoom: true, state: { theme: 'neon' }, lang: 'ru' });
check('создание комнаты', a.ok && typeof a.room === 'string' && a.room.length === 4, JSON.stringify(a).slice(0, 100));
check('первый участник — ведущий', a.role === 'host');
const room = a.room;
const b = await post('/api/join', { name: 'Bob', avatar: '🤖', tz: 'America/Los_Angeles', room, state: { theme: 'dark' }, lang: 'en' });
check('второй участник вошёл в ту же комнату', b.ok && b.room === room && b.users.length === 2);
check('второй участник — обычный', b.role === 'member');
const bad = await post('/api/join', { name: '', room });
check('вход без имени отклонён', bad.ok === false && bad.error === 'name_required');

const A = await connect(a, room);
const B = await connect(b, room);
await sleep(300);
check('снимок комнаты по WebSocket', A.got.some((m) => m.type === 'snapshot' && m.room === room));

// --- чат, реакции, лайки, состояние --------------------------------------------
send(A, { kind: 'chat', text: 'Привет, Bob!', reqId: 'r1' });
send(B, { kind: 'typing', on: true });
send(B, { kind: 'reaction', emoji: '🔥' });
send(B, { kind: 'like', target: a.userId, reqId: 'r2' });
send(B, { kind: 'cursor', x: 0.5, y: 0.25, visible: true });
send(A, { kind: 'action', type: 'theme', textKey: 'feed.theme', vars: { theme: 'ocean' }, text: 'сменил тему на ocean', state: { theme: 'ocean' }, reqId: 'r3' });
send(A, { kind: 'state', state: { theme: 'ocean', objects: [{ shape: 'star', color: '#fff' }] } });
send(A, { kind: 'poll_create', question: 'Лучшая анимация?', options: ['pulse', 'rotate', 'bounce'], reqId: 'r4' });
await sleep(400);
check('чат доставлен второму участнику', B.got.some((m) => m.type === 'chat' && m.message?.text === 'Привет, Bob!'));
check('ответ на чат с reqId', replyFor(A, 'r1')?.ok === true);
check('индикатор набора текста', A.got.some((m) => m.type === 'typing' && m.userId === b.userId));
check('реакция доставлена', A.got.some((m) => m.type === 'reaction' && m.emoji === '🔥'));
check('лайк попал в ленту', A.got.some((m) => m.type === 'action' && m.entry?.textKey === 'feed.like'));
check('курсор транслируется', A.got.some((m) => m.type === 'cursor' && m.userId === b.userId));
check('действие попало в ленту', B.got.some((m) => m.type === 'action' && m.entry?.textKey === 'feed.theme'));
check('состояние сцены разослано (витрина участников)', B.got.some((m) => m.type === 'users' && m.users?.some((u) => u.id === a.userId && u.state?.theme === 'ocean')));
const pollMsg = B.got.find((m) => m.type === 'poll');
check('опрос создан и разослан', !!pollMsg && pollMsg.poll.question === 'Лучшая анимация?' && pollMsg.poll.options.length === 3);
if (pollMsg) send(B, { kind: 'poll_vote', pollId: pollMsg.poll.id, option: 1, reqId: 'r5' });

// --- доска, объявление, заморозка, права ---------------------------------------
send(A, { kind: 'stroke', stroke: { id: 's1', color: '#fff', width: 4, erase: false, points: [[0.1, 0.1], [0.2, 0.2]], done: true } });
send(A, { kind: 'admin', op: 'announce', text: 'Всем привет!', reqId: 'r6' });
send(A, { kind: 'admin', op: 'freeze', reqId: 'r7' });
await sleep(300);
check('голос в опросе принят', replyFor(B, 'r5')?.ok === true);
check('штрих доски доставлен', B.got.some((m) => m.type === 'stroke' && m.stroke?.id === 's1'));
check('объявление доставлено', B.got.some((m) => m.type === 'announce' && m.text === 'Всем привет!'));
check('заморозка разослана', B.got.some((m) => m.type === 'frozen' && m.frozen === true));
send(B, { kind: 'action', type: 'theme', textKey: 'feed.theme', vars: { theme: 'dark' }, reqId: 'r8' });
send(B, { kind: 'admin', op: 'freeze', reqId: 'r9' });
await sleep(300);
check('действие участника при заморозке отклонено', replyFor(B, 'r8')?.error === 'frozen');
check('админ-операция не ведущего отклонена', replyFor(B, 'r9')?.error === 'host_only');
send(A, { kind: 'admin', op: 'unfreeze', reqId: 'r10' });
send(A, { kind: 'admin', op: 'push_scene', state: { theme: 'ocean' }, reqId: 'r11' });
await sleep(300);
check('сцена ведущего применена всем', B.got.some((m) => m.type === 'apply_state' && m.state?.theme === 'ocean'));
send(A, { kind: 'admin', op: 'kick', target: b.userId, reqId: 'r12' });
await sleep(400);
check('исключение участника', B.got.some((m) => m.type === 'kicked'));
check('у ведущего нет ошибок', replies(A).every((m) => m.ok), JSON.stringify(replies(A).filter((m) => !m.ok)));

// --- HTTP-снимок и SSE-запасной канал -------------------------------------------
const info = await (await fetch(`${base}/api/room?room=${room}`)).json();
check('снимок комнаты по HTTP', info.users?.length === 1 && info.polls?.length === 1 && info.strokes?.length === 1 && info.chat?.length === 1,
  JSON.stringify({ users: info.users?.length, polls: info.polls?.length, strokes: info.strokes?.length, chat: info.chat?.length }));
const ctrl = new AbortController();
const sse = await fetch(`${base}/api/events?room=${room}&userId=${a.userId}`, { signal: ctrl.signal });
check('SSE отвечает потоком событий', sse.status === 200 && (sse.headers.get('content-type') || '').includes('text/event-stream'));
const { value } = await sse.body.getReader().read();
check('первое SSE-событие — снимок', new TextDecoder().decode(value).includes('"snapshot"'));
ctrl.abort();

// --- мини-игры: шахматы и крестики-нолики ---------------------------------------
// Боба исключили выше — пусть зайдёт снова, игры рассчитаны на двоих.
const b2 = await post('/api/join', { name: 'Bob2', avatar: '🤖', room, state: { theme: 'dark' } });
const B2 = await connect(b2, room);
await sleep(300);

send(A, { kind: 'game_create', game: 'chess', reqId: 'g1' });
await sleep(300);
const created = replyFor(A, 'g1');
check('шахматная партия создана', created?.ok === true && typeof created.gameId === 'string', JSON.stringify(created));
const gameId = created?.gameId;
check('игра разослана всем участникам', B2.got.some((m) => m.type === 'games' && m.games?.some((g) => g.id === gameId)));
send(B2, { kind: 'game_join', gameId, reqId: 'g2' });
await sleep(300);
check('второй игрок присоединился', replyFor(B2, 'g2')?.ok === true, JSON.stringify(replyFor(B2, 'g2')));
let gamesMsg = [...B2.got].reverse().find((m) => m.type === 'games' && m.games?.length);
let chess = gamesMsg?.games.find((g) => g.id === gameId);
check('в партии два игрока и счётчик хода', chess?.players?.length === 2 && chess?.waiting === false);
check('доска 64 клетки', chess?.state?.board?.length === 64);
check('клиент получает легальные ходы', (chess?.state?.legal?.e2 || []).length === 2 && (chess?.state?.legal?.g1 || []).length === 2,
  JSON.stringify(chess?.state?.legal?.e2));
send(B2, { kind: 'game_join', gameId, reqId: 'g2b' });
send(A, { kind: 'game_create', game: 'chess2', reqId: 'g2c' });
await sleep(200);
check('неизвестная игра отклонена', replyFor(A, 'g2c')?.error === 'bad_game');
send(B2, { kind: 'game_move', gameId, move: 'e2e4', reqId: 'g3' });
await sleep(250);
check('ход не в свою очередь отклонён', replyFor(B2, 'g3')?.error === 'not_your_turn', JSON.stringify(replyFor(B2, 'g3')));
send(A, { kind: 'game_move', gameId, move: 'e2e5', reqId: 'g4' });
await sleep(250);
check('нелегальный ход отклонён', replyFor(A, 'g4')?.error === 'illegal', JSON.stringify(replyFor(A, 'g4')));
send(A, { kind: 'game_move', gameId, move: 'e2e4', reqId: 'g5' });
await sleep(300);
check('ход белых принят', replyFor(A, 'g5')?.ok === true, JSON.stringify(replyFor(A, 'g5')));
gamesMsg = [...A.got].reverse().find((m) => m.type === 'games' && m.games?.length);
chess = gamesMsg?.games.find((g) => g.id === gameId);
check('пешка перешла с e2 на e4', chess?.state?.board[52] === null && chess?.state?.board[36] === 'wP',
  JSON.stringify([chess?.state?.board[52], chess?.state?.board[36]]));
check('ход перешёл чёрным', chess?.state?.turn === 'b');

send(A, { kind: 'game_create', game: 'tictactoe', reqId: 'g6' });
await sleep(300);
const tttId = replyFor(A, 'g6')?.gameId;
send(B2, { kind: 'game_join', gameId: tttId, reqId: 'g7' });
await sleep(300);
for (const [who, cell, req] of [[A, 0, 'g8'], [B2, 4, 'g9'], [A, 1, 'g10'], [B2, 5, 'g11'], [A, 2, 'g12']]) {
  send(who, { kind: 'game_move', gameId: tttId, move: cell, reqId: req });
  await sleep(200);
}
gamesMsg = [...A.got].reverse().find((m) => m.type === 'games' && m.games?.length);
let ttt = gamesMsg?.games.find((g) => g.id === tttId);
check('крестики-нолики: победа по верхней линии', ttt?.state?.winner === 'x' && JSON.stringify(ttt?.state?.line) === '[0,1,2]',
  JSON.stringify(ttt?.state));
check('победа попала в ленту', [...A.got, ...B2.got].some((m) => m.entry?.textKey === 'feed.gameWin'));
send(A, { kind: 'game_move', gameId: tttId, move: 8, reqId: 'g13' });
await sleep(200);
check('ход в завершённой партии отклонён', replyFor(A, 'g13')?.error === 'finished', JSON.stringify(replyFor(A, 'g13')));
send(A, { kind: 'game_reset', gameId: tttId, reqId: 'g14' });
await sleep(300);
gamesMsg = [...A.got].reverse().find((m) => m.type === 'games' && m.games?.length);
ttt = gamesMsg?.games.find((g) => g.id === tttId);
check('партия начата заново', ttt?.state?.board.every((c) => c === null) && ttt?.state?.winner === null);
send(B2, { kind: 'game_reset', gameId: 'нет-такой', reqId: 'g15' });
await sleep(200);
check('сброс несуществующей игры отклонён', replyFor(B2, 'g15')?.error === 'bad_game');
send(B2, { kind: 'game_leave', gameId: tttId, reqId: 'g16' });
await sleep(300);
check('выход из партии принят', replyFor(B2, 'g16')?.ok === true);

// --- общая сцена -------------------------------------------------------------------
send(B2, { kind: 'shared_enable', state: { theme: 'forest' }, reqId: 's1' });
await sleep(250);
check('включить общую сцену может только ведущий', replyFor(B2, 's1')?.error === 'host_only', JSON.stringify(replyFor(B2, 's1')));
send(A, { kind: 'shared_enable', state: { theme: 'forest' }, reqId: 's2' });
await sleep(300);
check('общая сцена включена', replyFor(A, 's2')?.ok === true);
check('режим общей сцены разослан', B2.got.some((m) => m.type === 'shared' && m.enabled === true && m.state?.theme === 'forest'));
const snapShared = await (await fetch(`${base}/api/room?room=${room}`)).json();
check('общая сцена видна в снимке комнаты', snapShared.shared?.enabled === true && snapShared.shared?.state?.theme === 'forest',
  JSON.stringify(snapShared.shared));
send(B2, { kind: 'shared_update', state: { theme: 'ocean' }, reqId: 's3' });
await sleep(300);
check('правка общей сцены разослана', A.got.some((m) => m.type === 'shared' && m.state?.theme === 'ocean'));
send(A, { kind: 'shared_disable', reqId: 's4' });
await sleep(300);
check('общая сцена выключена', B2.got.some((m) => m.type === 'shared' && m.enabled === false));

// --- сигналинг звонка (WebRTC) ------------------------------------------------------
send(A, { kind: 'rtc', payload: { type: 'offer', sdp: 'test' }, target: b2.userId, reqId: 'c1' });
await sleep(300);
check('сигналинг доставлен адресату', B2.got.some((m) => m.type === 'rtc' && m.from === a.userId && m.payload?.type === 'offer'));
check('сигналинг не возвращается отправителю', !A.got.some((m) => m.type === 'rtc'));
send(A, { kind: 'rtc', payload: 'not-a-dict', reqId: 'c2' });
await sleep(250);
check('сигналинг без полезной нагрузки отклонён', replyFor(A, 'c2')?.error === 'bad_payload');

// --- журнал занятия ---------------------------------------------------------------------
const jour = await (await fetch(`${base}/api/journal?room=${room}&limit=100`)).json();
check('журнал занятия отдаётся по API', jour.ok === true && Array.isArray(jour.entries) && jour.entries.length > 3,
  JSON.stringify(jour).slice(0, 120));
check('в журнале есть входы участников', jour.entries?.some((e) => e.type === 'join'));
check('в журнале есть игры', jour.entries?.some((e) => e.type === 'game'));
check('в журнале есть объявление', jour.entries?.some((e) => e.type === 'announce'));
const jourEmpty = await (await fetch(`${base}/api/journal?room=ZZZZ`)).json();
check('журнал несуществующей комнаты пуст', jourEmpty.ok === true && jourEmpty.entries.length === 0);

// --- загрузка медиа на сервер -----------------------------------------------------------
const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
const up = await fetch(base + '/api/upload', {
  method: 'POST', headers: { 'content-type': 'image/png', 'x-file-name': 'test.png' }, body: png,
});
const upJson = await up.json();
check('картинка загружена на сервер', upJson.ok === true && String(upJson.url || '').startsWith('/uploads/'),
  JSON.stringify(upJson).slice(0, 160));
if (upJson.ok) {
  const got = await fetch(base + upJson.url);
  check('загруженный файл отдаётся обратно', got.status === 200 && (got.headers.get('content-type') || '').includes('image/png'));
}
const upBad = await fetch(base + '/api/upload', {
  method: 'POST', headers: { 'content-type': 'text/x-python', 'x-file-name': 'bad.py' }, body: new Uint8Array([1, 2, 3]),
});
check('опасный тип файла отклонён', (await upBad.json()).error === 'bad_type');

// --- постоянство: комнаты переживают перезапуск сервера -----------------------------------
// Сервер сбрасывает комнаты в data/rooms.json каждые 15 с — дождёмся файла.
const fs = await import('node:fs');
const path = await import('node:path');
const persistFile = path.join(process.cwd(), 'data', 'rooms.json');
let saved = null;
for (let i = 0; i < 14; i += 1) {
  await sleep(2000);
  try {
    const raw = JSON.parse(fs.readFileSync(persistFile, 'utf8'));
    const mine = (raw.rooms || []).find((r) => r.code === room);
    // ждём свежего снимка: в нём уже должен быть журнал и общая сцена
    if (mine && (mine.journal || []).length > 0 && mine.shared?.state?.theme === 'ocean') { saved = raw; break; }
    if (mine) saved = raw;
  } catch { /* файл ещё не записан */ }
}
check('комната сохранена на диск', Boolean(saved), persistFile);
if (saved) {
  const mine = saved.rooms.find((r) => r.code === room);
  check('в сохранённой комнате есть чат и лента', Array.isArray(mine.chat) && Array.isArray(mine.feed));
  check('в сохранённой комнате есть журнал', Array.isArray(mine.journal) && mine.journal.length > 0);
  check('в сохранённой комнате есть общая сцена', mine.shared && mine.shared.state?.theme === 'ocean');
}


// --- внешние API через прокси (с офлайн-запасом) ---------------------------------
const quote = await (await fetch(`${base}/api/ext/quote?lang=ru`)).json();
check('цитата дня (сеть или офлайн-набор)', quote.ok === true && typeof quote.text === 'string' && quote.text.length > 0);
const fact = await (await fetch(`${base}/api/ext/fact?lang=en`)).json();
check('факт дня (сеть или офлайн-набор)', fact.ok === true && typeof fact.text === 'string');
const rates = await (await fetch(`${base}/api/ext/rates`)).json();
check('курсы валют: корректный ответ', typeof rates.ok === 'boolean' && typeof rates.fiat === 'object' && typeof rates.crypto === 'object');
// Погода: три источника по очереди (Open-Meteo → met.no → wttr.in).
const wGeo = await (await fetch(`${base}/api/ext/weather?q=Moscow&lang=ru`)).json();
check('погода: ответ по названию города', typeof wGeo.ok === 'boolean',
  JSON.stringify(wGeo).slice(0, 160));
if (wGeo.ok) {
  check('погода: полные данные', typeof wGeo.temp === 'number' && typeof wGeo.code === 'number'
    && Array.isArray(wGeo.daily) && wGeo.source !== undefined, JSON.stringify(wGeo).slice(0, 160));
} else {
  check('погода офлайн по городу: wttr.in опробован',
    !!wGeo.tried && wGeo.tried.join().includes('wttr.in'), JSON.stringify(wGeo).slice(0, 160));
}
const wCoords = await (await fetch(`${base}/api/ext/weather?lat=55.75&lon=37.61&place=Moscow&lang=ru`)).json();
if (wCoords.ok) {
  check('погода по координатам: полные данные', typeof wCoords.temp === 'number' && typeof wCoords.code === 'number',
    JSON.stringify(wCoords).slice(0, 160));
} else {
  check('погода офлайн по координатам: перебраны все три источника',
    !!wCoords.tried && ['open-meteo', 'met.no', 'wttr.in'].every((n) => wCoords.tried.join().includes(n)),
    JSON.stringify(wCoords).slice(0, 160));
}
const wBad = await (await fetch(`${base}/api/ext/weather`)).json();
check('погода без координат и города — ошибка запроса', wBad.ok === false && wBad.error === 'bad_request');
const health = await (await fetch(`${base}/api/health`)).json();
check('health', health.ok === true && typeof health.rooms === 'number');
for (const p of ['/room_server.py', '/README_RU.txt', '/.git/HEAD', '/run_local_server.sh']) {
  const r = await fetch(base + p);
  check(`скрыт файл ${p}`, r.status === 404, `status ${r.status}`);
}

A.ws.close(); B.ws.close(); B2.ws.close();
console.log(`\nПроверок пройдено: ${passed}`);
if (failures.length) { console.log(`ОШИБКИ (${failures.length}):\n - ${failures.join('\n - ')}`); process.exit(1); }
console.log('OK — ошибок нет');
process.exit(0);
