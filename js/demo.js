// Mẫu khung xương động (thay video HLV khi chưa có) + sinh dữ liệu mô phỏng cho kiểm thử.
// Hệ tọa độ thân: X = bên trái người tập, Y = lên, Z = phía trước mặt. 1 đơn vị = bề rộng vai.
import { phaseDur } from './engine.js';

const v = (x, y, z) => [x, y, z];
// Tay TRÁI (X dương); tay phải lấy đối xứng
const ARM = {
  DOWN: { e: v(0.58, 0.8, 0), w: v(0.62, 0.08, 0.05) },
  DUOI: { e: v(0.3, 2.2, 0.08), w: v(0.1, 2.92, 0.12) },
  V: { e: v(0.95, 2.1, 0.08), w: v(1.35, 2.68, 0.12) },
  U: { e: v(1.2, 1.7, 0.2), w: v(0.85, 1.9, 0.7) },
  THU: { e: v(0.4, 1.25, 0.6), w: v(0.07, 1.8, 0.45) },
  // lỗi mẫu cho kiểm thử
  V_HEP: { e: v(0.62, 2.2, 0.08), w: v(0.6, 2.9, 0.12) },
};
// Chân TRÁI là chân tập (X dương) — chân phải lấy đối xứng
const LEG = {
  STAND: { k: v(0.27, -1.1, 0.02), a: v(0.25, -2.15, 0), h: v(0.25, -2.22, -0.08), t: v(0.25, -2.25, 0.3) },
  KHEP: { k: v(0.2, -1.08, 0.02), a: v(0.13, -2.1, 0), h: v(0.13, -2.15, -0.07), t: v(0.13, -2.42, 0.08) },
  CO: { k: v(0.32, -1.0, 0.25), a: v(0.34, -0.55, -0.7), h: v(0.34, -0.47, -0.76), t: v(0.36, -0.25, -0.95) },
  BE: { k: v(0.36, -1.0, 0.25), a: v(0.62, -0.6, -0.68), h: v(0.6, -0.68, -0.72), t: v(0.9, -0.63, -0.62) },
  DAP: { k: v(0.6, -0.98, -0.15), a: v(1.1, -1.88, -0.45), h: v(1.08, -1.96, -0.5), t: v(1.38, -1.93, -0.4) },
  // lỗi mẫu: không bẻ cổ chân (mũi chân duỗi)
  DAP_SAI: { k: v(0.6, -0.98, -0.15), a: v(1.1, -1.88, -0.45), h: v(1.1, -1.8, -0.5), t: v(1.15, -2.15, -0.6) },
  BE_SAI: { k: v(0.34, -1.0, 0.25), a: v(0.4, -0.58, -0.7), h: v(0.4, -0.5, -0.76), t: v(0.42, -0.28, -0.95) },
};
const HEAD = { NEUTRAL: 0, DOWN: -35, UP: 8 };

const mx = (p) => [-p[0], p[1], p[2]];
const lerp = (a, b, k) => a + (b - a) * k;
const lerp3 = (a, b, k) => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
const ease = (k) => k * k * (3 - 2 * k);

/** Khung tư thế: {arm, armR?, leg (chân tập), head, torso} */
function kf(arm, leg, head, torso = 0) { return { arm, leg, head, torso }; }

/** Tư thế khóa của từng pha theo bài. opts: {leg:'L'|'R', posture:'tren'|'khom'} */
export function keyframes(bai, opts = {}) {
  const torso = bai === 1 && opts.posture === 'khom' ? 60 : 0;
  if (bai === 1) return {
    rest: kf('DUOI', 'STAND', 0, torso),
    phases: [kf('V', 'STAND', 0, torso), kf('U', 'STAND', 0, torso), kf('THU', 'STAND', 0, torso), kf('DUOI', 'STAND', 0, torso)],
  };
  if (bai === 2) return {
    rest: kf('DOWN', 'KHEP', 0),
    phases: [kf('DOWN', 'CO', 0), kf('DOWN', 'BE', 0), kf('DOWN', 'DAP', 0), kf('DOWN', 'KHEP', 0)],
  };
  if (bai === 3) return {
    rest: kf('DOWN', 'STAND', HEAD.NEUTRAL),
    phases: [kf('DOWN', 'STAND', HEAD.DOWN), kf('DOWN', 'STAND', HEAD.DOWN), kf('DOWN', 'STAND', HEAD.UP), kf('DOWN', 'STAND', HEAD.DOWN)],
  };
  return {
    rest: kf('DUOI', 'KHEP', HEAD.DOWN),
    phases: [
      kf('DUOI', 'KHEP', HEAD.DOWN), kf('DUOI', 'KHEP', HEAD.DOWN),
      kf('V', 'KHEP', HEAD.UP), kf('U', 'KHEP', HEAD.UP), kf('THU', 'KHEP', HEAD.UP),
      kf('DUOI', 'KHEP', HEAD.DOWN),
      kf('DUOI', 'CO', HEAD.DOWN), kf('DUOI', 'BE', HEAD.DOWN), kf('DUOI', 'DAP', HEAD.DOWN), kf('DUOI', 'KHEP', HEAD.DOWN),
    ],
  };
}

