// Звонок: видео и голос между участниками (WebRTC) + демонстрация экрана.
// Сигналинг идёт через наш сервер (kind: 'rtc'), сами медиа-потоки — напрямую
// между браузерами (peer-to-peer), поэтому сервер не нагружается.
import { $, el } from '../core/dom.js';
import { on, emit } from '../core/bus.js';
import { t } from '../core/i18n.js';
import * as transport from './transport.js';
import { session } from './session.js';
import { toast } from '../ui/toast.js';

const ICE_SERVERS = [
  { urls: ['stun:stun.l.google.com:19302', 'stun:global.stun.twilio.com:3478'] },
];

let localStream = null;
let peers = new Map();          // userId → RTCPeerConnection
let started = false;
let screenTrack = null;
let cameraTrack = null;
let wrap; let grid; let statusEl;
let micOn = true;
let camOn = true;

export function init() {
  wrap = $('#callWrap');
  grid = $('#callGrid');
  statusEl = $('#callStatus');
  $('#callBtn')?.addEventListener('click', () => (started ? stopCall() : startCall()));
  $('#callScreenBtn')?.addEventListener('click', toggleScreen);
  $('#callMicBtn')?.addEventListener('click', toggleMic);
  $('#callCamBtn')?.addEventListener('click', toggleCam);
  $('#callHangupBtn')?.addEventListener('click', stopCall);
  on('net:message', onMessage);
  on('session:left', stopCall);
  on('lang', () => { renderStatus(); updateCallBtn(); });
}

export function isSupported() {
  return typeof RTCPeerConnection === 'function' && Boolean(navigator.mediaDevices?.getUserMedia);
}

export function isInCall() {
  return started;
}

// --- запуск и остановка --------------------------------------------------------

export async function startCall({ video = true, audio = true } = {}) {
  if (started) return false;
  if (!isSupported()) {
    toast(t('call.unsupported'), { type: 'warn' });
    return false;
  }
  try {
    localStream = await navigator.mediaDevices.getUserMedia({ video, audio });
  } catch (err) {
    console.warn('getUserMedia failed', err);
    toast(t('call.noDevice'), { type: 'warn' });
    return false;
  }
  started = true;
  const btn = $('#callBtn');
  if (btn) btn.textContent = t('call.hangup');
  cameraTrack = localStream.getVideoTracks()[0] || null;
  micOn = audio;
  camOn = video;
  wrap?.classList.remove('hidden');
  document.body.classList.add('in-call');
  $('#callBtn')?.classList.add('active');
  addVideo(session.userId, localStream, t('call.you'), true);
  // Кто уже в комнате — тем шлём приглашение (offer).
  for (const user of session.users) {
    if (user.id !== session.userId) createOffer(user.id);
  }
  renderStatus();
  emit('call:started');
  toast(t('call.started'), { icon: '📹' });
  return true;
}

export function stopCall() {
  if (!started) return false;
  for (const [uid, pc] of peers) {
    sendSignal(uid, { type: 'bye' });
    pc.close();
  }
  peers.clear();
  localStream?.getTracks().forEach((track) => track.stop());
  localStream = null;
  screenTrack = null;
  cameraTrack = null;
  started = false;
  const btn = $('#callBtn');
  if (btn) btn.textContent = t('call.btn');
  grid?.replaceChildren();
  wrap?.classList.add('hidden');
  document.body.classList.remove('in-call');
  $('#callBtn')?.classList.remove('active');
  renderStatus();
  emit('call:stopped');
  return true;
}

export async function toggleScreen() {
  if (!started) { toast(t('call.startFirst'), { type: 'warn' }); return false; }
  if (screenTrack) {
    const sender = [...peers.values()].flatMap((pc) => pc.getSenders()).find((s) => s.track?.kind === 'video');
    await sender?.replaceTrack(cameraTrack || null);
    screenTrack.stop();
    screenTrack = null;
    if (cameraTrack) localStream.addTrack(cameraTrack);
    setLocalStream(localStream);
    toast(t('call.screenOff'), { icon: '🖥' });
    return false;
  }
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    screenTrack = stream.getVideoTracks()[0];
    for (const pc of peers.values()) {
      const sender = pc.getSenders().find((s) => s.track?.kind === 'video');
      if (sender) await sender.replaceTrack(screenTrack);
    }
    if (cameraTrack) localStream.removeTrack(cameraTrack);
    localStream.addTrack(screenTrack);
    setLocalStream(localStream);
    screenTrack.addEventListener('ended', () => toggleScreen());
    toast(t('call.screenOn'), { icon: '🖥' });
    return true;
  } catch (err) {
    console.warn('getDisplayMedia failed', err);
    toast(t('call.screenFail'), { type: 'warn' });
    return false;
  }
}

