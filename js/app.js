// Huấn luyện viên camera · Bơi ếch trên cạn — giao diện & luồng 5 màn.
import {
  buildExercise, computeFeatures, Tracker, Coach, frameCheck, gestureRaw, applyTemplates, ERR,
  REGIONS, SPEED_NAME, cycleDur, phaseDur, statsOf, phaseFeatureList, Smoother, FEATURE_NAMES,
} from './engine.js';
import { poseAt, restPose, toMediaPipe, drawFigure, timeline, BONES } from './demo.js';
import { voice } from './voice.js';
import { loadPose, detect, startCamera, stopCamera, listCameras, isMobile } from './pose.js';

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const SIM = new URLSearchParams(location.search).has('mo-phong');

// ---------- lưu trên máy (bọc try/catch) ----------
const store = {
  get(k, d) { try { const v = localStorage.getItem('cnqEch.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('cnqEch.' + k, JSON.stringify(v)); } catch (e) { /* bộ nhớ bị chặn */ } },
};
const settings = Object.assign({
  voice: true, voiceName: '', target: 'reps', sets: 2, rest: 25, ghost: false, height: 1.65, model: 'auto',
  posture: 'tren', leg: 'R', speed: 'cham', mode: 'nhip', cam: 'user', mini: true,
}, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);
voice.enabled = settings.voice;
if (settings.voiceName) voice.prefer(settings.voiceName);

// ---------- bài tập ----------
const BAI = {
  1: { title: 'Tay ếch đứng', mins: '~4 phút', pose: 'Đứng, tay giơ thẳng lên hoặc khom người tay ra trước', region: 'arms' },
  2: { title: 'Chân ếch một chân', mins: '~4 phút', pose: 'Đứng một chân, vịn ghế hoặc tường', region: 'legs' },
  3: { title: 'Thở + đầu', mins: '~4 phút', pose: 'Đứng thẳng, tay thả lỏng', region: 'head' },
  4: { title: 'Phối hợp ếch', mins: '~5 phút', pose: 'Đứng một chân, tay giơ thẳng (được quay nghiêng)', region: 'full' },
};
const SPEED_HINT = (bai) => {
  const ex = buildExercise(bai, {});
  return ['cham', 'vua', 'chuan'].map((s) => `${SPEED_NAME[s]} ${cycleDur(ex, s).toFixed(1).replace('.', ',')} giây`).join(' · ') + ' mỗi chu kỳ';
};

// ---------- mẫu HLV ----------
let repoTemplates = [], repoIndex = {};
const localTemplates = () => store.get('templates', []);
async function loadRepoTemplates() {
  try {
    const idx = await fetch('mau/index.json', { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : { files: [] }));
    repoIndex = idx;
    const files = idx.files || [];
    repoTemplates = (await Promise.all(files.map((f) => fetch('mau/' + f, { cache: 'no-cache' }).then((r) => (r.ok ? r.json() : null)).catch(() => null)))).filter(Boolean);
  } catch (e) { repoTemplates = []; }
}
const allTemplates = () => repoTemplates.concat(localTemplates());
function makeExercise(bai, leg) {
  return applyTemplates(buildExercise(bai, { leg }), allTemplates());
}

// ---------- trạng thái ----------
const S = {
  screen: 's-chon', bai: 1, camInfo: null, camOn: false, poseReady: false,
  img: null, world: null, F: null, lastDetect: 0, fps: 0,
  smImg: new Smoother(0.6), smWorld: new Smoother(0.5),
  readySince: 0, everReady: false, frame: null, mirror: true,
};
let T = null; // phiên tập
let R = null; // phiên ghi mẫu

// ---------- điều hướng ----------
const TITLES = { 's-chon': 'Bơi ếch trên cạn', 's-prep': 'Chuẩn bị', 's-demo': 'Xem mẫu', 's-train': 'Tập', 's-result': 'Kết quả', 's-settings': 'Cài đặt', 's-record': 'Ghi mẫu HLV' };
const BACK = { 's-prep': 's-chon', 's-demo': 's-prep', 's-result': 's-chon', 's-settings': 's-chon', 's-record': 's-chon' };
function show(id) {
  if (S.screen === 's-train' && id !== 's-train' && T && T.state !== 'done') endTraining(true);
  S.screen = id;
  $$('.screen').forEach((s) => (s.hidden = s.id !== id));
  $('#top-title').textContent = id === 's-prep' || id === 's-demo' || id === 's-train' ? `${S.bai}. ${BAI[S.bai].title}` : TITLES[id];
  $('#btn-back').hidden = !BACK[id];
  $('#btn-gear').hidden = id === 's-train';
  const slot = { 's-prep': '#slot-prep', 's-train': '#slot-train', 's-record': '#slot-record' }[id];
  if (slot) { $(slot).appendChild($('#stage')); ensureCamera(); } else { document.body.appendChild($('#stage')); }
  if (!slot && id !== 's-demo') stopCam();
  if (id === 's-demo') startDemo(); else stopDemo();
  if (id === 's-chon') renderCards();
  if (id === 's-settings') renderSettings();
  if (id === 's-record') renderRecord();
  if (id === 's-prep') renderPrep();
  window.scrollTo(0, 0);
}
$('#btn-back').onclick = () => show(BACK[S.screen] || 's-chon');
$('#btn-gear').onclick = () => show('s-settings');
$('#go-settings').onclick = () => show('s-settings');
$('#go-record').onclick = () => show('s-record');

function toast(msg, ms = 2600) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), ms);
}

// ---------- hình người tô ----------
function bodySvg(region) {
  const on = (part) => ({
    arms: ['head', 'torso', 'arms', 'hips'], legs: ['hips', 'legs'], head: ['head', 'shoulders'], full: ['head', 'shoulders', 'torso', 'arms', 'hips', 'legs'],
  }[region].includes(part) ? 'var(--pri)' : '#2a3b55');
  return `<svg viewBox="0 0 80 130" aria-hidden="true">
    <circle cx="40" cy="14" r="10" fill="${on('head')}"/>
    <rect x="26" y="27" width="28" height="7" rx="3" fill="${on('shoulders') === 'var(--pri)' || on('torso') === 'var(--pri)' ? 'var(--pri)' : '#2a3b55'}"/>
    <rect x="28" y="33" width="24" height="30" rx="4" fill="${on('torso')}"/>
    <path d="M27 30 L14 6 M53 30 L66 6" stroke="${on('arms')}" stroke-width="7" stroke-linecap="round"/>
    <rect x="28" y="61" width="24" height="10" rx="4" fill="${on('hips')}"/>
    <path d="M34 70 L33 124 M46 70 L47 124" stroke="${on('legs')}" stroke-width="8" stroke-linecap="round"/>
  </svg>`;
}

function renderCards() {
  const hist = store.get('history', []);
  $('#cards').innerHTML = [1, 2, 3, 4].map((b) => {
    const last = hist.filter((h) => h.bai === b).slice(-1)[0];
    return `<button class="card" data-bai="${b}">${bodySvg(BAI[b].region)}
      <div><h2>${b}. ${BAI[b].title}</h2>
      <div class="meta">${BAI[b].mins} · ${settings.sets} hiệp × ${settings.target === 'reps' ? '10 lần' : '60 giây'}</div>
      <div class="meta">Cần thấy: <b>${REGIONS[b].label}</b></div>
      <div class="meta">${BAI[b].pose}</div>
      ${last ? `<div class="last">Lần trước: ${last.correct}/${last.total} ${last.unit || ''}</div>` : ''}</div></button>`;
  }).join('');
  $$('#cards .card').forEach((c) => (c.onclick = () => { S.bai = +c.dataset.bai; voice.unlock(); show('s-prep'); }));
}

