// WebGL-режим на Three.js: библиотека подгружается из CDN по требованию,
// при отсутствии интернета остаётся CSS 3D.
import { $ } from '../core/dom.js';
import { state, subscribe, setState, activeObject } from '../core/store.js';
import { t } from '../core/i18n.js';
import { toast } from '../ui/toast.js';

const CDN = [
  'https://unpkg.com/three@0.160.0/build/three.module.js',
  'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js',
];

let THREE = null;
let canvas; let renderer; let scene; let camera; let mesh; let dirLight;
let raf = null;
let enabled = false;
let failed = false;
let builtKey = null;
let resizeObserver = null;

export function init() {
  canvas = $('#webglCanvas');
  subscribe(onState);
  if (state.webgl && state.use3d) setEnabled(true);
}

function status(text) {
  const node = $('#webglStatus');
  if (node) node.textContent = text;
}

function onState(s, patch, meta) {
  if ('webgl' in patch || 'use3d' in patch || meta.replace) {
    setEnabled(Boolean(s.webgl && s.use3d));
  }
  if (enabled && ('shape3d' in patch || 'objects' in patch)) buildMesh();
}

async function load() {
  if (THREE) return true;
  if (failed) return false;
  status(t('m3.webglLoading'));
  for (const url of CDN) {
    try {
      THREE = await import(/* @vite-ignore */ url);
      break;
    } catch (err) {
      console.warn('three.js load failed', url, err);
    }
  }
  if (!THREE) {
    failed = true;
    status(t('m3.webglFail'));
    toast(t('m3.webglFail'), { type: 'warn' });
    setState({ webgl: false }, { source: 'system' });
    return false;
  }
  return true;
}

function setup() {
  if (renderer) return;
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 1.4, 6.5);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 0.9));
  dirLight = new THREE.DirectionalLight(0xffffff, 1.6);
  dirLight.position.set(3, 6, 4);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.set(1024, 1024);
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 20;
  scene.add(dirLight);
  const rim = new THREE.PointLight(0x88ccff, 0.8, 30);
  rim.position.set(-4, 2, -3);
  scene.add(rim);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.ShadowMaterial({ opacity: 0.32 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -1.9;
  ground.receiveShadow = true;
  scene.add(ground);

  resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe($('#stage'));
  resize();
}

function resize() {
  if (!renderer) return;
  const stage = $('#stage');
  const w = stage.clientWidth || 600;
  const h = stage.clientHeight || 400;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

function geometryFor(shape) {
  switch (shape) {
    case 'pyramid': { const g = new THREE.ConeGeometry(1.6, 2.1, 4); g.rotateY(Math.PI / 4); return g; }
    case 'prism': { const g = new THREE.CylinderGeometry(1.3, 1.3, 2.4, 3); g.rotateZ(Math.PI / 2); g.rotateY(Math.PI / 2); return g; }
    case 'cylinder': return new THREE.CylinderGeometry(1, 1, 2.2, 48);
    case 'sphere': return new THREE.SphereGeometry(1.35, 48, 32);
    case 'dodecahedron': return new THREE.DodecahedronGeometry(1.45);
    case 'torus': return new THREE.TorusGeometry(1.1, 0.42, 24, 72);
    default: return new THREE.BoxGeometry(2, 2, 2);
  }
}

const RUBIK = { px: 0xef4444, nx: 0xf97316, py: 0xfacc15, ny: 0xf8fafc, pz: 0x22c55e, nz: 0x3b82f6, inner: 0x111827 };

function buildRubikGroup() {
  const group = new THREE.Group();
  const geo = new THREE.BoxGeometry(0.62, 0.62, 0.62);
  for (const x of [-1, 0, 1]) for (const y of [-1, 0, 1]) for (const z of [-1, 0, 1]) {
    const mats = [
      new THREE.MeshStandardMaterial({ color: x === 1 ? RUBIK.px : RUBIK.inner, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: x === -1 ? RUBIK.nx : RUBIK.inner, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: y === 1 ? RUBIK.ny : RUBIK.inner, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: y === -1 ? RUBIK.py : RUBIK.inner, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: z === 1 ? RUBIK.pz : RUBIK.inner, roughness: 0.4 }),
      new THREE.MeshStandardMaterial({ color: z === -1 ? RUBIK.nz : RUBIK.inner, roughness: 0.4 }),
    ];
    const cube = new THREE.Mesh(geo, mats);
    cube.position.set(x * 0.68, y * 0.68, z * 0.68);
    cube.castShadow = true;
    group.add(cube);
  }
  return group;
}

function buildDiceMesh(color) {
  // Кость: белый куб с «точками» — маленькими сферами на гранях
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.35 }));
  body.castShadow = true;
  group.add(body);
  const pipGeo = new THREE.SphereGeometry(0.13, 16, 12);
  const pipMat = new THREE.MeshStandardMaterial({ color });
  const layouts = { 1: [[0, 0]], 2: [[-0.5, 0.5], [0.5, -0.5]], 3: [[-0.5, 0.5], [0, 0], [0.5, -0.5]], 4: [[-0.5, 0.5], [0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]],
    5: [[-0.5, 0.5], [0.5, 0.5], [0, 0], [-0.5, -0.5], [0.5, -0.5]], 6: [[-0.5, 0.5], [0.5, 0.5], [-0.5, 0], [0.5, 0], [-0.5, -0.5], [0.5, -0.5]] };
  const faces = [
    [1, (u, v) => [u, v, 1.01]], [6, (u, v) => [u, v, -1.01]], [2, (u, v) => [1.01, v, -u]],
    [5, (u, v) => [-1.01, v, u]], [3, (u, v) => [u, 1.01, -v]], [4, (u, v) => [u, -1.01, v]],
  ];
  for (const [n, place] of faces) {
    for (const [u, v] of layouts[n]) {
      const pip = new THREE.Mesh(pipGeo, pipMat);
      pip.position.set(...place(u, v));
      group.add(pip);
    }
  }
  return group;
}