function resolve(k) {
  return {
    aL: ARM[k.arm], aR: ARM[k.armR || k.arm], lW: LEG[k.leg], head: k.head, torso: k.torso || 0,
  };
}
function mixPose(A, B, t) {
  const m = (a, b) => (a && b ? Object.fromEntries(Object.keys(a).map((key) => [key, lerp3(a[key], b[key], t)])) : a);
  return { aL: m(A.aL, B.aL), aR: m(A.aR, B.aR), lW: m(A.lW, B.lW), head: lerp(A.head, B.head, t), torso: lerp(A.torso, B.torso, t) };
}

const rotX = (p, deg, pivot = [0, 0, 0]) => { // xoay quanh trục X: dương = mũi/ngực ngẩng lên
  const r = (deg * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const y = p[1] - pivot[1], z = p[2] - pivot[2];
  return [p[0], pivot[1] + y * c + z * s, pivot[2] - y * s + z * c];
};

/** Dựng 33 điểm (tọa độ thân) từ tư thế đã trộn. legSide: chân tập 'L' | 'R' */
function build33(P, legSide) {
  const pts = new Array(33);
  const bend = (p) => rotX(p, -P.torso); // cúi người về trước quanh hông
  const neck = [0, 1.6, 0];
  const hc = rotX([0, 1.98, 0.02], P.head, neck);
  const hp = (o) => bend(rotX([o[0], 1.98 + o[1], 0.02 + o[2]], P.head, neck));
  pts[0] = hp([0, -0.04, 0.2]);
  pts[1] = hp([0.05, 0.04, 0.17]); pts[2] = hp([0.07, 0.04, 0.17]); pts[3] = hp([0.1, 0.04, 0.15]);
  pts[4] = hp([-0.05, 0.04, 0.17]); pts[5] = hp([-0.07, 0.04, 0.17]); pts[6] = hp([-0.1, 0.04, 0.15]);
  pts[7] = hp([0.16, 0, -0.02]); pts[8] = hp([-0.16, 0, -0.02]);
  pts[9] = hp([0.04, -0.12, 0.16]); pts[10] = hp([-0.04, -0.12, 0.16]);
  void hc;
  pts[11] = bend([0.5, 1.5, 0]); pts[12] = bend([-0.5, 1.5, 0]);
  pts[13] = bend(P.aL.e); pts[15] = bend(P.aL.w);
  pts[14] = bend(mx(P.aR.e)); pts[16] = bend(mx(P.aR.w));
  const hand = (w, e, side) => {
    const d = [w[0] - e[0], w[1] - e[1], w[2] - e[2]];
    const l = Math.hypot(...d) || 1, u = d.map((x) => (x / l) * 0.17);
    return [[w[0] + u[0] + 0.04 * side, w[1] + u[1], w[2] + u[2]], [w[0] + u[0] * 1.1, w[1] + u[1] * 1.1, w[2] + u[2] * 1.1], [w[0] + u[0] * 0.6 - 0.04 * side, w[1] + u[1] * 0.6, w[2] + u[2] * 0.6]];
  };
  const [lp, li, lt] = hand(pts[15], pts[13], 1); const [rp, ri, rt] = hand(pts[16], pts[14], -1);
  pts[17] = lp; pts[19] = li; pts[21] = lt; pts[18] = rp; pts[20] = ri; pts[22] = rt;
  pts[23] = [0.3, 0, 0]; pts[24] = [-0.3, 0, 0];
  const work = P.lW, stand = LEG.STAND;
  const L = legSide === 'L' ? work : stand, R = legSide === 'L' ? stand : work;
  pts[25] = L.k; pts[27] = L.a; pts[29] = L.h; pts[31] = L.t;
  pts[26] = mx(R.k); pts[28] = mx(R.a); pts[30] = mx(R.h); pts[32] = mx(R.t);
  return pts;
}

/** Lịch thời gian của 1 chu kỳ theo tốc độ: [{i, start, dur}] (giây) */
export function timeline(ex, speed) {
  let s = 0;
  return ex.phases.map((_, i) => { const d = phaseDur(ex, i, speed); const o = { i, start: s, dur: d }; s += d; return o; });
}

/** Tư thế tại thời điểm t (giây) trong chu kỳ lặp. Trả {pts, phase} */
export function poseAt(ex, bai, opts, t, overrides = {}) {
  const K = keyframes(bai, opts);
  const tl = timeline(ex, opts.speed || 'cham');
  const total = tl[tl.length - 1].start + tl[tl.length - 1].dur;
  const tt = ((t % total) + total) % total;
  let k = tl.findIndex((x) => tt >= x.start && tt < x.start + x.dur);
  if (k < 0) k = tl.length - 1;
  const pk = k === 0 ? K.phases.length - 1 : k - 1;
  const prevKey = { ...K.phases[pk], ...(overrides[ex.phases[pk].id] || {}) };
  const curKey = { ...K.phases[k], ...(overrides[ex.phases[k].id] || {}) };
  const local = (tt - tl[k].start) / tl[k].dur;
  const moveFrac = 0.55;
  const m = local < moveFrac ? ease(local / moveFrac) : 1;
  const P = mixPose(resolve(prevKey), resolve(curKey), m);
  return { pts: build33(P, opts.leg === 'L' ? 'L' : 'R'), phase: k, local };
}

export function restPose(bai, opts) {
  const K = keyframes(bai, opts);
  const P = resolve({ ...K.rest, head: 0 });
  return build33(P, opts.leg === 'L' ? 'L' : 'R');
}

/** Chiếu sang định dạng MediaPipe. yaw: góc quay người (0 = đối diện camera, 90 = nghiêng) */
export function toMediaPipe(pts, yaw = 0, scale = 0.15) {
  const r = (yaw * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  const world = [], image = [];
  for (const p of pts) {
    const X = p[0] * c + p[2] * s, Z = -p[0] * s + p[2] * c, Y = p[1];
    world.push({ x: X * 0.34, y: -Y * 0.34, z: -Z * 0.34 });
    image.push({ x: 0.5 + X * scale, y: 0.5 - (Y - 0.3) * scale, z: -Z * scale, visibility: 0.99 });
  }
  return { world, image };
}

// ---------- vẽ khung xương mẫu (2D, chiếu theo góc nhìn) ----------
export const BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 29], [29, 31], [27, 31], [24, 26], [26, 28], [28, 30], [30, 32], [28, 32],
];
export function drawFigure(ctx, pts, W, H, o = {}) {
  const yaw = o.yaw ?? 30, mirror = o.mirror ?? true;
  const r = (yaw * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r);
  // hiển thị kiểu soi gương: bên trái người tập ở bên trái màn hình
  const scale = Math.min(W / 4.2, H / 6.2);
  const P = pts.map((p) => {
    const X = p[0] * c + p[2] * s, Z = -p[0] * s + p[2] * c;
    return { x: W / 2 + (mirror ? -X : X) * scale, y: H * 0.42 - (p[1] - 0.2) * scale, z: Z };
  });
  ctx.lineCap = 'round';
  const col = o.color || '#7fd8ff', lw = Math.max(3, scale * 0.11);
  const hl = new Set(o.highlight || []);
  const order = BONES.slice().sort((a, b) => (P[a[0]].z + P[a[1]].z) - (P[b[0]].z + P[b[1]].z));
  for (const [a, b] of order) {
    ctx.strokeStyle = hl.has(a) || hl.has(b) ? (o.hlColor || '#ffd166') : col;
    ctx.globalAlpha = o.alpha ?? 1;
    ctx.lineWidth = lw;
    ctx.beginPath(); ctx.moveTo(P[a].x, P[a].y); ctx.lineTo(P[b].x, P[b].y); ctx.stroke();
  }
  // cổ + đầu
  const sh = { x: (P[11].x + P[12].x) / 2, y: (P[11].y + P[12].y) / 2 };
  const ear = { x: (P[7].x + P[8].x) / 2, y: (P[7].y + P[8].y) / 2 };
  ctx.strokeStyle = hl.has(0) ? (o.hlColor || '#ffd166') : col;
  ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(ear.x, ear.y); ctx.stroke();
  const hr = scale * 0.27;
  ctx.lineWidth = lw * 0.8;
  ctx.beginPath(); ctx.arc(ear.x, ear.y, hr, 0, Math.PI * 2); ctx.stroke();
  // mũi chỉ hướng mặt
  const dx = P[0].x - ear.x, dy = P[0].y - ear.y, dl = Math.hypot(dx, dy) || 1;
  ctx.fillStyle = ctx.strokeStyle;
  ctx.beginPath(); ctx.arc(ear.x + (dx / dl) * hr * 0.75, ear.y + (dy / dl) * hr * 0.75, lw * 0.6, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  return P;
}
