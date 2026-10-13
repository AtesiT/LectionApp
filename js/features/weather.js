// Погода (Open-Meteo, без ключа): виджет, чип в шапке, синхронизация сцены с погодой.
import { $, el, loadJSON, saveJSON } from '../core/dom.js';
import { emit, on } from '../core/bus.js';
import { t, getLang } from '../core/i18n.js';
import { state, setState, subscribe } from '../core/store.js';
import { toast } from '../ui/toast.js';

const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
// Запасной путь — прокси на нашем сервере: он сам перебирает источники
// (Open-Meteo → met.no → wttr.in) и присылает уже приведённый к WMO ответ.
const PROXY_URL = '/api/ext/weather';
const DIRECT_TIMEOUT = 6000;

let current = null;   // { place, temp, feels, humidity, wind, code, isDay, daily: [...] }
let refreshTimer = null;
let thunderTimer = null;
let saved = loadJSON('mp2:weather', null);

export function init() {
  $('#weatherForm')?.addEventListener('submit', (e) => { e.preventDefault(); const city = $('#weatherCity').value.trim(); if (city) loadByCity(city); });
  $('#weatherLocateBtn')?.addEventListener('click', locate);
  $('#weatherRefreshBtn')?.addEventListener('click', refresh);
  $('#weatherChip')?.addEventListener('click', () => document.querySelector('.tab[data-tab="widgets"]')?.click());
  subscribe((s, patch, meta) => {
    if ('weatherSync' in patch || meta.replace) {
      if (s.weatherSync) applyToScene(true);
      else clearSceneWeather();
    }
  });
  on('lang', () => render());
  if (saved?.lat) {
    $('#weatherCity').value = saved.place || '';
    if (saved.temp !== undefined) applyPayload({ ...saved, source: 'cache', cached: true });
    loadByCoords(saved.lat, saved.lon, saved.place);
  } else {
    loadByCity(getLang() === 'ru' ? 'Москва' : 'London', true);
  }
  refreshTimer = setInterval(refresh, 15 * 60 * 1000);
}

export function refresh() {
  if (saved?.lat) loadByCoords(saved.lat, saved.lon, saved.place);
}

function locate() {
  if (!navigator.geolocation) { toast(t('weather.geoFail'), { type: 'warn' }); return; }
  setBody(t('weather.loading'));
  navigator.geolocation.getCurrentPosition(
    (pos) => loadByCoords(pos.coords.latitude, pos.coords.longitude, ''),
    () => toast(t('weather.geoFail'), { type: 'warn' }),
    { timeout: 8000, maximumAge: 600000 },
  );
}

async function loadByCity(city, silent = false) {
  setBody(t('weather.loading'));
  // 1) геокодер Open-Meteo напрямую из браузера; 2) если недоступен — геокодер на сервере
  try {
    const url = `${GEO_URL}?name=${encodeURIComponent(city)}&count=1&language=${getLang()}&format=json`;
    const data = await fetchJson(url, DIRECT_TIMEOUT);
    const hit = data?.results?.[0];
    if (!hit) throw new Error('not found');
    const place = [hit.name, hit.country_code].filter(Boolean).join(', ');
    await loadByCoords(hit.latitude, hit.longitude, place);
    return;
  } catch (err) {
    console.warn('geocode failed, using server proxy', err);
  }
  try {
    const data = await fetchJson(`${PROXY_URL}?q=${encodeURIComponent(city)}&lang=${getLang()}`, 15000);
    if (!data?.ok) throw new Error(data?.error || 'proxy failed');
    emit('weather:fallback', data.source);
    applyPayload(data);
    return;
  } catch (err) {
    console.warn('weather proxy failed', err);
  }
  if (!silent) toast(t('weather.allFail'), { type: 'warn' });
  setBody(saved?.temp !== undefined ? renderSaved() : t('weather.fail'));
}

