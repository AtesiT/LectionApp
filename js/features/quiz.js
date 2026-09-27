// Мини-квиз по анимациям и справка (вкладка «Справка»).
import { $, el, loadJSON, saveJSON, pick } from '../core/dom.js';
import { emit, on } from '../core/bus.js';
import { t, getLang } from '../core/i18n.js';

const QUESTIONS = {
  ru: [
    { q: 'Какое CSS-свойство позволяет анимировать без пересчёта макета (layout)?', a: ['transform', 'width', 'margin', 'top'], c: 0 },
    { q: 'Что делает composite: "add" в Web Animations API?', a: ['Складывает трансформации нескольких анимаций', 'Добавляет анимацию в очередь', 'Копирует ключевые кадры', 'Ускоряет анимацию'], c: 0 },
    { q: 'Какое свойство делает возможным плавный морфинг фигур в этом проекте?', a: ['clip-path: polygon()', 'border-radius', 'background-image', 'outline'], c: 0 },
    { q: 'Сколько кадров в секунду обычно рисует браузер при 60 Гц?', a: ['60', '24', '30', '120'], c: 0 },
    { q: 'Чем отличается transform-style: preserve-3d?', a: ['Дочерние элементы сохраняют 3D-позицию', 'Включает аппаратное ускорение', 'Отключает перспективу', 'Делает элемент плоским'], c: 0 },
    { q: 'Что такое easing (timing function)?', a: ['Кривая изменения скорости анимации', 'Длительность анимации', 'Число повторов', 'Задержка перед стартом'], c: 0 },
    { q: 'Какой метод браузера лучше всего подходит для покадровой анимации на JS?', a: ['requestAnimationFrame', 'setTimeout(0)', 'while(true)', 'setInterval(1)'], c: 0 },
    { q: 'Сумма очков на противоположных гранях игральной кости равна…', a: ['7', '6', '8', '9'], c: 0 },
    { q: 'Что делает filter: drop-shadow() в отличие от box-shadow?', a: ['Повторяет форму содержимого (учитывает clip-path)', 'Работает только с текстом', 'Рисует тень внутри', 'Ничем не отличается'], c: 0 },
    { q: 'Какой транспорт использует сессия при недоступности WebSocket?', a: ['Server-Sent Events', 'FTP', 'WebRTC', 'Bluetooth'], c: 0 },
    { q: 'Какое значение animation-direction заставляет анимацию идти туда-обратно?', a: ['alternate', 'reverse', 'normal', 'infinite'], c: 0 },
    { q: 'Что описывает keyframes offset (например 0.5)?', a: ['Долю времени, когда достигается кадр', 'Смещение по оси X', 'Скорость кадра', 'Задержку в секундах'], c: 0 },
  ],
  en: [
    { q: 'Which CSS property can be animated without triggering layout?', a: ['transform', 'width', 'margin', 'top'], c: 0 },
    { q: 'What does composite: "add" do in the Web Animations API?', a: ['Accumulates transforms of several animations', 'Queues the animation', 'Copies keyframes', 'Speeds the animation up'], c: 0 },
    { q: 'Which property makes smooth shape morphing possible in this project?', a: ['clip-path: polygon()', 'border-radius', 'background-image', 'outline'], c: 0 },
    { q: 'How many frames per second does a browser usually paint at 60 Hz?', a: ['60', '24', '30', '120'], c: 0 },
    { q: 'What does transform-style: preserve-3d do?', a: ['Children keep their 3D position', 'Enables hardware acceleration', 'Disables perspective', 'Flattens the element'], c: 0 },
    { q: 'What is an easing (timing function)?', a: ['A curve describing how speed changes', 'The animation duration', 'The number of iterations', 'The start delay'], c: 0 },
    { q: 'Which browser API is best for frame-by-frame JS animation?', a: ['requestAnimationFrame', 'setTimeout(0)', 'while(true)', 'setInterval(1)'], c: 0 },
    { q: 'Opposite faces of a die add up to…', a: ['7', '6', '8', '9'], c: 0 },
    { q: 'How does filter: drop-shadow() differ from box-shadow?', a: ['It follows the content shape (respects clip-path)', 'It works only with text', 'It draws an inner shadow', 'No difference'], c: 0 },
    { q: 'Which transport does the session use when WebSocket is unavailable?', a: ['Server-Sent Events', 'FTP', 'WebRTC', 'Bluetooth'], c: 0 },
    { q: 'Which animation-direction value makes an animation go back and forth?', a: ['alternate', 'reverse', 'normal', 'infinite'], c: 0 },
    { q: 'What does a keyframe offset (e.g. 0.5) describe?', a: ['The fraction of time when the frame is reached', 'Offset along the X axis', 'Frame speed', 'Delay in seconds'], c: 0 },
  ],
};

