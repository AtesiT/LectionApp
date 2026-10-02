// Виджеты: часы, фаза Луны, цитата/факт дня, курсы валют и крипто, локальное время участников.
import { $, el, formatTime } from '../core/dom.js';
import { on } from '../core/bus.js';
import { t, getLang } from '../core/i18n.js';
import { session } from '../net/session.js';

// ---------------------------------------------------------------------------
// Часы в шапке
// ---------------------------------------------------------------------------

function tickClock() {
  const chip = $('#clockChip');
  if (chip) chip.textContent = `🕒 ${formatTime(Date.now(), true)}`;
}

// ---------------------------------------------------------------------------
// Фаза Луны — считаем локально по синодическому месяцу (без сети).
// Опорное новолуние: 6 января 2000, 18:14 UTC.
// ---------------------------------------------------------------------------

const SYNODIC = 29.530588853;
const REF_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14, 0);

export function moonInfo(date = new Date()) {
  const days = (date.getTime() - REF_NEW_MOON) / 86400000;
  const age = ((days % SYNODIC) + SYNODIC) % SYNODIC;
  const phase = age / SYNODIC; // 0..1
  const illumination = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
  const index = Math.round(phase * 8) % 8; // 0 новолуние, 4 полнолуние
  const icons = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];
  const toFull = ((0.5 - phase + 1) % 1) * SYNODIC;
  return {
    age, phase, illumination, index, icon: icons[index],
    nextFull: new Date(date.getTime() + toFull * 86400000),
  };
}

function renderMoon() {
  const body = $('#moonBody');
  if (!body) return;
  const m = moonInfo();
  const locale = getLang() === 'ru' ? 'ru-RU' : 'en-US';
  body.replaceChildren(
    el('div', { class: 'moon-main' }, [
      el('span', { class: 'moon-icon', text: m.icon }),
      el('div', {}, [
        el('div', { class: 'moon-phase', text: t(`moon.${m.index}`) }),
        el('div', { class: 'hint', text: `${t('moon.illum')}: ${Math.round(m.illumination * 100)}% · ${t('moon.age')}: ${m.age.toFixed(1)} ${t('moon.days')}` }),
        el('div', { class: 'hint', text: `${t('moon.next')}: ${m.nextFull.toLocaleDateString(locale, { day: 'numeric', month: 'long' })}` }),
      ]),
    ]),
    el('div', { class: 'moon-bar' }, [el('span', { style: { width: `${Math.round(m.illumination * 100)}%` } })]),
  );
}

// ---------------------------------------------------------------------------
// Цитата / факт дня. Идёт через серверный прокси /api/ext/quote|fact,
// а при недоступности — локальный набор.
// ---------------------------------------------------------------------------

const OFFLINE_QUOTES = {
  ru: [
    ['Анимация — это не искусство рисунков, которые движутся, а искусство движений, которые нарисованы.', 'Норман Макларен'],
    ['Простота — высшая форма изысканности.', 'Леонардо да Винчи'],
    ['Лучший способ предсказать будущее — создать его.', 'Алан Кей'],
    ['Программы должны писаться для людей, и лишь попутно — для машин.', 'Харольд Абельсон'],
    ['Сначала реши задачу. Затем напиши код.', 'Джон Джонсон'],
    ['Любая достаточно развитая технология неотличима от магии.', 'Артур Кларк'],
  ],
  en: [
    ['Animation is not the art of drawings that move but the art of movements that are drawn.', 'Norman McLaren'],
    ['Simplicity is the ultimate sophistication.', 'Leonardo da Vinci'],
    ['The best way to predict the future is to invent it.', 'Alan Kay'],
    ['Programs must be written for people to read, and only incidentally for machines to execute.', 'Harold Abelson'],
    ['First, solve the problem. Then, write the code.', 'John Johnson'],
    ['Any sufficiently advanced technology is indistinguishable from magic.', 'Arthur C. Clarke'],
  ],
};
const OFFLINE_FACTS = {
  ru: [
    'Первый мультфильм с синхронным звуком — «Пароходик Вилли» (1928).',
    'Глаз человека воспринимает движение плавным примерно от 12 кадров в секунду; экраны обновляются 60 раз и чаще.',
    'CSS-свойство transform не вызывает перерасчёт макета, поэтому такие анимации самые быстрые.',
    'Web Animations API появился в браузерах в 2016 году и объединил CSS-анимации и JavaScript.',
    'Кубик Рубика имеет 43 252 003 274 489 856 000 возможных состояний.',
    'Противоположные грани игральной кости в сумме всегда дают 7.',
    'WebSocket описан в RFC 6455 в 2011 году.',
  ],
  en: [
    'The first cartoon with synchronized sound was “Steamboat Willie” (1928).',
    'Human eyes perceive motion as smooth from about 12 frames per second; screens refresh 60 times or more.',
    'The CSS transform property does not trigger layout, which makes such animations the fastest.',
    'The Web Animations API arrived in browsers in 2016, unifying CSS animations and JavaScript.',
    'A Rubik\u2019s cube has 43,252,003,274,489,856,000 possible states.',
    'Opposite faces of a die always add up to 7.',
    'WebSocket is specified in RFC 6455 (2011).',
  ],
};