// ---------- camera dùng chung ----------
const video = $('#cam'), ov = $('#ov');
let camBusy = false;
async function ensureCamera() {
  if (SIM) { S.camOn = true; S.mirror = true; return; }
  if (S.camOn || camBusy) return;
  camBusy = true;
  setReadyMsg('Đang mở camera…', '');
  try {
    S.camInfo = await startCamera(video, settings.camId ? { deviceId: settings.camId } : { facing: settings.cam });
    S.mirror = S.camInfo.facing !== 'environment';
    video.classList.toggle('mirror', S.mirror);
    S.camOn = true;
    fillCamList();
  } catch (e) {
    setReadyMsg(e && e.name === 'NotAllowedError' ? 'Chưa được cấp quyền camera — bấm biểu tượng ổ khóa trên thanh địa chỉ để cho phép' : 'Không mở được camera: ' + (e.message || e), 'warn');
    camBusy = false; return;
  }
  camBusy = false;
  try {
    const kind = settings.model === 'auto' ? (isMobile() ? 'lite' : 'full') : settings.model;
    await loadPose(kind, (m) => m && setReadyMsg(m, ''));
    S.poseReady = true;
  } catch (e) { setReadyMsg('Không tải được bộ nhận diện: ' + (e.message || e), 'warn'); }
}
function stopCam() { if (!SIM) stopCamera(video); S.camOn = false; S.img = null; }
async function switchCamera(sel) {
  if (sel.deviceId) { settings.camId = sel.deviceId; } else { settings.camId = ''; settings.cam = sel.facing; }
  saveSettings();
  stopCam(); await ensureCamera(); markCamChips();
}
async function fillCamList() {
  const cams = await listCameras();
  const sel = $('#cam-list');
  sel.innerHTML = '<option value="">Webcam / camera khác…</option>' + cams.map((c, i) => `<option value="${c.deviceId}">${c.label || 'Camera ' + (i + 1)}</option>`).join('');
  sel.hidden = cams.length < 2 && !isMobile() ? false : cams.length < 1;
  if (settings.camId) sel.value = settings.camId;
  markCamChips();
}
function markCamChips() {
  $$('[data-cam]').forEach((b) => b.classList.toggle('on', !settings.camId && b.dataset.cam === settings.cam));
}
$$('[data-cam]').forEach((b) => (b.onclick = () => switchCamera({ facing: b.dataset.cam })));
$('#cam-list').onchange = (e) => e.target.value && switchCamera({ deviceId: e.target.value });

// ---------- vòng lặp nhận diện ----------
let lastVideoTime = -1, simT0 = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  if (!S.camOn) return;
  let r;
  if (SIM) r = simFrame(now);
  else {
    if (!S.poseReady || video.readyState < 2 || video.currentTime === lastVideoTime) return;
    lastVideoTime = video.currentTime;
    try { r = detect(video, now); } catch (e) { return; }
    if (r === undefined) return;
  }
  const dt = now - (S.lastDetect || now); S.lastDetect = now;
  if (dt > 0) S.fps = S.fps * 0.9 + (1000 / dt) * 0.1;
  S.img = r ? S.smImg.push(r.image) : S.smImg.push(null);
  S.world = r ? S.smWorld.push(r.world) : S.smWorld.push(null);
  S.frame = frameCheck(S.img, currentBai());
  if (S.screen === 's-prep') prepTick(now);
  else if (S.screen === 's-train') trainTick(now);
  else if (S.screen === 's-record') recordTick(now);
  drawOverlay(now);
}
requestAnimationFrame(loop);
function currentBai() { return S.screen === 's-record' && R ? R.bai : S.bai; }
function legFor(bai) { return bai === 2 || bai === 4 ? (settings.leg === 'L' ? 'L' : 'R') : 'R'; }

// mô phỏng: khung xương mẫu thay cho camera (?mo-phong)
function simFrame(now) {
  const bai = currentBai();
  const opts = { leg: T ? T.leg : legFor(bai), posture: settings.posture, speed: settings.speed };
  const ex = T ? T.ex : buildExercise(bai, opts);
  if (T && T.state !== 'run') return toMediaPipe(restPose(bai, opts), 20, 0.13);
  const t = (now - simT0) / 1000;
  return toMediaPipe(poseAt(ex, bai, opts, t).pts, 20, 0.13);
}

// ---------- vẽ khung xương lên camera ----------
const COL = { ok: '#2fd27a', near: '#ffa53a', bad: '#ff5160', none: 'rgba(255,255,255,.55)' };
function mapper(cw, ch) {
  const vw = SIM ? 3 : video.videoWidth || 4, vh = SIM ? 4 : video.videoHeight || 3;
  const s = Math.min(cw / vw, ch / vh), ox = (cw - vw * s) / 2, oy = (ch - vh * s) / 2;
  return (p) => ({ x: ox + (S.mirror ? 1 - p.x : p.x) * vw * s, y: oy + p.y * vh * s });
}
function sizeCanvas(c) {
  const r = c.getBoundingClientRect(), d = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.round(r.width * d), h = Math.round(r.height * d);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return d;
}
const REGION_BONES = {
  1: BONES.filter(([a, b]) => a <= 24 && b <= 24), 2: BONES.filter(([a, b]) => a >= 23 && b >= 23),
  3: [[11, 12]], 4: BONES,
};
function drawOverlay(now) {
  const d = sizeCanvas(ov), ctx = ov.getContext('2d');
  ctx.clearRect(0, 0, ov.width, ov.height);
  if (SIM) { ctx.fillStyle = '#0a1424'; ctx.fillRect(0, 0, ov.width, ov.height); }
  const img = S.img; if (!img) return;
  const M = mapper(ov.width, ov.height);
  const P = img.map(M);
  const bai = currentBai();
  // màu theo kiểm tra của pha đang làm
  const jc = {};
  const live = T && T.state === 'run' && T.tracker.live;
  const arrows = [];
  if (live) {
    for (const c of live.checks) for (const j of c.j || []) if (!jc[j] || rank(c.s) > rank(jc[j])) jc[j] = c.s;
    const held = now - T.tracker.enteredAt > 250;
    const bad = live.checks.find((c) => c.s === 'bad');
    if (bad && held && ERR[bad.err] && ERR[bad.err].arrow) arrows.push(...arrowFor(ERR[bad.err].arrow, img, T.leg));
  }
  if (T && T.state === 'run' && settings.ghost) drawGhost(ctx, img, M, d);
  const lw = 5 * d;
  ctx.lineCap = 'round';
  for (const [a, b] of REGION_BONES[bai]) {
    if ((img[a].visibility ?? 1) < 0.4 || (img[b].visibility ?? 1) < 0.4) continue;
    const s = worst(jc[a], jc[b]);
    ctx.strokeStyle = s ? COL[s] : COL.none; ctx.lineWidth = s ? lw * 1.3 : lw;
    ctx.beginPath(); ctx.moveTo(P[a].x, P[a].y); ctx.lineTo(P[b].x, P[b].y); ctx.stroke();
  }
  const pts = REGIONS[bai].pts.concat(bai === 3 ? [] : []);
  for (const i of pts) {
    if ((img[i].visibility ?? 1) < 0.4) continue;
    ctx.fillStyle = jc[i] ? COL[jc[i]] : '#fff';
    ctx.beginPath(); ctx.arc(P[i].x, P[i].y, (jc[i] ? 7 : 4.5) * d, 0, 7); ctx.fill();
  }
  if (bai === 3 || bai === 4 || bai === 1) { // đầu: vẽ hướng mặt
    const ear = { x: (P[7].x + P[8].x) / 2, y: (P[7].y + P[8].y) / 2 };
    ctx.strokeStyle = jc[0] ? COL[jc[0]] : COL.none; ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(ear.x, ear.y); ctx.lineTo(P[0].x, P[0].y); ctx.stroke();
  }
  for (const a of arrows) drawArrow(ctx, M(a.from), M({ x: a.from.x + a.dx, y: a.from.y + a.dy }), COL.bad, d);
}
const rank = (s) => ({ ok: 0, near: 1, bad: 2 }[s] ?? -1);
const worst = (a, b) => (rank(a) >= rank(b) ? a : b);
function drawArrow(ctx, A, B, color, d) {
  const ang = Math.atan2(B.y - A.y, B.x - A.x), h = 16 * d;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 6 * d;
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x - Math.cos(ang) * h * 0.6, B.y - Math.sin(ang) * h * 0.6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(B.x, B.y);
  ctx.lineTo(B.x - h * Math.cos(ang - 0.5), B.y - h * Math.sin(ang - 0.5));
  ctx.lineTo(B.x - h * Math.cos(ang + 0.5), B.y - h * Math.sin(ang + 0.5)); ctx.closePath(); ctx.fill();
}
/** mũi tên hướng sửa, trong tọa độ ảnh chuẩn hóa */
function arrowFor(kind, I, leg) {
  const L = 0.08, mx = (I[11].x + I[12].x) / 2, hx = (I[23].x + I[24].x) / 2;
  const sgn = (v) => (v >= 0 ? 1 : -1);
  const W = leg === 'L' ? { k: 25, a: 27, f: 31, h: 23 } : { k: 26, a: 28, f: 32, h: 24 };
  const O = leg === 'L' ? 28 : 27;
  const unit = (dx, dy) => { const l = Math.hypot(dx, dy) || 1; return { dx: (dx / l) * L, dy: (dy / l) * L }; };
  const mouth = { x: (I[9].x + I[10].x) / 2, y: (I[9].y + I[10].y) / 2 };
  switch (kind) {
    case 'wristsOut': return [15, 16].map((i) => ({ from: I[i], dx: sgn(I[i].x - mx) * L, dy: 0 }));
    case 'wristsIn': return [15, 16].map((i) => ({ from: I[i], dx: sgn(mx - I[i].x) * L * 0.8, dy: 0 }));
    case 'wristsToChin': return [15, 16].map((i) => ({ from: I[i], ...unit(mouth.x - I[i].x, mouth.y - I[i].y) }));
    case 'armsUp': return [[11, 15], [12, 16]].map(([s, w]) => ({ from: I[w], ...unit(I[w].x - I[s].x, I[w].y - I[s].y) }));
    case 'heelUp': return [{ from: I[W.a], ...unit(I[W.h].x - I[W.a].x, I[W.h].y - I[W.a].y) }];
    case 'kneeBack': return [{ from: I[W.k], ...unit(I[W.h].x - I[W.k].x, 0.5) }];
    case 'footOut': return [{ from: I[W.f], dx: sgn(I[W.a].x - hx) * L, dy: 0 }];
    case 'legOut': return [{ from: I[W.a], ...unit(sgn(I[W.a].x - hx), 0.6) }];
    case 'legsIn': return [{ from: I[W.a], ...unit(I[O].x - I[W.a].x, I[O].y - I[W.a].y) }];
    case 'toePoint': return [{ from: I[W.f], dx: 0, dy: L }];
    case 'headDown': return [{ from: I[0], dx: 0, dy: L }];
    case 'headUp': return [{ from: I[0], dx: 0, dy: -L }];
    default: return [];
  }
}
function drawGhost(ctx, img, M, d) {
  const bai = T.bai;
  const idx = T.tracker.next % T.ex.phases.length;
  const opts = { leg: T.leg, posture: settings.posture, speed: settings.speed };
  const tl = timeline(T.ex, settings.speed);
  const { pts } = poseAt(T.ex, bai, opts, tl[idx].start + tl[idx].dur * 0.95);
  const g = toMediaPipe(pts, 0).image; // ảnh gốc (chưa lật), giống ảnh camera
  const gs = { x: (g[11].x + g[12].x) / 2, y: (g[11].y + g[12].y) / 2 }, gw = Math.hypot(g[11].x - g[12].x, g[11].y - g[12].y);
  const us = { x: (img[11].x + img[12].x) / 2, y: (img[11].y + img[12].y) / 2 }, uw = Math.hypot(img[11].x - img[12].x, img[11].y - img[12].y);
  if (uw < 0.02) return;
  const sc = uw / gw;
  const Q = g.map((p) => M({ x: us.x + (p.x - gs.x) * sc, y: us.y + (p.y - gs.y) * sc }));
  ctx.globalAlpha = 0.28; ctx.strokeStyle = '#bfe9ff'; ctx.lineWidth = 14 * d; ctx.lineCap = 'round';
  for (const [a, b] of REGION_BONES[bai]) { ctx.beginPath(); ctx.moveTo(Q[a].x, Q[a].y); ctx.lineTo(Q[b].x, Q[b].y); ctx.stroke(); }
  ctx.globalAlpha = 1;
}

