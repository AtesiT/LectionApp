// Достижения (бейджи): хранятся локально, о новых сообщаем в ленту и тостом.
import { $, el, loadJSON, saveJSON } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { t, getLang } from '../core/i18n.js';
import { subscribe, state } from '../core/store.js';
import { toast } from '../ui/toast.js';
import { ANIMATION_KEYS } from '../scene/animations.js';

const ACHIEVEMENTS = [
  { id: 'first_start', icon: '▶️', ru: ['Первый запуск', 'Запустить анимацию'], en: ['First run', 'Start an animation'] },
  { id: 'combo3', icon: '🎛', ru: ['Комбинатор', 'Включить 3 анимации одновременно'], en: ['Combinator', 'Run 3 animations at once'] },
  { id: 'combo6', icon: '🌀', ru: ['Хаос', 'Включить 6 анимаций одновременно'], en: ['Chaos', 'Run 6 animations at once'] },
  { id: 'all_anims', icon: '🏅', ru: ['Коллекционер', 'Попробовать все анимации'], en: ['Collector', 'Try every animation'] },
  { id: 'all_shapes', icon: '🔷', ru: ['Геометр', 'Попробовать все 2D-фигуры'], en: ['Geometer', 'Try all 2D shapes'] },
  { id: 'objects5', icon: '🧩', ru: ['Толпа', 'Держать 5 объектов на сцене'], en: ['Crowd', 'Keep 5 objects on stage'] },
  { id: 'objects12', icon: '🎪', ru: ['Аншлаг', 'Максимум объектов (12)'], en: ['Full house', 'Max objects (12)'] },
  { id: 'mode3d', icon: '🧊', ru: ['Третье измерение', 'Включить 3D'], en: ['Third dimension', 'Enable 3D'] },
  { id: 'all_3d', icon: '💎', ru: ['Скульптор', 'Посмотреть все 3D-фигуры'], en: ['Sculptor', 'See every 3D shape'] },
  { id: 'webgl', icon: '🖥', ru: ['WebGL', 'Включить режим WebGL'], en: ['WebGL', 'Enable WebGL mode'] },
  { id: 'gyro', icon: '📱', ru: ['Наклони меня', 'Управлять гироскопом'], en: ['Tilt me', 'Use the gyroscope'] },
  { id: 'dice6', icon: '🎲', ru: ['Шестёрка', 'Выбросить 6 на кости'], en: ['Six', 'Roll a six'] },
  { id: 'dice10', icon: '🎰', ru: ['Азарт', 'Бросить кость 10 раз'], en: ['Gambler', 'Roll the die 10 times'] },
  { id: 'rubik', icon: '🧮', ru: ['Кубик', 'Запутать кубик Рубика'], en: ['Cube', 'Scramble the Rubik\u2019s cube'] },
  { id: 'rubik20', icon: '🏆', ru: ['Спидкубер', 'Сделать 20 ходов кубика'], en: ['Speedcuber', 'Make 20 cube moves'] },
  { id: 'physics', icon: '🍎', ru: ['Ньютон', 'Включить физику'], en: ['Newton', 'Enable physics'] },
  { id: 'throw', icon: '🏀', ru: ['Бросок', 'Бросить объект с физикой'], en: ['Throw', 'Throw an object with physics'] },
  { id: 'collisions20', icon: '💥', ru: ['Бильярд', '20 столкновений объектов'], en: ['Billiards', '20 object collisions'] },
  { id: 'path', icon: '✍️', ru: ['Картограф', 'Нарисовать траекторию'], en: ['Cartographer', 'Draw a trajectory'] },
  { id: 'themes', icon: '🎨', ru: ['Хамелеон', 'Попробовать все темы'], en: ['Chameleon', 'Try every theme'] },
  { id: 'effects', icon: '❄️', ru: ['Метеоролог', 'Попробовать 5 эффектов сцены'], en: ['Meteorologist', 'Try 5 scene effects'] },
  { id: 'weather', icon: '🌦', ru: ['Синхронизация', 'Связать сцену с погодой'], en: ['In sync', 'Link the scene with the weather'] },
  { id: 'bg_upload', icon: '🖼', ru: ['Декоратор', 'Загрузить свой фон'], en: ['Decorator', 'Upload a custom background'] },
  { id: 'video_bg', icon: '🎬', ru: ['Киномеханик', 'Поставить видео фоном сцены'], en: ['Projectionist', 'Put a video on the stage background'] },
  { id: 'video_obj', icon: '📺', ru: ['Телеведущий', 'Добавить объект-видео или картинку'], en: ['TV host', 'Add a video or image object'] },
  { id: 'peek', icon: '👁', ru: ['Наблюдатель', 'Посмотреть сцену другого участника'], en: ['Observer', 'Peek at another participant\u2019s scene'] },
  { id: 'board_record', icon: '🎞', ru: ['Режиссёр', 'Записать рисование на доске'], en: ['Director', 'Record the board drawing'] },
  { id: 'board_shot', icon: '📷', ru: ['Фотограф', 'Сохранить скриншот сцены'], en: ['Photographer', 'Save a screenshot of the stage'] },
  { id: 'weather_backup', icon: '🛰', ru: ['Запасной канал', 'Получить погоду не с первого источника'], en: ['Backup channel', 'Get weather from a fallback source'] },
  { id: 'chat10', icon: '💬', ru: ['Болтун', 'Отправить 10 сообщений'], en: ['Chatterbox', 'Send 10 messages'] },
  { id: 'reactions', icon: '🎉', ru: ['Эмоции', 'Отправить 10 реакций'], en: ['Emotions', 'Send 10 reactions'] },
  { id: 'like_given', icon: '👍', ru: ['Щедрость', 'Поставить лайк'], en: ['Generosity', 'Give a like'] },
  { id: 'liked5', icon: '⭐', ru: ['Звезда', 'Получить 5 лайков'], en: ['Star', 'Receive 5 likes'] },
  { id: 'poll', icon: '📊', ru: ['Социолог', 'Создать опрос'], en: ['Pollster', 'Create a poll'] },
  { id: 'vote', icon: '🗳', ru: ['Избиратель', 'Проголосовать в опросе'], en: ['Voter', 'Vote in a poll'] },
  { id: 'board', icon: '🖌', ru: ['Художник', 'Нарисовать на общей доске'], en: ['Artist', 'Draw on the shared board'] },
  { id: 'host', icon: '👑', ru: ['Ведущий', 'Стать ведущим комнаты'], en: ['Host', 'Become the room host'] },
  { id: 'mic', icon: '🎤', ru: ['Диджей', 'Включить микрофон-визуализатор'], en: ['DJ', 'Turn on the mic visualizer'] },
  { id: 'voice', icon: '🗣', ru: ['Голос', 'Выполнить голосовую команду'], en: ['Voice', 'Run a voice command'] },
  { id: 'undo', icon: '↩️', ru: ['Машина времени', 'Использовать отмену'], en: ['Time machine', 'Use undo'] },
  { id: 'palette', icon: '⌘', ru: ['Командир', 'Открыть командную палитру'], en: ['Commander', 'Open the command palette'] },
  { id: 'hotkeys10', icon: '⌨️', ru: ['Клавишник', 'Использовать 10 горячих клавиш'], en: ['Keyboardist', 'Use 10 hotkeys'] },
  { id: 'fullscreen', icon: '🖥️', ru: ['На весь экран', 'Включить полноэкранный режим'], en: ['Big screen', 'Enter fullscreen'] },
  { id: 'pip', icon: '🪟', ru: ['Окно в окне', 'Открыть Picture-in-Picture'], en: ['Window in window', 'Open Picture-in-Picture'] },
  { id: 'lang', icon: '🌐', ru: ['Полиглот', 'Сменить язык интерфейса'], en: ['Polyglot', 'Switch the UI language'] },
  { id: 'konami', icon: '🕹', ru: ['Кодер', 'Ввести код Konami'], en: ['Coder', 'Enter the Konami code'] },
  { id: 'disco', icon: '🪩', ru: ['Тусовщик', 'Найти дискотеку'], en: ['Party animal', 'Find the disco'] },
  { id: 'quiz', icon: '🎓', ru: ['Отличник', 'Пройти квиз без ошибок'], en: ['Straight A', 'Ace the quiz'] },
  { id: 'pwa', icon: '📲', ru: ['Установлено', 'Установить приложение'], en: ['Installed', 'Install the app'] },
  { id: 'night_owl', icon: '🦉', ru: ['Сова', 'Заниматься после полуночи'], en: ['Night owl', 'Play after midnight'] },
  { id: 'random10', icon: '🎲', ru: ['Рандомайзер', 'Нажать «Случайно» 10 раз'], en: ['Randomizer', 'Press Random 10 times'] },
  { id: 'all', icon: '🌟', ru: ['Легенда', 'Получить все остальные достижения'], en: ['Legend', 'Unlock everything else'] },
];