function buildMesh() {
  if (!scene) return;
  const color = activeObject()?.color ?? '#38BDF8';
  const key = `${state.shape3d}|${color}`;
  if (key === builtKey && mesh) return;
  if (mesh) {
    scene.remove(mesh);
    mesh.traverse?.((o) => { o.geometry?.dispose?.(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose?.()); });
  }
  if (state.shape3d === 'rubik') mesh = buildRubikGroup();
  else if (state.shape3d === 'dice') mesh = buildDiceMesh(color);
  else {
    mesh = new THREE.Mesh(geometryFor(state.shape3d), new THREE.MeshStandardMaterial({ color, metalness: 0.25, roughness: 0.32 }));
    mesh.castShadow = true;
  }
  scene.add(mesh);
  builtKey = key;
  status(t('m3.webglOk', { shape: t(`s3.${state.shape3d}`) }));
}

let spinStart = performance.now();

function frame(now) {
  raf = requestAnimationFrame(frame);
  if (!mesh) return;
  const anims = activeObject()?.animations ?? [];
  const speed = Math.max(0.1, state.speed);
  const tt = ((now - spinStart) / 1000) * speed;
  const playing = state.playing;
  let rotY = state.modelRotY;
  let scale = 1; let y = 0; let x = 0; let rotZ = 0; let rotX = state.modelRotX;
  if (playing) {
    if (anims.includes('rotate') && state.shape3d !== 'dice') rotY += ((now - spinStart) / (3000 / speed)) * 360;
    if (anims.includes('pulse')) scale *= 1 + 0.12 * Math.sin(tt * Math.PI * 2 / 1.2);
    if (anims.includes('heartbeat')) scale *= 1 + 0.18 * Math.max(0, Math.sin(tt * Math.PI * 2 / 1.4)) ** 4;
    if (anims.includes('bounce')) y += Math.abs(Math.sin(tt * Math.PI / 1.5)) * 1.1;
    if (anims.includes('float')) { y += Math.sin(tt * Math.PI * 2 / 3.2) * 0.35; rotZ += Math.sin(tt * Math.PI * 2 / 3.2) * 0.05; }
    if (anims.includes('shake')) x += Math.sin(tt * Math.PI * 2 / 0.16) * 0.15;
    if (anims.includes('slide')) x += Math.sin(tt * Math.PI * 2 / 2) * 1.2;
    if (anims.includes('swing')) rotZ += Math.sin(tt * Math.PI * 2 / 2) * 0.25;
    if (anims.includes('flip')) rotY += (tt / 2.4) * 360;
    if (anims.includes('wobble')) { x += Math.sin(tt * Math.PI * 2 / 1.6) * 0.4; rotZ += Math.sin(tt * Math.PI * 2 / 1.6) * 0.08; }
    if (anims.includes('spiral')) { rotY += (tt / 3) * 720; scale *= 0.65 + 0.35 * Math.abs(Math.cos(tt * Math.PI / 3)); }
    if (anims.includes('orbit')) { x += Math.cos(tt * Math.PI * 2 / 3) * 1.2; y += Math.sin(tt * Math.PI * 2 / 3) * 1.2; }
    if (anims.includes('zigzag')) { const p = (tt / 2.4) % 1; x += Math.sin(p * Math.PI * 2) * 1; y += Math.abs(Math.sin(p * Math.PI)) * 1.2; }
    if (anims.includes('tada')) { const p = (tt / 1.6) % 1; if (p > 0.1 && p < 0.9) { rotZ += Math.sin(p * Math.PI * 10) * 0.06; scale *= 1.08; } }
    if (anims.includes('jello') || anims.includes('rubber')) { const p = (tt / 1.6) % 1; scale *= 1 + Math.sin(p * Math.PI * 4) * Math.exp(-p * 4) * 0.2; }
  }
  mesh.rotation.set(rotX * Math.PI / 180, rotY * Math.PI / 180, rotZ);
  mesh.position.set(x, y, 0);
  mesh.scale.setScalar(scale);
  mesh.visible = !(playing && anims.includes('blink') && Math.floor(tt) % 2 === 1);
  const fade = playing && anims.includes('fade') ? 0.6 + 0.4 * Math.cos(tt * Math.PI * 2 / 1.5) : 1;
  mesh.traverse((o) => {
    if (!o.material) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) { m.transparent = fade < 1; m.opacity = fade; }
  });
  if (playing && anims.includes('color') && mesh.material) mesh.material.color.offsetHSL(0.004, 0, 0);
  camera.position.set(0, 1.4, 6.5 / Math.max(0.4, state.modelZoom));
  camera.lookAt(0, 0, 0);
  renderer.render(scene, camera);
}

export async function setEnabled(on) {
  if (on === enabled) return;
  if (on) {
    const ok = await load();
    if (!ok) return;
    setup();
    enabled = true;
    canvas.classList.remove('hidden');
    builtKey = null;
    buildMesh();
    spinStart = performance.now();
    resize();
    if (!raf) raf = requestAnimationFrame(frame);
  } else {
    enabled = false;
    canvas.classList.add('hidden');
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    status('');
  }
}

export function isEnabled() {
  return enabled;
}