// ---------- khung bóng người ----------
function guideSvg(bai, ok) {
  const col = ok ? 'var(--ok)' : 'rgba(255,255,255,.55)';
  const shapes = {
    1: '<path d="M40 8 L60 8 M50 8 L50 20" /><circle cx="50" cy="30" r="8"/><path d="M36 40 H64 V78 H36 Z M36 42 L22 8 M64 42 L78 8"/>',
    2: '<path d="M36 10 H64 V24 H36 Z M42 24 L40 90 M58 24 L62 56 L52 70"/><path d="M30 92 H70"/>',
    3: '<circle cx="50" cy="40" r="17"/><path d="M22 92 Q50 60 78 92"/>',
    4: '<circle cx="50" cy="18" r="6"/><path d="M40 26 H60 V54 H40 Z M40 28 L30 4 M60 28 L70 4 M44 54 L43 94 M56 54 L60 74 L54 82"/>',
  };
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet"><g fill="none" stroke="${col}" stroke-width="1.6" stroke-dasharray="${ok ? '0' : '4 3'}" stroke-linecap="round" stroke-linejoin="round">${shapes[bai]}</g></svg>`;
}

// ---------- 2. CHUẨN BỊ ----------
function setReadyMsg(t, cls) { const m = $('#ready-msg'); m.textContent = t; m.className = 'ready-msg ' + (cls || ''); }
function segBind(root) {
  $$(root + ' .seg').forEach((seg) => {
    const key = seg.dataset.key; if (!key) return;
    seg.querySelectorAll('button').forEach((b) => {
      b.classList.toggle('on', String(settings[key]) === b.dataset.v);
      b.onclick = () => { settings[key] = b.dataset.v; saveSettings(); segBind(root); renderPlace(); };
    });
  });
}
function renderPrep() {
  const b = S.bai;
  $('#opt-posture').hidden = b !== 1;
  $('#opt-leg').hidden = !(b === 2 || b === 4);
  $('#leg-lr').hidden = b !== 4;
  if (b !== 4 && settings.leg === 'LR') settings.leg = 'R';
  segBind('#s-prep');
  $('#speed-hint').textContent = SPEED_HINT(b);
  S.everReady = false; S.readySince = 0;
  $('#go-demo').disabled = true;
  $('#guide').innerHTML = guideSvg(b, false);
  renderPlace();
  markCamChips();
}
function prepTick(now) {
  const f = S.frame;
  if (!S.poseReady && !SIM) return;
  if (f.ok) { if (!S.readySince) S.readySince = now; } else S.readySince = 0;
  const ready = S.readySince && now - S.readySince > 700;
  if (ready && !S.everReady) { S.everReady = true; $('#go-demo').disabled = false; }
  $('#slot-prep').classList.toggle('ready', !!ready);
  $('#slot-prep').classList.toggle('notready', !ready);
  $('#guide').innerHTML = guideSvg(S.bai, !!ready);
  setReadyMsg(ready ? 'Đã thấy đủ, sẵn sàng!' : f.hint + (S.bai === 2 ? ' · nhớ vịn ghế/tường' : ''), ready ? 'ok' : 'warn');
}
$('#go-demo').onclick = () => { voice.unlock(); show('s-demo'); };