const data = loadJSON('mp2:achievements', { unlocked: {}, counters: {}, seen: {} });
data.unlocked ??= {};
data.counters ??= {};
data.seen ??= {};

function save() {
  saveJSON('mp2:achievements', data);
}

export function unlock(id) {
  if (data.unlocked[id]) return false;
  const def = ACHIEVEMENTS.find((a) => a.id === id);
  if (!def) return false;
  data.unlocked[id] = Date.now();
  save();
  const name = `${def.icon} ${def[getLang()][0]}`;
  toast(t('ach.unlocked', { name }), { type: 'success', icon: '🏅', timeout: 5000 });
  emit('sfx', 'achievement');
  emit('feed', { action: 'achievement', vars: { name: def[getLang()][0] } });
  emit('achievement', id);
  render();
  // «Легенда»: всё остальное собрано
  if (id !== 'all' && ACHIEVEMENTS.every((a) => a.id === 'all' || data.unlocked[a.id])) unlock('all');
  return true;
}

function count(key, threshold, achievementId) {
  data.counters[key] = (data.counters[key] || 0) + 1;
  save();
  if (data.counters[key] >= threshold) unlock(achievementId);
}

function seen(setKey, value, total, achievementId) {
  const set = data.seen[setKey] || (data.seen[setKey] = []);
  if (!set.includes(value)) { set.push(value); save(); }
  if (set.length >= total) unlock(achievementId);
}

