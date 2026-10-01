// Юнит-тесты медиа-модуля: разбор ссылок YouTube / Rutube / VK / файлов,
// адреса плееров и бюджет на передачу медиа между участниками.
// Запуск: node tests/media_test.mjs
import assert from 'node:assert/strict';
import { parseVideoUrl, embedUrl, thumbnailUrl, dataUrlBytes } from '../js/core/media.js';
import { syncableState, state, MEDIA_SYNC_BUDGET } from '../js/core/store.js';

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`✓ ${name}`);
  } catch (err) {
    failures.push(`${name}: ${err.message}`);
    console.log(`✗ ${name} → ${err.message}`);
  }
}

// --- ссылки ------------------------------------------------------------------

check('YouTube: обычная ссылка', () => {
  const v = parseVideoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(v.provider, 'youtube');
  assert.equal(v.id, 'dQw4w9WgXcQ');
  assert.match(v.embed, /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  assert.match(v.embed, /autoplay=1/);
  assert.match(v.embed, /mute=1/);
  assert.match(v.embed, /loop=1/);
});

check('YouTube: короткая ссылка и shorts', () => {
  assert.equal(parseVideoUrl('https://youtu.be/dQw4w9WgXcQ').id, 'dQw4w9WgXcQ');
  assert.equal(parseVideoUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ').provider, 'youtube');
  assert.equal(parseVideoUrl('https://www.youtube.com/embed/dQw4w9WgXcQ').provider, 'youtube');
});

check('Rutube: ссылка на видео', () => {
  const v = parseVideoUrl('https://rutube.ru/video/3f8c1e2b9a7d5c4e6f0a1b2c3d4e5f6a/');
  assert.equal(v.provider, 'rutube');
  assert.equal(v.id, '3f8c1e2b9a7d5c4e6f0a1b2c3d4e5f6a');
  assert.match(v.embed, /rutube\.ru\/play\/embed\/3f8c1e2b9a7d5c4e6f0a1b2c3d4e5f6a/);
});

check('Rutube: ссылка вида /play/embed/', () => {
  const v = parseVideoUrl('https://rutube.ru/play/embed/abcdef0123456789');
  assert.equal(v.provider, 'rutube');
  assert.equal(v.id, 'abcdef0123456789');
});

check('VK: video-123456_789012', () => {
  const v = parseVideoUrl('https://vkvideo.ru/video-123456_789012');
  assert.equal(v.provider, 'vk');
  assert.match(v.embed, /video_ext\.php\?oid=-123456&id=789012/);
});

check('VK: старый формат video_ext.php', () => {
  const v = parseVideoUrl('https://vk.com/video_ext.php?oid=-228&id=456239017');
  assert.equal(v.provider, 'vk');
  assert.match(v.embed, /oid=-228/);
});

check('Прямой файл mp4/webm', () => {
  assert.equal(parseVideoUrl('https://example.com/clip.mp4').provider, 'file');
  assert.equal(parseVideoUrl('https://example.com/clip.webm?x=1').provider, 'file');
  assert.equal(parseVideoUrl('https://rutube.ru/'), null, 'главная Rutube — не видео');
  assert.equal(parseVideoUrl(''), null);
  assert.equal(parseVideoUrl('привет'), null);
});

check('Картинка — это не видео', () => {
  assert.equal(parseVideoUrl('https://example.com/pic.png'), null);
});

check('Превью только для YouTube', () => {
  assert.match(thumbnailUrl('youtube', 'dQw4w9WgXcQ'), /i\.ytimg\.com\/vi\/dQw4w9WgXcQ/);
  assert.equal(thumbnailUrl('rutube', 'abc'), null);
});

check('embedUrl: отключаемые параметры', () => {
  const url = embedUrl('youtube', 'ID', { loop: false, mute: false, autoplay: false });
  assert.ok(!url.includes('autoplay=1'));
  assert.ok(!url.includes('mute=1'));
  assert.ok(!url.includes('loop=1'));
});

// --- бюджет синхронизации -----------------------------------------------------

check('dataUrlBytes считает размер', () => {
  const url = `data:image/jpeg;base64,${'A'.repeat(4000)}`;
  assert.equal(dataUrlBytes(url), 3000);
});

check('Маленькая картинка уезжает участникам, большая — нет', () => {
  const small = `data:image/jpeg;base64,${'A'.repeat(4000)}`;
  const big = `data:image/jpeg;base64,${'B'.repeat(MEDIA_SYNC_BUDGET * 2)}`;
  const prev = state.objects;
  state.objects = [
    { id: 'a', shape: 'image', image: small, video: null, customPath: [] },
    { id: 'b', shape: 'image', image: big, video: null, customPath: [] },
  ];
  try {
    const out = syncableState();
    assert.equal(out.objects[0].image, small, 'лёгкая картинка должна уехать целиком');
    assert.equal(out.objects[1].image, 'has-image', 'тяжёлая картинка заменяется заглушкой');
  } finally {
    state.objects = prev;
  }
});

check('Ссылка на YouTube в объекте уезжает, локальный файл — нет', () => {
  const prev = state.objects;
  state.objects = [
    { id: 'v1', shape: 'video', image: null, video: { provider: 'youtube', id: 'dQw4w9WgXcQ', src: 'https://youtu.be/dQw4w9WgXcQ' }, customPath: [] },
    { id: 'v2', shape: 'video', image: null, video: { provider: 'file', id: 'clip', src: `data:video/mp4;base64,${'C'.repeat(400_000)}` }, customPath: [] },
  ];
  try {
    const out = syncableState();
    assert.equal(out.objects[0].video.src, 'https://youtu.be/dQw4w9WgXcQ');
    assert.equal(out.objects[1].video.src, 'local-media');
    assert.equal(out.objects[1].video.provider, 'file');
  } finally {
    state.objects = prev;
  }
});

check('Фон-видео по ссылке уезжает целиком', () => {
  const prev = state.background;
  state.background = { type: 'video', value: 'https://rutube.ru/video/abcdef0123456789/', provider: 'rutube', parallax: false };
  try {
    assert.equal(syncableState().background.value, 'https://rutube.ru/video/abcdef0123456789/');
  } finally {
    state.background = prev;
  }
});

console.log(`\nПроверок пройдено: ${passed}`);
if (failures.length) {
  console.log('\nОШИБКИ:');
  failures.forEach((f) => console.log(' - ' + f));
  process.exitCode = 1;
}