// khoảng cách đặt máy (ước tính hình học, xem README)
const NEED = { 1: [0.86, 0.87], 2: [0.62, 0.6], 3: [0.32, 0.42], 4: [1.42, 0.9] }; // [cao, rộng] × chiều cao người
function camFov() {
  if (S.camInfo && S.camInfo.wide) return { v: 100, h: 80, name: 'camera góc rộng' };
  const portrait = window.innerHeight > window.innerWidth;
  if (isMobile()) return portrait ? { v: 64, h: 50, name: 'điện thoại dọc' } : { v: 50, h: 64, name: 'điện thoại ngang' };
  return { v: 39, h: 65, name: 'webcam máy tính' };
}
export function minDistance(bai, H, fov) {
  const [nh, nw] = NEED[bai], t = (deg) => Math.tan((deg * Math.PI) / 360);
  return Math.max((nh * H) / (2 * t(fov.v)), (nw * H) / (2 * t(fov.h)));
}
function renderPlace() {
  const fov = camFov(), H = +settings.height;
  const d = minDistance(S.bai, H, fov);
  const camH = { 1: 1.1, 2: 0.5, 3: 1.4, 4: 0.9 }[S.bai] * (H / 1.65);
  $('#place-text').innerHTML = `Đặt máy cách <b>≥ ${d.toFixed(1).replace('.', ',')} m</b><br>cao ~${camH.toFixed(1).replace('.', ',')} m, dựng đứng vững (${fov.name}).<br>Dọn trống 2 × 2 m quanh người.`;
  const px = Math.min(110, 40 + d * 22);
  $('#place-svg').innerHTML = `<svg viewBox="0 0 150 96">
    <line x1="4" y1="90" x2="146" y2="90" stroke="#2a3b55" stroke-width="2"/>
    <rect x="10" y="${88 - camH * 30}" width="9" height="15" rx="2" fill="var(--pri)"/><line x1="14" y1="${103 - camH * 30}" x2="14" y2="90" stroke="#9db2cf" stroke-width="2"/>
    <line x1="22" y1="${94 - camH * 30}" x2="${px + 10}" y2="${94 - camH * 30}" stroke="#9db2cf" stroke-dasharray="3 3"/>
    <g transform="translate(${px + 18},0)" fill="none" stroke="#f2f7ff" stroke-width="3" stroke-linecap="round">
      <circle cx="0" cy="22" r="6"/><path d="M0 28 V60 M0 32 L-10 12 M0 32 L10 12 M0 60 L-6 88 M0 60 L6 88"/></g>
    <text x="${(px + 22) / 2}" y="${86 - camH * 30}" fill="var(--pri)" font-size="12" text-anchor="middle">${d.toFixed(1).replace('.', ',')} m</text></svg>`;
}

// ---------- 3. XEM MẪU ----------
let demoRaf = 0, demoYaw = 35, demoT0 = 0;
function startDemo() {
  stopDemo();
  const b = S.bai;
  const ex = makeExercise(b, legFor(b));
  $('#demo-phases').className = 'phasebar' + (ex.phases.length > 6 ? ' dense' : '');
  $('#demo-phases').innerHTML = ex.phases.map((p) => `<div class="ph">${p.name}</div>`).join('');
  $('#demo-text').textContent = `${SPEED_NAME[settings.speed]}: ${cycleDur(ex, settings.speed).toFixed(1).replace('.', ',')} giây mỗi chu kỳ · ${settings.mode === 'nhip' ? 'máy đọc nhịp, các bạn làm theo' : 'tự do, máy chỉ nhận và chấm'}`;
  if (b === 2 || b === 4) demoYaw = 35; if (b === 3) demoYaw = 60;
  $$('#demo-view button').forEach((x) => { x.classList.toggle('on', +x.dataset.v === demoYaw); x.onclick = () => { demoYaw = +x.dataset.v; startDemoView(); }; });
  // video HLV nếu có: mau/video/baiN.mp4
  const vid = $('#demo-video');
  const vfile = repoIndex.video && repoIndex.video[String(b)];
  if (vfile) setTimeout(() => {
    if (S.screen !== 's-demo') return;
    vid.src = 'mau/' + vfile; vid.hidden = false; vid.play().catch(() => {});
    $('#demo-note').textContent = 'Video thị phạm của HLV'; $('#demo-canvas').hidden = true;
  }, 0);
  vid.hidden = true; $('#demo-canvas').hidden = false; $('#demo-note').textContent = 'Mẫu khung xương tạm (chưa có video HLV)';
  demoT0 = performance.now();
  let lastPh = -1;
  const cv = $('#demo-canvas');
  const opts = { leg: legFor(b), posture: settings.posture, speed: settings.speed };
  const tick = (now) => {
    demoRaf = requestAnimationFrame(tick);
    const d = sizeCanvas(cv), ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    const t = (now - demoT0) / 1000;
    const { pts, phase } = poseAt(ex, b, opts, t);
    const hl = phaseJoints(ex.phases[phase]);
    drawFigure(ctx, pts, cv.width, cv.height, { yaw: demoYaw, highlight: hl, alpha: 1 });
    void d;
    if (phase !== lastPh) {
      lastPh = phase;
      $('#demo-label').textContent = ex.phases[phase].name;
      $$('#demo-phases .ph').forEach((e, i) => e.classList.toggle('cur', i === phase));
    }
  };
  demoRaf = requestAnimationFrame(tick);
}
function startDemoView() { $$('#demo-view button').forEach((x) => x.classList.toggle('on', +x.dataset.v === demoYaw)); }
function stopDemo() { cancelAnimationFrame(demoRaf); const v = $('#demo-video'); v.pause(); }
function phaseJoints(p) { return [...new Set(p.quality.flatMap((q) => q.j || []))]; }
$('#go-train').onclick = () => { voice.unlock(); show('s-train'); startTraining(); };

// ---------- 4. TẬP ----------
function startTraining() {
  const b = S.bai;
  const leg = b === 2 || b === 4 ? (settings.leg === 'L' ? 'L' : 'R') : 'R';
  const ex = makeExercise(b, leg);
  T = {
    bai: b, leg, ex, tracker: new Tracker(ex, { speed: settings.speed }), coach: new Coach(),
    state: 'wait', set: 1, sets: +settings.sets, target: settings.target, mode: settings.mode, speed: settings.speed,
    repsInSet: 0, reps: [], phaseCount: {}, activeMs: 0, setActiveMs: 0, lastTick: 0, cadT: 0, cadPhase: -1, cadCycle: -1,
    pitchSamples: [], pitchBase: null, missingSince: 0, seenSince: 0, gestureSince: 0, gestureCool: 0,
    frames: [], cueUntil: 0, lastRepAt: 0, startedAt: Date.now(),
  };
  ex.phases.forEach((p) => (T.phaseCount[p.id] = { ok: 0, near: 0, bad: 0, miss: 0 }));
  renderPhasebar();
  $('#mini').hidden = !settings.mini; $('#b-voice').classList.toggle('off', !voice.enabled);
  $('#b-mini').classList.toggle('off', !settings.mini);
  updateStats();
  setCue('Đứng vào khung để bắt đầu');
  showBig('Về vị trí…', true);
  $('#guide').innerHTML = '';
  requestWake();
}
function renderPhasebar() {
  const ex = T.ex;
  $('#phasebar').className = 'phasebar' + (ex.phases.length > 6 ? ' dense' : '');
  $('#phasebar').innerHTML = ex.phases.map((p) => `<div class="ph" data-id="${p.id}">${ex.phases.length > 6 ? p.short : p.name}<small></small></div>`).join('');
  const side = $('#mini-side-slot');
  if (!side.querySelector('canvas')) side.innerHTML = '<canvas id="mini-side-canvas"></canvas>';
}
function showBig(t, small) { const b = $('#big'); b.hidden = !t; b.textContent = t || ''; b.classList.toggle('small', !!small); }
function setCue(t, kind = '', holdMs = 0) {
  const c = $('#cue'); c.textContent = t; c.className = 'cue ' + kind;
  if (holdMs) T.cueUntil = performance.now() + holdMs;
}
const fmt = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function updateStats() {
  if (!T) return;
  const tgt = T.target === 'reps';
  const total = T.reps.length, good = T.reps.filter((r) => r.correct).length;
  $('#st-reps').textContent = tgt ? `${T.repsInSet}/10` : `${T.repsInSet}`;
  $('#st-reps-l').textContent = 'Lần';
  if (T.ex.scoreBy === 'phase') {
    const pc = Object.values(T.phaseCount);
    const ok = pc.reduce((s, c) => s + c.ok + c.near, 0), all = pc.reduce((s, c) => s + c.ok + c.near + c.bad + c.miss, 0);
    $('#st-ok').textContent = `${ok}/${all}`; $('#st-ok-l').textContent = 'Pha đúng';
  } else { $('#st-ok').textContent = `${good}/${total}`; $('#st-ok-l').textContent = 'Lần đúng'; }
  $('#st-time').textContent = tgt ? fmt(T.activeMs) : fmt(60000 - T.setActiveMs);
  $('#st-set').textContent = `Hiệp ${T.set}/${T.sets}`;
}
function highlightPhase(i) { $$('#phasebar .ph').forEach((e, k) => e.classList.toggle('cur', k === i)); }
function flashPhase(res) {
  const el = $$('#phasebar .ph')[res.idx]; if (!el) return;
  el.classList.remove('f-ok', 'f-near', 'f-bad', 'f-miss'); el.classList.add('f-' + res.status);
  if (T.ex.scoreBy === 'phase') { const c = T.phaseCount[res.id]; el.querySelector('small').textContent = `✓${c.ok + c.near}`; }
}