export function isUnlocked(id) {
  return Boolean(data.unlocked[id]);
}

export function progress() {
  return { done: Object.keys(data.unlocked).length, total: ACHIEVEMENTS.length };
}

export function render() {
  const grid = $('#achievementsGrid');
  const prog = $('#achievementsProgress');
  const lang = getLang();
  const { done, total } = progress();
  if (prog) {
    prog.replaceChildren(
      el('span', { text: `${done} / ${total}` }),
      el('div', { class: 'ach-bar' }, [el('span', { style: { width: `${Math.round((done / total) * 100)}%` } })]),
    );
  }
  if (!grid) return;
  grid.replaceChildren(...ACHIEVEMENTS.map((a) => {
    const ok = Boolean(data.unlocked[a.id]);
    const date = ok ? new Date(data.unlocked[a.id]).toLocaleDateString(lang === 'ru' ? 'ru-RU' : 'en-US') : '';
    return el('div', { class: `ach ${ok ? 'unlocked' : 'locked'}`, title: ok ? date : t('ach.locked') }, [
      el('span', { class: 'ach-icon', text: a.icon }),
      el('div', { class: 'ach-text' }, [
        el('div', { class: 'ach-name', text: a[lang][0] }),
        el('div', { class: 'ach-desc', text: a[lang][1] }),
        ok ? el('div', { class: 'ach-date', text: date }) : null,
      ]),
    ]);
  }));
}