async function loadQuote(kind = 'quote') {
  const textNode = $('#quoteText');
  const authorNode = $('#quoteAuthor');
  if (!textNode) return;
  textNode.textContent = '…';
  authorNode.textContent = '';
  const lang = getLang();
  try {
    const res = await fetch(`/api/ext/${kind}?lang=${lang}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data?.text) throw new Error('empty');
    textNode.textContent = data.text;
    const author = data.author && data.author !== '—' ? `— ${data.author}` : '';
    authorNode.textContent = [author, data.source === 'offline' ? t('quote.offline') : ''].filter(Boolean).join(' ');
  } catch (err) {
    console.warn('quote failed', err);
    const pool = kind === 'fact' ? OFFLINE_FACTS[lang] : OFFLINE_QUOTES[lang];
    const pickIdx = Math.floor(Math.random() * pool.length);
    const item = pool[pickIdx];
    textNode.textContent = Array.isArray(item) ? item[0] : item;
    authorNode.textContent = `${Array.isArray(item) ? `— ${item[1]} ` : ''}${t('quote.offline')}`;
  }
}

// ---------------------------------------------------------------------------
// Курсы валют (ЦБ РФ) и крипто (CoinGecko) — через серверный прокси /api/ext/rates.
// ---------------------------------------------------------------------------

let ratesData = null;
const NAMES = {
  USD: { ru: 'Доллар США', en: 'US dollar' }, EUR: { ru: 'Евро', en: 'Euro' }, CNY: { ru: 'Юань', en: 'Yuan' },
  GBP: { ru: 'Фунт стерлингов', en: 'Pound sterling' }, JPY: { ru: 'Иена', en: 'Yen' }, KZT: { ru: 'Тенге', en: 'Tenge' },
  BTC: { ru: 'Биткоин', en: 'Bitcoin' }, ETH: { ru: 'Эфириум', en: 'Ethereum' }, TON: { ru: 'Toncoin', en: 'Toncoin' },
};

async function loadRates() {
  const table = $('#ratesTable');
  if (!table) return;
  try {
    const res = await fetch('/api/ext/rates', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    ratesData = await res.json();
    if (!ratesData.ok) throw new Error(ratesData.error || 'offline');
    renderRates();
  } catch (err) {
    console.warn('rates failed', err);
    ratesData = null;
    table.replaceChildren(el('div', { class: 'hint', text: t('rates.fail') }));
    const ticker = $('#ratesTicker');
    if (ticker) ticker.textContent = '';
  }
}

function fmt(n, digits = 2) {
  if (typeof n !== 'number' || Number.isNaN(n)) return '—';
  return n.toLocaleString(getLang() === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: digits, minimumFractionDigits: n < 10 ? digits : 0 });
}

function renderRates() {
  const table = $('#ratesTable');
  if (!table) return;
  if (!ratesData) { table.replaceChildren(el('div', { class: 'hint', text: t('rates.fail') })); return; }
  const fiat = ratesData.fiat || {};
  const crypto = ratesData.crypto || {};
  const rows = [];
  const fiatKeys = Object.keys(fiat);
  const cryptoKeys = Object.keys(crypto);
  if (fiatKeys.length) {
    rows.push(el('div', { class: 'rates-group', text: t('rates.fiat') }));
    fiatKeys.forEach((code) => {
      const r = fiat[code];
      rows.push(el('div', { class: 'rates-row' }, [
        el('span', { class: 'rates-code', text: `${flag(code)} ${code}` }),
        el('span', { class: 'rates-name', text: NAMES[code]?.[getLang()] || '' }),
        el('span', { class: 'rates-value', text: `${fmt(r.value, 2)} ₽` }),
        delta(r.value, r.previous),
      ]));
    });
  }
  if (cryptoKeys.length) {
    rows.push(el('div', { class: 'rates-group', text: t('rates.crypto') }));
    cryptoKeys.forEach((code) => {
      const r = crypto[code];
      rows.push(el('div', { class: 'rates-row' }, [
        el('span', { class: 'rates-code', text: `${flag(code)} ${code}` }),
        el('span', { class: 'rates-name', text: NAMES[code]?.[getLang()] || '' }),
        el('span', { class: 'rates-value', text: `$${fmt(r.usd, r.usd < 10 ? 4 : 2)}` }),
        typeof r.change === 'number' ? el('span', { class: `rates-delta ${r.change >= 0 ? 'up' : 'down'}`, text: `${r.change >= 0 ? '▲' : '▼'} ${Math.abs(r.change).toFixed(2)}%` }) : el('span'),
      ]));
    });
  }
  if (ratesData.updated) rows.push(el('div', { class: 'hint', text: `${t('rates.updated')}: ${formatTime(ratesData.updated, true)}` }));
  table.replaceChildren(...rows);

  const ticker = $('#ratesTicker');
  if (ticker) {
    const parts = [];
    if (fiat.USD) parts.push(`$ ${fmt(fiat.USD.value)}`);
    if (fiat.EUR) parts.push(`€ ${fmt(fiat.EUR.value)}`);
    if (crypto.BTC) parts.push(`₿ ${fmt(crypto.BTC.usd, 0)}`);
    if (crypto.ETH) parts.push(`Ξ ${fmt(crypto.ETH.usd, 0)}`);
    ticker.textContent = parts.join(' · ');
    ticker.title = t('rates.title');
  }
}

function delta(value, previous) {
  if (typeof value !== 'number' || typeof previous !== 'number' || !previous) return el('span');
  const d = ((value - previous) / previous) * 100;
  return el('span', { class: `rates-delta ${d >= 0 ? 'up' : 'down'}`, text: `${d >= 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(2)}%` });
}

function flag(code) {
  return { USD: '🇺🇸', EUR: '🇪🇺', CNY: '🇨🇳', GBP: '🇬🇧', JPY: '🇯🇵', KZT: '🇰🇿', TRY: '🇹🇷', BTC: '₿', ETH: '⟠', TON: '💎', SOL: '◎', DOGE: '🐕' }[code] || '💱';
}

// ---------------------------------------------------------------------------
// Локальное время участников (по их часовому поясу)
// ---------------------------------------------------------------------------

function renderTz() {
  const list = $('#tzList');
  if (!list) return;
  const users = session.users || [];
  if (!session.connected || !users.length) {
    list.replaceChildren(el('div', { class: 'hint', text: t('tz.empty') }));
    return;
  }
  const byTz = new Map();
  users.forEach((u) => {
    const tz = u.tz || 'UTC';
    if (!byTz.has(tz)) byTz.set(tz, []);
    byTz.get(tz).push(u);
  });
  const now = Date.now();
  const rows = Array.from(byTz.entries()).map(([tz, members]) => {
    let time = '—';
    let offset = '';
    try {
      time = formatTime(now, false, tz);
      offset = tzOffsetLabel(tz);
    } catch { /* неизвестная зона */ }
    return el('div', { class: 'tz-row' }, [
      el('span', { class: 'tz-time', text: time }),
      el('span', { class: 'tz-zone', text: `${tz.replace(/_/g, ' ')} ${offset}` }),
      el('span', { class: 'tz-users', text: members.map((m) => `${m.avatar || ''} ${m.name}`).join(', ') }),
    ]);
  });
  list.replaceChildren(...rows);
}

function tzOffsetLabel(tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' }).formatToParts(new Date());
  const part = parts.find((p) => p.type === 'timeZoneName');
  return part ? `(${part.value})` : '';
}

// ---------------------------------------------------------------------------

export function init() {
  tickClock();
  setInterval(tickClock, 1000);
  renderMoon();
  setInterval(renderMoon, 60 * 60 * 1000);
  loadQuote('quote');
  loadRates();
  setInterval(loadRates, 10 * 60 * 1000);
  renderTz();

  $('#quoteBtn')?.addEventListener('click', () => loadQuote('quote'));
  $('#factBtn')?.addEventListener('click', () => loadQuote('fact'));
  $('#ratesRefreshBtn')?.addEventListener('click', loadRates);

  on('session:users', renderTz);
  on('session:left', renderTz);
  on('tick:minute', renderTz);
  on('lang', () => { renderMoon(); renderRates(); renderTz(); loadQuote('quote'); });
}

export function refreshRates() {
  return loadRates();
}