function trainTick(now) {
  if (!T) return;
  const dt = T.lastTick ? Math.min(200, now - T.lastTick) : 0; T.lastTick = now;
  const f = S.frame;
  // cử chỉ tạm dừng / tiếp tục
  if (gestureRaw(S.img, T.bai) && now > T.gestureCool) {
    if (!T.gestureSince) T.gestureSince = now;
    if (now - T.gestureSince > 2000) {
      T.gestureSince = 0; T.gestureCool = now + 3000;
      if (T.state === 'run') pauseTraining('gesture'); else if (T.state === 'pause') resumeTraining();
    }
  } else T.gestureSince = 0;

  if (T.state === 'wait') {
    if (f.ok) { if (!T.seenSince) T.seenSince = now; } else { T.seenSince = 0; setCue(f.hint); }
    if (T.seenSince && now - T.seenSince > 800) startCountdown(now);
    return;
  }
  if (T.state === 'count') {
    if (S.world && f.ok) T.pitchSamples.push(computeFeatures(S.world, { leg: T.leg }).pitch);
    const left = 3 - Math.floor((now - T.countAt) / 1000);
    if (left !== T.countShown) {
      T.countShown = left;
      if (left > 0) { showBig(String(left)); voice.say(String(left) + '…'); } else { showBig('Bắt đầu!'); voice.say('Bắt đầu!'); }
    }
    if (now - T.countAt > 3600) beginRun(now);
    return;
  }
  if (T.state === 'pause') {
    if (T.pauseReason === 'lost') {
      if (f.ok) { if (!T.seenSince) T.seenSince = now; if (now - T.seenSince > 1200) resumeTraining(); } else T.seenSince = 0;
    }
    return;
  }
  if (T.state !== 'run') return;

  // ra khỏi khung -> tự tạm dừng
  if (!f.ok) {
    if (!T.missingSince) T.missingSince = now;
    if (now - T.missingSince > 1500) { pauseTraining('lost'); return; }
  } else T.missingSince = 0;

  T.activeMs += dt; T.setActiveMs += dt; T.cadT += dt;
  // nhịp
  const cyc = cycleDur(T.ex, T.speed) * 1000;
  const inCyc = T.cadT % cyc, cycN = Math.floor(T.cadT / cyc);
  let acc = 0, cp = 0;
  for (let i = 0; i < T.ex.phases.length; i++) { acc += phaseDur(T.ex, i, T.speed) * 1000; if (inCyc < acc) { cp = i; break; } }
  if (T.mode === 'nhip') {
    if (cp !== T.cadPhase || cycN !== T.cadCycle) {
      T.cadPhase = cp; T.cadCycle = cycN;
      const p = T.ex.phases[cp];
      const txt = T.speed === 'chuan' && p.sayFast ? p.sayFast : p.say;
      if (txt && now > T.cueUntil) { voice.say(txt, { rate: T.speed === 'chuan' ? 1.25 : T.speed === 'vua' ? 1.12 : 1.0 }); setCue(txt.replace(/…/g, '')); }
      highlightPhase(cp);
    }
  }

  // chấm
  if (S.world && f.ok) {
    const F = computeFeatures(S.world, { leg: T.leg, pitchBase: T.pitchBase });
    for (const e of T.tracker.update(F, T.activeMs)) handleEvent(e, now);
    if (T.mode === 'tudo') highlightPhase(T.tracker.cur >= 0 ? T.tracker.cur : -1);
    // gợi ý khi đứng yên quá lâu
    if (T.activeMs - T.lastRepAt > Math.max(9000, cyc * 2.6) && now > T.cueUntil) {
      const nx = T.ex.phases[T.tracker.next % T.ex.phases.length];
      const msg = `Làm tiếp nhé: ${nx.name}`;
      setCue(msg, 'fix', 3000); if (T.mode === 'tudo') voice.say(msg);
      T.lastRepAt = T.activeMs;
    }
  }
  // lưu khung để xem lại (~12 hình/giây, chỉ tọa độ)
  if (S.img && (!T.frames.length || T.activeMs - T.frames[T.frames.length - 1].t > 80) && T.frames.length < 4000) {
    const live = T.tracker.live;
    const jc = {}; if (live) for (const c of live.checks) for (const j of c.j || []) if (!jc[j] || rank(c.s) > rank(jc[j])) jc[j] = c.s;
    T.frames.push({ t: T.activeMs, p: S.img.map((q) => [+q.x.toFixed(3), +q.y.toFixed(3), (q.visibility ?? 1) > 0.4 ? 1 : 0]), c: jc, ph: T.tracker.cur });
  }
  updateStats();
  // hết hiệp?
  const setDone = T.target === 'reps' ? T.repsInSet >= 10 || T.setActiveMs > 150000 : T.setActiveMs >= 60000;
  if (setDone) endSet(now);
}
function handleEvent(e, now) {
  if (e.type === 'phase') {
    const c = T.phaseCount[e.result.id]; if (c) c[e.result.status]++;
    flashPhase(e.result);
  } else if (e.type === 'rep') {
    T.reps.push({ ...e.rep, set: T.set, leg: T.leg }); T.repsInSet++; T.lastRepAt = T.activeMs;
    const msg = T.coach.onRep(e.rep);
    if (msg) {
      setCue(msg.say, msg.kind, 3200);
      voice.say(msg.say, { rate: 1.05 });
    }
    if (settings.leg === 'LR' && T.bai === 4) { // đổi chân luân phiên
      T.leg = T.leg === 'L' ? 'R' : 'L';
      T.ex = makeExercise(4, T.leg);
      const tr = new Tracker(T.ex, { speed: T.speed }); T.tracker = tr;
    }
  }
}
function startCountdown(now) {
  T.state = 'count'; T.countAt = now; T.countShown = null; T.pitchSamples = [];
  setCue('Nhìn thẳng vào màn hình');
}
function beginRun(now) {
  if (T.pitchSamples.length > 3 && T.pitchBase == null) {
    const s = T.pitchSamples.slice().sort((a, b) => a - b); T.pitchBase = s[Math.floor(s.length / 2)];
  }
  T.state = 'run'; showBig(''); T.lastTick = now; T.cadPhase = -1; T.cadCycle = -1;
  if (T.mode === 'tudo') setCue('Các bạn tự làm, máy đang chấm');
  simT0 = performance.now();
}
function pauseTraining(reason) {
  if (!T || T.state !== 'run') return;
  T.state = 'pause'; T.pauseReason = reason; T.seenSince = 0;
  voice.stop();
  if (reason === 'lost') {
    $('#pause-title').textContent = 'Mình không thấy các bạn';
    $('#pause-sub').textContent = 'Quay lại khung nhé — máy tự tiếp tục khi thấy lại';
    voice.say('Mình không thấy các bạn, quay lại khung nhé');
  } else {
    $('#pause-title').textContent = 'Tạm dừng';
    $('#pause-sub').textContent = `Giơ hai tay qua đầu${T.bai === 1 || T.bai === 4 ? ', bắt chéo cổ tay,' : ''} 2 giây để tiếp tục`;
    voice.say('Tạm dừng');
  }
  $('#pause-layer').hidden = false;
}
function resumeTraining() {
  if (!T || T.state !== 'pause') return;
  $('#pause-layer').hidden = true;
  T.tracker.reset(); T.missingSince = 0;
  T.state = 'count'; T.countAt = performance.now(); T.countShown = null;
  voice.say('Tiếp tục nhé');
}
function endSet(now) {
  if (T.set >= T.sets) { finishTraining(); return; }
  T.state = 'rest'; voice.stop();
  let left = +settings.rest;
  $('#rest-layer').hidden = false; $('#rest-n').textContent = left;
  voice.say(`Hết hiệp ${T.set}. Nghỉ ${left} giây, thở đều nhé`);
  clearInterval(T.restTimer);
  T.restTimer = setInterval(() => {
    left--; $('#rest-n').textContent = left;
    if (left === 10) voice.say('Còn 10 giây');
    if (left <= 3 && left > 0) voice.say(String(left));
    if (left <= 0) nextSet();
  }, 1000);
  void now;
}
function nextSet() {
  clearInterval(T.restTimer); $('#rest-layer').hidden = true;
  T.set++; T.repsInSet = 0; T.setActiveMs = 0; T.cadT = 0; T.tracker.reset();
  T.state = 'wait'; T.seenSince = 0; showBig('Hiệp ' + T.set, true); setCue('Về vị trí');
  updateStats();
}
$('#b-skip-rest').onclick = () => T && nextSet();
$('#b-pause').onclick = () => { if (!T) return; if (T.state === 'run') pauseTraining('button'); else if (T.state === 'pause') resumeTraining(); };
$('#b-resume').onclick = () => resumeTraining();
$('#b-end').onclick = () => finishTraining();
$('#b-end2').onclick = () => finishTraining();
$('#b-voice').onclick = () => { voice.enabled = !voice.enabled; settings.voice = voice.enabled; saveSettings(); $('#b-voice').classList.toggle('off', !voice.enabled); toast(voice.enabled ? 'Đã bật giọng' : 'Đã tắt giọng'); };
$('#b-cam').onclick = async () => {
  const cams = await listCameras();
  if (settings.camId && cams.length > 1) { const i = cams.findIndex((c) => c.deviceId === settings.camId); return switchCamera({ deviceId: cams[(i + 1) % cams.length].deviceId }); }
  switchCamera({ facing: settings.cam === 'user' ? 'environment' : 'user' });
};
$('#b-mini').onclick = () => { settings.mini = !settings.mini; saveSettings(); $('#mini').hidden = !settings.mini; $('#b-mini').classList.toggle('off', !settings.mini); };