export function init() {
  render();
  on('lang', render);

  subscribe((s, patch, meta) => {
    if (meta.source === 'remote' || meta.source === 'init') return;
    if (s.playing && (patch.playing || meta.replace)) unlock('first_start');
    if (s.use3d) unlock('mode3d');
    if (s.webgl) unlock('webgl');
    if (s.physics) unlock('physics');
    if (s.weatherSync) unlock('weather');
    if (s.use3d && s.shape3d) seen('shapes3d', s.shape3d, 9, 'all_3d');
    if (s.theme) seen('themes', s.theme, 8, 'themes');
    if (s.effect && s.effect !== 'none') seen('effects', s.effect, 5, 'effects');
    if (s.background?.type === 'image' || s.background?.type === 'video') unlock('bg_upload');
    if (s.background?.type === 'video') unlock('video_bg');
    if (s.objects.some((o) => o.shape === 'video' || (o.shape === 'image' && o.image))) unlock('video_obj');
    if (s.objects.length >= 5) unlock('objects5');
    if (s.objects.length >= 12) unlock('objects12');
    const active = s.objects.find((o) => o.id === s.activeObjectId) || s.objects[0];
    if (active) {
      if (active.animations.length >= 3) unlock('combo3');
      if (active.animations.length >= 6) unlock('combo6');
      active.animations.forEach((k) => seen('anims', k, ANIMATION_KEYS.length, 'all_anims'));
      seen('shapes', active.shape, 10, 'all_shapes');
      if (active.trajectory === 'custom' && active.customPath?.length > 3) unlock('path');
    }
    if (meta.source === 'undo') unlock('undo');
    if (meta.action === 'random') count('random', 10, 'random10');
    if (meta.action === 'zoom' || meta.action === 'rotate') { /* без достижения */ }
    if (new Date().getHours() < 5) unlock('night_owl');
  });

  on('gyro:on', () => unlock('gyro'));
  on('dice:rolled', (n) => { count('dice', 10, 'dice10'); if (n === 6) unlock('dice6'); });
  on('rubik:scramble', () => unlock('rubik'));
  on('rubik:move', () => count('rubik', 20, 'rubik20'));
  on('physics:throw', () => unlock('throw'));
  on('physics:collision', () => count('collisions', 20, 'collisions20'));
  on('path:recorded', () => unlock('path'));
  on('chat:sent', () => count('chat', 10, 'chat10'));
  on('reaction:sent', () => count('reactions', 10, 'reactions'));
  on('like:given', () => unlock('like_given'));
  on('like:received', () => count('liked', 5, 'liked5'));
  on('poll:created', () => unlock('poll'));
  on('poll:voted', () => unlock('vote'));
  on('board:stroke', () => unlock('board'));
  on('board:recorded', () => unlock('board_record'));
  on('board:screenshot', () => unlock('board_shot'));
  on('peek:opened', () => unlock('peek'));
  on('weather:fallback', () => unlock('weather_backup'));
  on('mic:on', () => unlock('mic'));
  on('voice:command', () => unlock('voice'));
  on('palette:open', () => unlock('palette'));
  on('hotkey', () => count('hotkeys', 10, 'hotkeys10'));
  on('view:fullscreen', () => unlock('fullscreen'));
  on('view:pip', () => unlock('pip'));
  on('lang', () => { if (data.counters.langInit) unlock('lang'); data.counters.langInit = 1; });
  on('konami', () => unlock('konami'));
  on('disco', () => unlock('disco'));
  on('quiz:perfect', () => unlock('quiz'));
  on('pwa:installed', () => unlock('pwa'));
  on('session:users', () => { /* роль ведущего проверяем через host-событие */ });
  on('session:host', () => unlock('host'));
  on('history', () => { /* только для перерисовки кнопок */ });
  data.counters.langInit = 1;
  if (state.use3d) { /* стартовое состояние не считаем */ }
}