async function loadByCoords(lat, lon, place = '') {
  setBody(t('weather.loading'));
  const params = new URLSearchParams({
    latitude: lat.toFixed(4), longitude: lon.toFixed(4),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min',
    timezone: 'auto', forecast_days: '5',
  });
  try {
    const data = await fetchJson(`${FORECAST_URL}?${params}`, DIRECT_TIMEOUT);
    const c = data.current;
    applyPayload({
      ok: true, source: 'open-meteo',
      place: place || `${lat.toFixed(2)}, ${lon.toFixed(2)}`,
      temp: Math.round(c.temperature_2m),
      feels: Math.round(c.apparent_temperature),
      humidity: c.relative_humidity_2m,
      wind: Math.round(c.wind_speed_10m),
      code: c.weather_code,
      isDay: c.is_day === 1,
      daily: (data.daily?.time || []).map((day, i) => ({
        date: day, code: data.daily.weather_code[i], max: Math.round(data.daily.temperature_2m_max[i]), min: Math.round(data.daily.temperature_2m_min[i]),
      })),
    });
    return;
  } catch (err) {
    console.warn('open-meteo unavailable, asking server', err);
  }
  // Прямой запрос не прошёл (блокировка, нет интернета, старый TLS) — пробуем серверный каскад.
  try {
    const q = `${PROXY_URL}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&place=${encodeURIComponent(place)}&lang=${getLang()}`;
    const data = await fetchJson(q, 20000);
    if (!data?.ok) throw new Error(data?.error || 'proxy failed');
    emit('weather:fallback', data.source);
    applyPayload(data);
    return;
  } catch (err) {
    console.warn('weather proxy failed', err);
  }
  if (saved && saved.temp !== undefined) {
    applyPayload({ ...saved, source: 'cache', cached: true, lat, lon });
    toast(t('weather.cached'), { type: 'warn' });
    return;
  }
  setBody(t('weather.fail'));
  const chip = $('#weatherChip');
  if (chip) chip.textContent = '🌤 —';
}

/** Кладёт приведённые данные в состояние и обновляет виджет. */
function applyPayload(data) {
  current = {
    place: data.place || `${Number(data.lat ?? 0).toFixed(2)}, ${Number(data.lon ?? 0).toFixed(2)}`,
    temp: Math.round(data.temp),
    feels: Math.round(data.feels ?? data.temp),
    humidity: Math.round(data.humidity ?? 0),
    wind: Math.round(data.wind ?? 0),
    code: Number(data.code ?? 3),
    isDay: Boolean(data.isDay),
    daily: (data.daily || []).slice(0, 5).map((d) => ({ date: d.date, code: Number(d.code), max: Math.round(d.max), min: Math.round(d.min) })),
    source: data.source || 'open-meteo',
    cached: Boolean(data.cached),
    updated: Date.now(),
  };
  saved = { lat: Number(data.lat ?? saved?.lat ?? 0), lon: Number(data.lon ?? saved?.lon ?? 0), place: current.place, temp: current.temp, code: current.code, isDay: current.isDay, wind: current.wind, humidity: current.humidity, daily: current.daily };
  saveJSON('mp2:weather', saved);
  render();
  emit('weather:loaded', current);
  if (state.weatherSync) applyToScene(false);
}

function renderSaved() {
  if (saved && saved.temp !== undefined) {
    applyPayload({ ...saved, source: 'cache', cached: true });
    return t('weather.cached');
  }
  return t('weather.fail');
}