// mẫu nhỏ trong lúc tập
(function miniLoop() {
  requestAnimationFrame(miniLoop);
  if (S.screen !== 's-train' || !T) return;
  const cv = window.matchMedia('(orientation: landscape) and (min-width: 700px)').matches ? $('#mini-side-canvas') : $('#mini-canvas');
  if (!cv || (cv.id === 'mini-canvas' && !settings.mini)) return;
  sizeCanvas(cv); const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
  const opts = { leg: T.leg, posture: settings.posture, speed: T.speed };
  const t = T.mode === 'nhip' && T.state === 'run' ? T.cadT / 1000 : performance.now() / 1000;
  const { pts, phase } = poseAt(T.ex, T.bai, opts, t);
  drawFigure(ctx, pts, cv.width, cv.height, { yaw: T.bai === 3 ? 60 : 30, highlight: phaseJoints(T.ex.phases[phase]) });
  ctx.fillStyle = '#f2f7ff'; ctx.font = `700 ${Math.round(cv.height / 11)}px system-ui`; ctx.textAlign = 'center';
  ctx.fillText(T.ex.phases[phase].name, cv.width / 2, cv.height - cv.height / 18);
})();

let wakeLock = null;
async function requestWake() { try { wakeLock = await navigator.wakeLock.request('screen'); } catch (e) { /* không hỗ trợ */ } }
function releaseWake() { try { wakeLock && wakeLock.release(); } catch (e) { /* */ } wakeLock = null; }

function endTraining(silent) {
  if (!T) return;
  clearInterval(T.restTimer); T.state = 'done'; voice.stop(); releaseWake();
  $('#pause-layer').hidden = true; $('#rest-layer').hidden = true; showBig('');
  if (!silent) { /* */ }
}
function finishTraining() {
  if (!T) return;
  endTraining(true);
  voice.say('Hoàn thành! Các bạn làm tốt lắm');
  saveHistory();
  show('s-result');
  renderResult();
}

// ---------- 5. KẾT QUẢ ----------
function sessionSummary() {
  const reps = T.reps, good = reps.filter((r) => r.correct).length;
  const pc = Object.values(T.phaseCount);
  const pOk = pc.reduce((s, c) => s + c.ok + c.near, 0), pAll = pc.reduce((s, c) => s + c.ok + c.near + c.bad + c.miss, 0);
  const byPhase = T.ex.scoreBy === 'phase';
  return { reps, good, pOk, pAll, byPhase, correct: byPhase ? pOk : good, total: byPhase ? pAll : reps.length, unit: byPhase ? 'pha' : 'lần' };
}
function saveHistory() {
  const s = sessionSummary(); if (!s.total) return;
  const top = T.coach.topError();
  const h = store.get('history', []);
  h.push({ ts: Date.now(), bai: T.bai, correct: s.correct, total: s.total, unit: s.unit, reps: s.reps.length, ms: Math.round(T.activeMs), speed: T.speed, err: top && top.say });
  store.set('history', h.slice(-200));
}
function renderResult() {
  const s = sessionSummary();
  $('#r-score').textContent = `${s.correct}/${s.total}`;
  $('#r-score-l').textContent = s.byPhase ? `pha đúng · ${s.reps.length} lần (${s.good} lần đủ pha đúng)` : `lần đúng đủ chu kỳ, đúng thứ tự`;
  $('#r-time').textContent = fmt(T.activeMs);
  $('#r-sets').textContent = T.set;
  $('#r-speed').textContent = SPEED_NAME[T.speed];
  $('#r-phases').className = 'phasebar result' + (T.ex.phases.length > 6 ? ' dense' : '');
  $('#r-phases').innerHTML = T.ex.phases.map((p) => {
    const c = T.phaseCount[p.id], all = c.ok + c.near + c.bad + c.miss, ok = c.ok + c.near;
    const st = !all ? '' : ok / all >= 0.8 ? 'f-ok' : ok / all >= 0.5 ? 'f-near' : 'f-bad';
    return `<div class="ph ${st}">${T.ex.phases.length > 6 ? p.short : p.name}<small>${ok}/${all}</small></div>`;
  }).join('');
  const top = T.coach.topError();
  $('#r-err').innerHTML = top ? `<b>Lỗi hay gặp nhất</b> (${top.count} lần)<br>${top.say}` : (s.total ? '<b>Không có lỗi lặp lại.</b> Rất tốt!' : 'Chưa ghi nhận lần nào — kiểm tra lại khung hình và tư thế nhé.');
  const rate = s.total ? s.correct / s.total : 0;
  const nextSpeed = { cham: 'Vừa', vua: 'Chuẩn', chuan: null }[T.speed];
  let tip;
  if (!s.total) tip = 'Buổi sau: đặt máy theo hướng dẫn ở màn Chuẩn bị, chờ viền xanh rồi mới bắt đầu.';
  else if (rate >= 0.8) tip = nextSpeed ? `Buổi sau: tăng tốc độ lên <b>${nextSpeed}</b>.` : (T.bai < 4 ? `Buổi sau: chuyển sang <b>bài ${T.bai + 1}</b>.` : 'Buổi sau: giữ tốc độ Chuẩn, tập 3 hiệp.');
  else if (rate >= 0.5) tip = `Buổi sau: giữ tốc độ ${SPEED_NAME[T.speed]}, tập 3 hiệp${top ? ', chú ý: ' + top.say.toLowerCase() : ''}.`;
  else tip = T.speed !== 'cham' ? 'Buổi sau: giảm về tốc độ <b>Chậm</b>, làm từng động tác thật rõ.' : (T.bai === 4 ? 'Buổi sau: tập riêng bài 1–3 trước rồi mới phối hợp.' : 'Buổi sau: xem mẫu kỹ hơn và tập Chậm, chế độ Theo nhịp.');
  $('#r-next').innerHTML = tip;
  renderHistory();
  drawReplayFrame(0);
}
function renderHistory() {
  const h = store.get('history', []).slice(-12).reverse();
  $('#r-history').innerHTML = h.length ? `<table>${h.map((x) => `<tr><td>${new Date(x.ts).toLocaleDateString('vi-VN')}</td><td>Bài ${x.bai}</td><td>${x.correct}/${x.total} ${x.unit || ''}</td><td>${SPEED_NAME[x.speed] || ''}</td></tr>`).join('')}</table>` : '<p class="muted">Chưa có.</p>';
}
let replayRaf = 0;
function drawReplayFrame(i) {
  const cv = $('#replay-canvas'); sizeCanvas(cv); const ctx = cv.getContext('2d');
  ctx.clearRect(0, 0, cv.width, cv.height);
  const fr = T && T.frames[i]; if (!fr) { ctx.fillStyle = '#9db2cf'; ctx.font = '16px system-ui'; ctx.fillText('Không có dữ liệu', 16, 30); return; }
  const s = Math.min(cv.width / 3, cv.height / 4) * 0.98, ox = (cv.width - 3 * s) / 2, oy = (cv.height - 4 * s) / 2;
  // vừa khung theo người
  const xs = fr.p.map((p) => p[0]), ys = fr.p.map((p) => p[1]);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const sc = Math.min(cv.width * 0.9 / ((maxx - minx) || 1), cv.height * 0.9 / ((maxy - miny) || 1));
  const cx = (minx + maxx) / 2, cy = (miny + maxy) / 2;
  const M = (p) => ({ x: cv.width / 2 + (S.mirror ? -1 : 1) * (p[0] - cx) * sc, y: cv.height / 2 + (p[1] - cy) * sc });
  void s; void ox; void oy;
  const d = Math.min(2, devicePixelRatio || 1);
  for (const [a, b] of REGION_BONES[T.bai]) {
    if (!fr.p[a][2] || !fr.p[b][2]) continue;
    const st = worst(fr.c[a], fr.c[b]);
    ctx.strokeStyle = st ? COL[st] : COL.none; ctx.lineWidth = 5 * d; ctx.lineCap = 'round';
    const A = M(fr.p[a]), B = M(fr.p[b]); ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  }
  const ear = M([(fr.p[7][0] + fr.p[8][0]) / 2, (fr.p[7][1] + fr.p[8][1]) / 2]), no = M(fr.p[0]);
  ctx.strokeStyle = fr.c[0] ? COL[fr.c[0]] : COL.none; ctx.beginPath(); ctx.moveTo(ear.x, ear.y); ctx.lineTo(no.x, no.y); ctx.stroke();
  ctx.fillStyle = '#f2f7ff'; ctx.font = `600 ${14 * d}px system-ui`; ctx.textAlign = 'left';
  ctx.fillText(`${fmt(fr.t)}  ${fr.ph >= 0 ? T.ex.phases[fr.ph].name : ''}`, 10 * d, 22 * d);
}
$('#b-replay').onclick = () => {
  if (!T || !T.frames.length) return;
  cancelAnimationFrame(replayRaf);
  const t0 = performance.now(), f0 = T.frames[0].t;
  const step = () => {
    const t = (performance.now() - t0) * 1.5 + f0;
    let i = T.frames.findIndex((f) => f.t >= t); if (i < 0) { drawReplayFrame(T.frames.length - 1); return; }
    drawReplayFrame(i); replayRaf = requestAnimationFrame(step);
  };
  step();
};
$('#b-again').onclick = () => show('s-prep');
$('#b-nextex').onclick = () => { S.bai = S.bai % 4 + 1; show('s-prep'); };
$('#b-home').onclick = () => show('s-chon');