export function toggleMic() {
  if (!localStream) return false;
  micOn = !micOn;
  localStream.getAudioTracks().forEach((track) => { track.enabled = micOn; });
  $('#callMicBtn')?.classList.toggle('active', !micOn);
  $('#callMicBtn').textContent = micOn ? '🎤' : '🔇';
  return micOn;
}

export function toggleCam() {
  if (!localStream) return false;
  camOn = !camOn;
  localStream.getVideoTracks().forEach((track) => { track.enabled = camOn; });
  $('#callCamBtn')?.classList.toggle('active', !camOn);
  $('#callCamBtn').textContent = camOn ? '📹' : '🚫';
  return camOn;
}

// --- пиры -----------------------------------------------------------------------

function makePeer(uid) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  peers.set(uid, pc);
  if (localStream) localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
  pc.onicecandidate = (e) => {
    if (e.candidate) sendSignal(uid, { type: 'candidate', candidate: e.candidate });
  };
  pc.ontrack = (e) => {
    const user = session.users.find((u) => u.id === uid);
    addVideo(uid, e.streams[0], user?.name || t('call.participant'), false);
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
      removeVideo(uid);
      pc.close();
      peers.delete(uid);
      renderStatus();
    }
    renderStatus();
  };
  return pc;
}

async function createOffer(uid) {
  if (peers.has(uid)) return;
  const pc = makePeer(uid);
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  sendSignal(uid, { type: 'offer', sdp: pc.localDescription });
}

async function acceptOffer(uid, sdp) {
  const pc = peers.get(uid) || makePeer(uid);
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  sendSignal(uid, { type: 'answer', sdp: pc.localDescription });
}

function sendSignal(target, payload) {
  transport.send({ kind: 'rtc', target, payload });
}

function onMessage(msg) {
  if (msg.type !== 'rtc') return;
  const from = msg.from;
  const payload = msg.payload || {};
  if (from === session.userId) return;
  if (payload.type === 'offer') {
    if (!started) {
      // Нас позвали — поднимаем трубу автоматически (если браузер даст камеру).
      startCall().then((ok) => { if (ok) acceptOffer(from, payload.sdp).catch(console.warn); }).catch(console.warn);
    } else {
      acceptOffer(from, payload.sdp).catch(console.warn);
    }
    return;
  }
  if (payload.type === 'answer') {
    peers.get(from)?.setRemoteDescription(new RTCSessionDescription(payload.sdp)).catch(console.warn);
    return;
  }
  if (payload.type === 'candidate') {
    peers.get(from)?.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
    return;
  }
  if (payload.type === 'bye') {
    const pc = peers.get(from);
    if (pc) { pc.close(); peers.delete(from); }
    removeVideo(from);
    renderStatus();
  }
}

// --- картинка -------------------------------------------------------------------

function addVideo(uid, stream, name, muted) {
  if (!grid) return;
  removeVideo(uid);
  const video = el('video', { autoplay: true, playsinline: true, class: 'call-video' });
  video.srcObject = stream;
  video.muted = muted;
  if (muted) video.volume = 0;
  video.play?.().catch(() => {});
  const card = el('div', { class: `call-card ${muted ? 'self' : ''}`, dataset: { userId: uid } }, [
    video,
    el('span', { class: 'call-name', text: name }),
  ]);
  grid.append(card);
  renderStatus();
}

function removeVideo(uid) {
  grid?.querySelector(`.call-card[data-user-id="${uid}"]`)?.remove();
}

function setLocalStream(stream) {
  const node = grid?.querySelector(`.call-card[data-user-id="${session.userId}"] video`);
  if (node) {
    node.srcObject = stream;
    node.play?.().catch(() => {});
  }
}

function updateCallBtn() {
  const btn = $('#callBtn');
  if (btn) btn.textContent = started ? t('call.hangup') : t('call.btn');
}

function renderStatus() {
  if (!statusEl) return;
  if (!started) {
    statusEl.textContent = '';
    return;
  }
  const count = peers.size + 1;
  statusEl.textContent = t('call.status', { n: count });
}