/** fetch с таймаутом: долгий источник не должен подвешивать виджет. */
async function fetchJson(url, timeout = DIRECT_TIMEOUT) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;
  try {
    const res = await fetch(url, controller ? { signal: controller.signal } : undefined);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function iconFor(code, isDay = true) {
  if (code === 0) return isDay ? '☀️' : '🌙';
  if (code <= 2) return isDay ? '🌤' : '☁️';
  if (code === 3) return '☁️';
  if (code === 45 || code === 48) return '🌫';
  if (code >= 51 && code <= 57) return '🌦';
  if (code >= 61 && code <= 67) return '🌧';
  if (code >= 71 && code <= 77) return '🌨';
  if (code >= 80 && code <= 82) return '🌧';
  if (code >= 85 && code <= 86) return '🌨';
  if (code >= 95) return '⛈';
  return '🌡';
}

export function describeCode(code) {
  const key = `wc.${code}`;
  const text = t(key);
  return text === key ? `#${code}` : text;
}

function setBody(text) {
  const body = $('#weatherBody');
  if (body) body.replaceChildren(el('span', { class: 'hint', text }));
}

function render() {
  if (!current) return;
  const body = $('#weatherBody');
  const forecast = $('#weatherForecast');
  const chip = $('#weatherChip');
  const icon = iconFor(current.code, current.isDay);
  if (chip) chip.textContent = `${icon} ${current.temp}°C · ${current.place.split(',')[0]}`;
  if (body) {
    body.replaceChildren(
      el('div', { class: 'weather-main' }, [
        el('span', { class: 'weather-icon', text: icon }),
        el('div', {}, [
          el('div', { class: 'weather-temp', text: `${current.temp}°C` }),
          el('div', { class: 'weather-desc', text: `${describeCode(current.code)} · ${current.place}` }),
        ]),
      ]),
      el('div', { class: 'weather-details' }, [
        el('span', { text: `${t('weather.feels')} ${current.feels}°` }),
        el('span', { text: `💨 ${t('weather.wind')} ${current.wind} km/h` }),
        el('span', { text: `💧 ${t('weather.humidity')} ${current.humidity}%` }),
      ]),
    );
  }
  if (forecast) {
    forecast.replaceChildren(...current.daily.map((d, i) => el('div', { class: 'forecast-day' }, [
      el('span', { class: 'forecast-date', text: i === 0 ? t('weather.today') : new Date(d.date).toLocaleDateString(getLang() === 'ru' ? 'ru-RU' : 'en-US', { weekday: 'short' }) }),
      el('span', { class: 'forecast-icon', text: iconFor(d.code, true) }),
      el('span', { class: 'forecast-temp', text: `${d.max}° / ${d.min}°` }),
    ])));
  }
  const info = $('#weatherSyncInfo');
  if (info && state.weatherSync) info.textContent = t('scene.weatherSyncInfo', { desc: describeCode(current.code), temp: current.temp, effect: effectFor(current).effect });
  const src = $('#weatherSource');
  if (src) {
    const name = current.source === 'cache' ? t('weather.cached') : t('weather.source', { source: current.source || 'open-meteo' });
    src.textContent = current.cached ? `${name} (${t('weather.cached')})` : name;
  }
}

/** Подбор эффекта сцены по погоде. */
export function effectFor(w) {
  const c = w.code;
  if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { effect: 'snow', intensity: c >= 75 ? 2 : 1.2 };
  if (c >= 95) return { effect: 'rain', intensity: 2, thunder: true };
  if ((c >= 51 && c <= 67) || (c >= 80 && c <= 82)) return { effect: 'rain', intensity: c >= 63 ? 1.8 : 1 };
  if (c === 45 || c === 48) return { effect: 'fog', intensity: 1.4 };
  if (c === 3) return { effect: 'fog', intensity: 0.5 };
  if (c <= 1 && !w.isDay) return { effect: 'stars', intensity: 1 };
  return { effect: 'none', intensity: 1 };
}

function applyToScene(withFeed) {
  const info = $('#weatherSyncInfo');
  if (!current) {
    if (info) info.textContent = t('scene.weatherSyncNeed');
    return;
  }
  const { effect, intensity, thunder } = effectFor(current);
  setState({ effect, effectIntensity: intensity }, withFeed ? { action: 'weatherSync' } : { source: 'system' });
  const overlay = $('#weatherOverlay');
  if (overlay) {
    let tint = 'transparent';
    if (current.temp <= 0) tint = 'rgba(147, 197, 253, 0.22)';
    else if (current.temp >= 28) tint = 'rgba(251, 146, 60, 0.2)';
    else if (!current.isDay) tint = 'rgba(15, 23, 42, 0.35)';
    overlay.style.background = tint;
  }
  emit('weather:wind', Math.min(3, current.wind / 15));
  document.getElementById('objectsLayer')?.style.setProperty('--wind', String(Math.min(1, current.wind / 40)));
  clearInterval(thunderTimer);
  if (thunder) thunderTimer = setInterval(() => { if (Math.random() < 0.5) emit('effects:flash'); }, 4000);
  if (info) info.textContent = t('scene.weatherSyncInfo', { desc: describeCode(current.code), temp: current.temp, effect });
}

function clearSceneWeather() {
  const overlay = $('#weatherOverlay');
  if (overlay) overlay.style.background = 'transparent';
  emit('weather:wind', 0);
  document.getElementById('objectsLayer')?.style.setProperty('--wind', '0');
  clearInterval(thunderTimer);
  const info = $('#weatherSyncInfo');
  if (info) info.textContent = '';
}

export function getWeather() {
  return current;
}