// ---------- CÀI ĐẶT ----------
function renderSettings() {
  $('#set-voice').checked = settings.voice;
  const vs = voice.list();
  $('#set-voice-name').innerHTML = vs.length ? vs.map((v) => `<option ${v.name === voice.voiceName ? 'selected' : ''}>${v.name}</option>`).join('') : '<option>(máy chưa có giọng tiếng Việt)</option>';
  $('#voice-note').textContent = !voice.supported ? 'Trình duyệt không hỗ trợ đọc giọng.' : vs.length ? '' : 'Máy chưa cài giọng tiếng Việt: vào Cài đặt hệ thống › Ngôn ngữ/Trợ năng › Đọc văn bản để tải giọng Việt.';
  $('#set-target').value = settings.target; $('#set-sets').value = settings.sets; $('#set-rest').value = settings.rest;
  $('#set-ghost').checked = settings.ghost; $('#set-height').value = String(settings.height); $('#set-model').value = settings.model;
  $('#thr-status').innerHTML = '<b>Ngưỡng chấm</b><br>' + [1, 2, 3, 4].map((b) => {
    const ex = makeExercise(b, 'R');
    return `Bài ${b}: ${ex.thresholdSource === 'mau' ? `<b class="mau">theo mẫu HLV</b> (${ex.templateInfo})` : '<b class="tam">ngưỡng tạm</b> (theo mô tả, chưa có mẫu HLV)'}`;
  }).join('<br>');
}
$('#set-voice').onchange = (e) => { settings.voice = voice.enabled = e.target.checked; saveSettings(); };
$('#set-voice-name').onchange = (e) => { settings.voiceName = e.target.value; voice.prefer(e.target.value); saveSettings(); voice.unlock(); voice.say('Xin chào các bạn'); };
$('#set-target').onchange = (e) => { settings.target = e.target.value; saveSettings(); };
$('#set-sets').onchange = (e) => { settings.sets = +e.target.value; saveSettings(); };
$('#set-rest').onchange = (e) => { settings.rest = +e.target.value; saveSettings(); };
$('#set-ghost').onchange = (e) => { settings.ghost = e.target.checked; saveSettings(); };
$('#set-height').onchange = (e) => { settings.height = +e.target.value; saveSettings(); };
$('#set-model').onchange = (e) => { settings.model = e.target.value; saveSettings(); S.poseReady = false; toast('Áp dụng khi mở camera lần sau'); };
$('#b-clear-history').onclick = () => { if (confirm('Xóa toàn bộ lịch sử tập trên máy này?')) { store.set('history', []); toast('Đã xóa'); } };