const TOTAL = 6;
let run = null; // { questions: [...], index, score, answered }

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function bestKey() {
  return 'mp2:quizBest';
}

function renderBest() {
  const node = $('#quizBest');
  if (!node) return;
  const best = loadJSON(bestKey(), null);
  node.textContent = best == null ? '' : t('quiz.best', { score: best, total: TOTAL });
}

export function start() {
  const lang = getLang();
  const pool = shuffle(QUESTIONS[lang]).slice(0, TOTAL).map((q) => {
    // перемешиваем варианты, запоминая правильный
    const options = q.a.map((text, i) => ({ text, correct: i === q.c }));
    return { q: q.q, options: shuffle(options) };
  });
  run = { questions: pool, index: 0, score: 0, answered: false };
  renderQuestion();
}

function renderQuestion() {
  const area = $('#quizArea');
  if (!area || !run) return;
  const item = run.questions[run.index];
  area.replaceChildren(
    el('div', { class: 'quiz-progress', text: t('quiz.q', { n: run.index + 1, total: run.questions.length }) }),
    el('div', { class: 'quiz-question', text: item.q }),
    el('div', { class: 'quiz-options' }, item.options.map((opt, i) => el('button', {
      class: 'quiz-option', type: 'button', dataset: { i: String(i) },
      onClick: () => answer(i),
    }, [el('span', { class: 'quiz-letter', text: 'ABCD'[i] }), el('span', { text: opt.text })]))),
    el('div', { class: 'quiz-feedback', id: 'quizFeedback' }),
  );
}

function answer(i) {
  if (!run || run.answered) return;
  run.answered = true;
  const item = run.questions[run.index];
  const correct = item.options[i].correct;
  if (correct) run.score += 1;
  const buttons = Array.from(document.querySelectorAll('.quiz-option'));
  buttons.forEach((b, idx) => {
    b.disabled = true;
    if (item.options[idx].correct) b.classList.add('correct');
    else if (idx === i) b.classList.add('wrong');
  });
  emit('sfx', correct ? 'success' : 'error');
  const fb = $('#quizFeedback');
  const right = item.options.find((o) => o.correct)?.text ?? '';
  const last = run.index === run.questions.length - 1;
  fb.replaceChildren(
    el('div', { class: correct ? 'ok' : 'bad', text: correct ? t('quiz.correct') : t('quiz.wrong', { answer: right }) }),
    el('button', { class: 'primary', type: 'button', text: last ? t('quiz.finish') : t('quiz.next'), onClick: next }),
  );
}

function next() {
  if (!run) return;
  run.index += 1;
  run.answered = false;
  if (run.index >= run.questions.length) finish();
  else renderQuestion();
}

function finish() {
  const area = $('#quizArea');
  const total = run.questions.length;
  const score = run.score;
  const best = loadJSON(bestKey(), null);
  if (best == null || score > best) saveJSON(bestKey(), score);
  renderBest();
  let verdict = t('quiz.ok');
  if (score === total) verdict = t('quiz.perfect');
  else if (score >= total - 1) verdict = t('quiz.good');
  if (score === total) { emit('quiz:perfect'); emit('effects:burst', { kind: 'confetti' }); }
  emit('feed', { action: 'quiz', vars: { score, total } });
  area.replaceChildren(
    el('div', { class: 'quiz-result', text: t('quiz.result', { score, total }) }),
    el('div', { class: 'hint', text: verdict }),
    el('button', { class: 'secondary', type: 'button', text: t('quiz.again'), onClick: start }),
  );
  run = null;
}

function renderIdle() {
  const area = $('#quizArea');
  if (!area) return;
  area.replaceChildren(el('button', { class: 'primary', type: 'button', text: t('quiz.start'), onClick: start }));
}

function renderHelp() {
  const node = $('#helpContent');
  if (!node) return;
  const sections = ['intro', 'anim', 'obj', '3d', 'scene', 'session'];
  node.replaceChildren(...sections.map((s) => el('details', { class: 'help-section', open: s === 'intro' ? 'open' : undefined }, [
    el('summary', { text: t(`help.${s}.title`) }),
    el('p', { text: t(`help.${s}.text`) }),
  ])));
  const icons = { intro: '🚀', anim: '🎞', obj: '🔷', '3d': '🧊', scene: '🌄', session: '👥' };
  node.querySelectorAll('summary').forEach((sum, i) => { sum.textContent = `${icons[sections[i]]} ${sum.textContent}`; });
}

export function init() {
  renderHelp();
  renderBest();
  renderIdle();
  on('lang', () => { renderHelp(); renderBest(); if (!run) renderIdle(); else renderQuestion(); });
}

export function open() {
  document.querySelector('.tab[data-tab="help"]')?.click();
  if (!run) start();
  $('#quizArea')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