// ---------- GHI MẪU HLV ----------
function recOpts() {
  const v = $('#rec-var').value;
  return { bai: +$('#rec-bai').value, goc: $('#rec-goc').value, leg: v === 'L' ? 'L' : 'R', posture: v === 'khom' ? 'khom' : 'tren', n: +$('#rec-n').value };
}
function renderRecord() {
  const o = recOpts();
  const ex = buildExercise(o.bai, { leg: o.leg });
  $('#rec-err-phase').innerHTML = ex.phases.map((p) => `<option value="${p.id}">${p.name}</option>`).join('');
  $('#guide').innerHTML = guideSvg(o.bai, false);
  renderTplList();
}
['#rec-bai', '#rec-var'].forEach((s) => ($(s).onchange = () => { R = null; $('#rec-export').disabled = $('#rec-use').disabled = true; $('#rec-result').innerHTML = ''; renderRecord(); }));
function renderTplList() {
  const loc = localTemplates();
  $('#tpl-list').innerHTML = (repoTemplates.length ? `<div class="hint">Mẫu trong kho: ${repoTemplates.map((t) => `bài ${t.bai} (${t.goc})`).join(', ')}</div>` : '') +
    loc.map((t, i) => `<div class="tpl"><span>Bài ${t.bai} · ${t.goc} · ${t.ngay} · ${Object.keys(t.phases || {}).length} pha · ${(t.errors || []).length} lỗi mẫu</span><button class="chip" data-del="${i}">Xóa</button></div>`).join('');
  $$('[data-del]').forEach((b) => (b.onclick = () => { const l = localTemplates(); l.splice(+b.dataset.del, 1); store.set('templates', l); renderTplList(); }));
}
function setRecMsg(t, cls) { const m = $('#rec-msg'); m.textContent = t; m.className = 'ready-msg ' + (cls || ''); }
$('#rec-start').onclick = () => {
  voice.unlock();
  const o = recOpts();
  const ex = buildExercise(o.bai, { leg: o.leg });
  R = { ...o, ex, kind: 'ok', state: 'wait', samples: {}, frames: [], cad: 0, last: 0, pitch: [], pitchBase: null, errors: (R && R.bai === o.bai && R.errors) || [] };
  ex.phases.forEach((p) => (R.samples[p.id] = []));
  setRecMsg('Đứng vào khung…', 'warn');
};
$('#rec-err-start').onclick = () => {
  voice.unlock();
  const o = recOpts();
  const ex = buildExercise(o.bai, { leg: o.leg });
  const cau = $('#rec-err-text').value.trim();
  if (!cau) { toast('Gõ câu sửa trước đã'); return; }
  const prev = R && R.bai === o.bai ? R : null;
  R = { ...o, ex, kind: 'err', errPhase: $('#rec-err-phase').value, cau, state: 'wait', errSamples: [], cad: 0, last: 0,
    pitch: [], pitchBase: prev ? prev.pitchBase : null, samples: prev ? prev.samples : null, frames: prev ? prev.frames : [], errors: prev ? prev.errors : [], tpl: prev && prev.tpl };
  setRecMsg('Đứng vào khung…', 'warn');
};
function recordTick(now) {
  if (!R) { const f = S.frame; setRecMsg(f.ok ? 'Đã thấy đủ — bấm Ghi' : f.hint, f.ok ? 'ok' : 'warn'); return; }
  const f = S.frame;
  const dt = R.last ? Math.min(200, now - R.last) : 0; R.last = now;
  if (R.state === 'wait') {
    if (f.ok) { R.okSince = R.okSince || now; if (now - R.okSince > 800) { R.state = 'count'; R.countAt = now; R.shown = null; } } else { R.okSince = 0; setRecMsg(f.hint, 'warn'); }
    return;
  }
  if (R.state === 'count') {
    if (S.world) R.pitch.push(computeFeatures(S.world, { leg: R.leg }).pitch);
    const left = 3 - Math.floor((now - R.countAt) / 1000);
    if (left !== R.shown) { R.shown = left; setRecMsg(left > 0 ? String(left) : 'Ghi!', 'ok'); voice.say(left > 0 ? String(left) : (R.kind === 'err' ? 'Làm sai cố ý: ' + R.ex.phases.find((p) => p.id === R.errPhase).name + ', giữ yên' : 'Bắt đầu')); }
    if (now - R.countAt > 3500) {
      if (R.pitchBase == null && R.pitch.length) { const s = R.pitch.slice().sort((a, b) => a - b); R.pitchBase = s[Math.floor(s.length / 2)]; }
      R.state = 'run'; R.cad = 0; R.cp = -1;
    }
    return;
  }
  if (R.state !== 'run') return;
  if (!S.world || !f.ok) return;
  R.cad += dt;
  const F = computeFeatures(S.world, { leg: R.leg, pitchBase: R.pitchBase });
  if (R.kind === 'err') {
    if (R.cad > 1000) R.errSamples.push(F);
    setRecMsg(`Đang ghi lỗi mẫu… ${Math.ceil((6000 - R.cad) / 1000)}`, 'ok');
    if (R.cad >= 6000) finishErrRecord();
    return;
  }
  const cyc = cycleDur(R.ex, 'cham') * 1000;
  const n = Math.floor(R.cad / cyc), inC = R.cad % cyc;
  if (n >= R.n) { finishRecord(); return; }
  let acc = 0, cp = 0, local = 0;
  for (let i = 0; i < R.ex.phases.length; i++) { const d = phaseDur(R.ex, i, 'cham') * 1000; if (inC < acc + d) { cp = i; local = (inC - acc) / d; break; } acc += d; }
  if (cp !== R.cp) { R.cp = cp; const p = R.ex.phases[cp]; voice.say(p.say || p.name, { rate: 1 }); }
  setRecMsg(`Lần ${n + 1}/${R.n} · ${R.ex.phases[cp].name}`, 'ok');
  const id = R.ex.phases[cp].id;
  if (local > 0.5 && local < 0.97) R.samples[id].push(F);
  if (!R.frames.length || R.cad - R.frames[R.frames.length - 1][1] > 100) {
    // chuỗi tọa độ khớp chuẩn hóa theo độ rộng vai (gốc = giữa vai)
    const w = S.world, sx = (w[11].x + w[12].x) / 2, sy = (w[11].y + w[12].y) / 2, sz = (w[11].z + w[12].z) / 2;
    const sw = Math.hypot(w[11].x - w[12].x, w[11].y - w[12].y, w[11].z - w[12].z) || 0.3;
    R.frames.push([id, Math.round(R.cad), ...w.flatMap((p) => [+((p.x - sx) / sw).toFixed(3), +((p.y - sy) / sw).toFixed(3), +((p.z - sz) / sw).toFixed(3)])]);
  }
}
function buildTemplate() {
  const phases = {};
  for (const p of R.ex.phases) phases[p.id] = statsOf(R.samples[p.id] || [], phaseFeatureList(p));
  return {
    loai: 'mau-hlv-boi-ech', phienBan: 1, bai: R.bai, goc: R.goc, chan: R.leg, tuThe: R.posture, ngay: new Date().toISOString().slice(0, 10),
    soLan: R.n, tocDo: 'cham', goc0DauTrungTinh: R.pitchBase != null ? +R.pitchBase.toFixed(2) : null,
    phases, errors: R.errors || [],
    frames: { moTa: 'mỗi dòng: [pha, ms, x0,y0,z0, … x32,y32,z32] — tọa độ world MediaPipe, gốc giữa vai, chia độ rộng vai', data: R.frames },
  };
}
function finishRecord() {
  R.state = 'done'; voice.say('Xong. Cảm ơn thầy cô');
  R.tpl = buildTemplate();
  showTplTable(R.tpl);
  $('#rec-export').disabled = $('#rec-use').disabled = false;
  setRecMsg('Đã ghi xong mẫu đúng', 'ok');
}
function finishErrRecord() {
  R.state = 'done'; voice.say('Đã ghi lỗi mẫu');
  const phase = R.ex.phases.find((p) => p.id === R.errPhase);
  const e = { phase: R.errPhase, code: 'CUSTOM', cau: R.cau, feats: statsOf(R.errSamples, phaseFeatureList(phase)) };
  R.errors = (R.errors || []).concat([e]);
  if (R.tpl) R.tpl.errors = R.errors; else { R.samples = R.samples || {}; R.tpl = null; }
  if (!R.samples || !Object.keys(R.samples).length) { R.samples = {}; R.ex.phases.forEach((p) => (R.samples[p.id] = [])); }
  R.tpl = buildTemplate();
  showTplTable(R.tpl);
  $('#rec-export').disabled = $('#rec-use').disabled = false;
  setRecMsg(`Đã ghi lỗi mẫu cho pha ${phase.name} (${R.errors.length} lỗi mẫu)`, 'ok');
}
function showTplTable(t) {
  const rows = [];
  for (const [pid, feats] of Object.entries(t.phases)) for (const [f, s] of Object.entries(feats)) rows.push(`<tr><td>${pid}</td><td>${FEATURE_NAMES[f] || f}</td><td>${s.mean} ± ${s.sd}</td><td>${s.n}</td></tr>`);
  $('#rec-result').innerHTML = `<table><tr><td><b>Pha</b></td><td><b>Đặc trưng</b></td><td><b>TB ± lệch</b></td><td><b>mẫu</b></td></tr>${rows.join('')}</table>` +
    (t.errors.length ? `<p>Lỗi mẫu: ${t.errors.map((e) => `${e.phase}: “${e.cau}”`).join('; ')}</p>` : '');
}
$('#rec-export').onclick = () => {
  if (!R || !R.tpl) return;
  const blob = new Blob([JSON.stringify(R.tpl)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  a.download = `mau-bai${R.tpl.bai}-${R.tpl.goc}-${R.tpl.ngay}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};
$('#rec-use').onclick = () => {
  if (!R || !R.tpl) return;
  const t = { ...R.tpl, frames: undefined };
  const l = localTemplates(); l.push(t); store.set('templates', l); renderTplList(); toast('Đã dùng mẫu này trên máy');
};
$('#rec-import').onchange = async (e) => {
  const l = localTemplates(); let n = 0;
  for (const f of e.target.files) {
    try { const j = JSON.parse(await f.text()); if (j.loai === 'mau-hlv-boi-ech' && j.bai) { delete j.frames; l.push(j); n++; } } catch (err) { /* bỏ qua file lỗi */ }
  }
  store.set('templates', l); renderTplList(); toast(n ? `Đã nhập ${n} mẫu` : 'File không đúng định dạng mẫu');
  e.target.value = '';
};

// ---------- khởi động ----------
document.addEventListener('visibilitychange', () => { if (document.hidden && T && T.state === 'run') pauseTraining('button'); });
window.addEventListener('resize', () => S.screen === 's-prep' && renderPlace());
loadRepoTemplates().finally(() => show('s-chon'));
if (SIM) document.title += ' (mô phỏng)';
window.__app = { S, get T() { return T; }, settings, minDistance };
