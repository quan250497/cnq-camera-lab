// Lõi chấm động tác bơi ếch trên cạn — hàm thuần, không đụng DOM (chạy được trong Node để kiểm thử).
// Tọa độ đầu vào: 33 điểm "world" của MediaPipe Pose (mét, gốc ở giữa hông).

export const LM = {
  NOSE: 0, LEYE: 2, REYE: 5, LEAR: 7, REAR: 8, LMOUTH: 9, RMOUTH: 10,
  LSH: 11, RSH: 12, LEL: 13, REL: 14, LWR: 15, RWR: 16,
  LHIP: 23, RHIP: 24, LKNEE: 25, RKNEE: 26, LANK: 27, RANK: 28,
  LHEEL: 29, RHEEL: 30, LFOOT: 31, RFOOT: 32,
};

// ---------- vector ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const nrm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const mid = (a, b) => mul(add(a, b), 0.5);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const DEG = 180 / Math.PI;
const angAt = (a, b, c) => { // góc tại b (độ)
  const u = sub(a, b), v = sub(c, b);
  return Math.acos(clamp(dot(u, v) / ((len(u) * len(v)) || 1), -1, 1)) * DEG;
};

// MediaPipe world: x phải ảnh, y xuống, z ra xa camera -> đổi sang y lên, z về phía camera
const P = (w, i) => [w[i].x, -w[i].y, -w[i].z];

/** Tính đặc trưng từ một khung world landmarks.
 *  opts.leg: 'L' | 'R' (chân tập), opts.pitchBase: góc đầu trung tính (độ) */
export function computeFeatures(world, opts = {}) {
  const leg = opts.leg === 'L' ? 'L' : 'R';
  const g = (i) => P(world, i);
  const LSH = g(LM.LSH), RSH = g(LM.RSH), LHIP = g(LM.LHIP), RHIP = g(LM.RHIP);
  const shMid = mid(LSH, RSH), hipMid = mid(LHIP, RHIP);
  const sw = len(sub(LSH, RSH)) || 0.3;
  const up = nrm(sub(shMid, hipMid));
  const latRaw = sub(LHIP, RHIP); // hướng sang trái người tập
  const lat = nrm(sub(latRaw, mul(up, dot(latRaw, up))));
  let fwd = nrm(cross(up, lat));
  const nose = g(LM.NOSE);
  if (dot(sub(nose, shMid), fwd) < 0) fwd = mul(fwd, -1);

  const LEL = g(LM.LEL), REL = g(LM.REL), LWR = g(LM.LWR), RWR = g(LM.RWR);
  const elbowL = angAt(LSH, LEL, LWR), elbowR = angAt(RSH, REL, RWR);
  const reachL = dot(sub(LWR, LSH), up) / sw, reachR = dot(sub(RWR, RSH), up) / sw;
  const spread = len(sub(LWR, RWR)) / sw;
  const chin = mid(g(LM.LMOUTH), g(LM.RMOUTH));
  const wristChin = (len(sub(LWR, chin)) + len(sub(RWR, chin))) / 2 / sw;
  const elbowSpread = len(sub(LEL, REL)) / sw;

  const W = leg === 'L'
    ? { hip: LHIP, knee: g(LM.LKNEE), ank: g(LM.LANK), heel: g(LM.LHEEL), foot: g(LM.LFOOT), out: lat }
    : { hip: RHIP, knee: g(LM.RKNEE), ank: g(LM.RANK), heel: g(LM.RHEEL), foot: g(LM.RFOOT), out: mul(lat, -1) };
  const O = leg === 'L'
    ? { hip: RHIP, knee: g(LM.RKNEE), ank: g(LM.RANK) }
    : { hip: LHIP, knee: g(LM.LKNEE), ank: g(LM.LANK) };
  const kneeW = angAt(W.hip, W.knee, W.ank), kneeO = angAt(O.hip, O.knee, O.ank);
  const thigh = sub(W.knee, W.hip);
  const thighFwdW = Math.atan2(dot(thigh, fwd), -dot(thigh, up)) * DEG;
  const ankleGap = len(sub(W.ank, O.ank)) / sw;
  const footOutW = dot(sub(W.ank, W.knee), W.out) / sw;
  const toeOutW = dot(nrm(sub(W.foot, W.heel)), W.out);
  const ankleFlexW = angAt(W.knee, W.ank, W.foot);

  const earMid = mid(g(LM.LEAR), g(LM.REAR));
  const pitch = Math.asin(clamp(dot(nrm(sub(nose, earMid)), up), -1, 1)) * DEG;
  const base = Number.isFinite(opts.pitchBase) ? opts.pitchBase : -12;

  return {
    sw, elbowL, elbowR, elbowMin: Math.min(elbowL, elbowR), elbowAvg: (elbowL + elbowR) / 2,
    reachL, reachR, reachAvg: (reachL + reachR) / 2, reachMin: Math.min(reachL, reachR),
    spread, wristChin, elbowSpread,
    kneeW, kneeO, thighFwdW, ankleGap, footOutW, toeOutW, ankleFlexW,
    pitch, pitchRel: pitch - base,
    torsoTilt: Math.acos(clamp(Math.abs(up[1]), 0, 1)) * DEG,
  };
}

export const FEATURE_NAMES = {
  elbowMin: 'Góc khuỷu nhỏ nhất (°)', elbowAvg: 'Góc khuỷu TB (°)', spread: 'Khoảng cách 2 cổ tay (× vai)',
  reachAvg: 'Tay vươn theo trục thân (× vai)', reachMin: 'Tay vươn thấp nhất (× vai)', wristChin: 'Cổ tay tới cằm (× vai)',
  kneeW: 'Góc gối chân tập (°)', kneeO: 'Góc gối chân trụ (°)', thighFwdW: 'Đùi đưa ra trước (°)',
  ankleGap: 'Khoảng cách 2 cổ chân (× vai)', footOutW: 'Cổ chân lệch ra ngoài gối (× vai)',
  toeOutW: 'Mũi chân hướng ra ngoài (−1…1)', ankleFlexW: 'Góc cổ chân (°)', pitchRel: 'Đầu ngẩng(+)/cúi(−) so với lúc đầu (°)',
};

// ---------- danh mục lỗi & câu sửa (xưng "các bạn") ----------
export const ERR = {
  V_HEP: { say: 'Quạt rộng hơn, hai tay thành chữ V nhé', arrow: 'wristsOut' },
  V_CONG: { say: 'Giữ tay thẳng khi quạt chữ V', arrow: 'wristsOut' },
  U_THANG: { say: 'Gập khuỷu tay, ôm nước về trước ngực', arrow: 'wristsIn' },
  U_QUA: { say: 'Ôm tới ngang vai thôi, đừng kéo tay xuống quá ngực', arrow: 'armsUp' },
  THU_XA: { say: 'Thu hai tay sát về che cằm', arrow: 'wristsToChin' },
  THU_HO: { say: 'Chụm hai bàn tay lại trước cằm', arrow: 'wristsIn' },
  DUOI_CONG: { say: 'Duỗi thẳng hết tay ra', arrow: 'armsUp' },
  DUOI_HO: { say: 'Khép hai bàn tay lại khi duỗi', arrow: 'wristsIn' },
  DUOI_THAP: { say: 'Đưa tay vươn hết cỡ về phía trước', arrow: 'armsUp' },
  CO_IT: { say: 'Co gót về sát mông hơn', arrow: 'heelUp' },
  CO_DUI: { say: 'Đừng đưa đùi ra trước nhiều, kéo gót về mông', arrow: 'kneeBack' },
  BE_MUI: { say: 'Bẻ cổ chân, xoay mũi chân ra ngoài', arrow: 'footOut' },
  BE_GAP: { say: 'Kéo mũi chân về phía ống chân, bẻ cổ chân', arrow: 'footOut' },
  DAP_HEP: { say: 'Đạp rộng ra sau và sang bên', arrow: 'legOut' },
  DAP_CHUA_DUOI: { say: 'Đạp thẳng hết chân', arrow: 'legOut' },
  KHEP_HO: { say: 'Khép sát hai chân lại', arrow: 'legsIn' },
  KHEP_MUI: { say: 'Duỗi thẳng mũi chân khi khép', arrow: 'toePoint' },
  UP_IT: { say: 'Úp mặt xuống thêm, cằm hướng về ngực', arrow: 'headDown' },
  NGANG_SOM: { say: 'Hỉ mũi xong rồi mới ngẩng nhé', arrow: 'headDown' },
  NGANG_IT: { say: 'Ngẩng cằm lên để lấy hơi', arrow: 'headUp' },
  NGANG_QUA: { say: 'Ngẩng vừa đủ thôi, đừng ngửa cổ', arrow: 'headDown' },
  NGANG_CUNG: { say: 'Ngẩng đầu lấy hơi cùng lúc quạt tay', arrow: 'headUp' },
  DUOI_UP: { say: 'Duỗi tay rồi úp mặt xuống', arrow: 'headDown' },
  TAY_TRUOC_CHAN: { say: 'Tay xong mới tới chân nhé', arrow: 'armsUp' },
  GIU_TAY: { say: 'Giữ tay duỗi thẳng khi đạp chân', arrow: 'armsUp' },
  LUOT_NGAN: { say: 'Lướt lâu hơn, đếm một, hai rồi mới quạt', arrow: null },
  CHAN_CHUA_KHEP: { say: 'Khép chân lại rồi mới lướt', arrow: 'legsIn' },
  MISS: { say: 'Làm đủ từng động tác nhé', arrow: null },
};

export const PRAISE = ['Tốt lắm!', 'Đúng nhịp rồi, giữ vậy nhé!', 'Rất tốt, các bạn làm đều lắm!', 'Chuẩn rồi, tiếp tục nhé!'];

// ---------- khối kiểm tra dùng lại ----------
const J = { ARMS: [11, 12, 13, 14, 15, 16], WR: [15, 16, 13, 14], HEAD: [0, 7, 8, 2, 5] };
const legJ = (leg) => leg === 'L' ? [23, 25, 27, 29, 31] : [24, 26, 28, 30, 32];
const bothAnk = [27, 28, 29, 30, 31, 32];

const ARM = {
  V: {
    detect: [{ f: 'spread', min: 1.45 }, { f: 'elbowMin', min: 105 }, { f: 'reachAvg', min: 0.45 }],
    quality: [
      { f: 'spread', min: 2.0, nearMin: 1.7, err: 'V_HEP', j: J.WR },
      { f: 'elbowMin', min: 145, nearMin: 130, err: 'V_CONG', j: J.ARMS },
    ],
  },
  U: {
    detect: [{ f: 'elbowAvg', min: 40, max: 140 }, { f: 'reachAvg', min: -0.8, max: 1.0 }, { f: 'spread', min: 0.8 }],
    quality: [
      { f: 'elbowAvg', max: 120, nearMax: 135, err: 'U_THANG', j: J.ARMS },
      { f: 'reachMin', min: -0.45, nearMin: -0.75, err: 'U_QUA', j: J.WR },
    ],
  },
  THU: {
    detect: [{ f: 'wristChin', max: 0.85 }, { f: 'elbowAvg', max: 115 }],
    quality: [
      { f: 'wristChin', max: 0.6, nearMax: 0.8, err: 'THU_XA', j: J.WR.concat([0]) },
      { f: 'spread', max: 0.6, nearMax: 0.9, err: 'THU_HO', j: [15, 16] },
    ],
  },
  DUOI: {
    detect: [{ f: 'elbowMin', min: 125 }, { f: 'reachAvg', min: 0.9 }, { f: 'spread', max: 1.4 }],
    quality: [
      { f: 'elbowMin', min: 155, nearMin: 142, err: 'DUOI_CONG', j: J.ARMS },
      { f: 'spread', max: 0.6, nearMax: 0.9, err: 'DUOI_HO', j: [15, 16] },
      { f: 'reachAvg', min: 1.2, nearMin: 1.0, err: 'DUOI_THAP', j: J.WR },
    ],
  },
};

const LEG = (leg) => ({
  CO: {
    detect: [{ f: 'kneeW', max: 120 }],
    quality: [
      { f: 'kneeW', max: 80, nearMax: 100, err: 'CO_IT', j: legJ(leg) },
      { f: 'thighFwdW', max: 45, nearMax: 60, err: 'CO_DUI', j: legJ(leg).slice(0, 2) },
    ],
  },
  BE: {
    detect: [{ f: 'kneeW', max: 130 }, { any: [{ f: 'footOutW', min: 0.15 }, { f: 'toeOutW', min: 0.35 }] }],
    quality: [
      { f: 'toeOutW', min: 0.5, nearMin: 0.3, err: 'BE_MUI', j: legJ(leg).slice(2) },
      { f: 'ankleFlexW', max: 110, nearMax: 125, err: 'BE_GAP', j: legJ(leg).slice(2) },
    ],
  },
  DAP: {
    detect: [{ f: 'kneeW', min: 125 }, { f: 'ankleGap', min: 0.9 }],
    quality: [
      { f: 'ankleGap', min: 1.35, nearMin: 1.1, err: 'DAP_HEP', j: legJ(leg) },
      { f: 'kneeW', min: 155, nearMin: 140, err: 'DAP_CHUA_DUOI', j: legJ(leg) },
    ],
  },
  KHEP: {
    detect: [{ f: 'kneeW', min: 148 }, { f: 'ankleGap', max: 0.8 }],
    quality: [
      { f: 'ankleGap', max: 0.5, nearMax: 0.7, err: 'KHEP_HO', j: bothAnk },
      { f: 'ankleFlexW', min: 135, nearMin: 120, err: 'KHEP_MUI', j: legJ(leg).slice(2) },
    ],
  },
});

const HEAD = {
  DOWN: { detect: [{ f: 'pitchRel', max: -14 }], quality: [{ f: 'pitchRel', max: -22, nearMax: -15, err: 'UP_IT', j: J.HEAD }] },
  UP: {
    detect: [{ f: 'pitchRel', min: -8 }],
    quality: [
      { f: 'pitchRel', min: -4, nearMin: -9, err: 'NGANG_IT', j: J.HEAD },
      { f: 'pitchRel', max: 32, nearMax: 42, err: 'NGANG_QUA', j: J.HEAD },
    ],
  },
};

const SHORT = { LUOT: 'Lướt', HI: 'Hỉ', V: 'Quạt', U: 'Ôm', THU: 'Thu', DUOI: 'Duỗi', CO: 'Co', BE: 'Bẻ', DAP: 'Đạp', KHEP: 'Khép', UP1: 'Úp', NGANG: 'Ngẩng', UP2: 'Úp' };
const ph = (id, name, def, extra = {}) => ({ id, name, short: SHORT[id] || name, detect: def.detect, quality: def.quality, ...extra });
const withQ = (def, more) => ({ detect: def.detect, quality: def.quality.concat(more) });

// ---------- 4 bài ----------
// t: thời lượng mỗi pha (giây) theo tốc độ [Chậm, Vừa, Chuẩn]
export function buildExercise(id, opts = {}) {
  const leg = opts.leg === 'L' ? 'L' : 'R';
  const L = LEG(leg);
  if (id === 1) {
    return {
      id, name: 'Tay ếch đứng', scoreBy: 'phase',
      phases: [
        ph('V', 'Quạt V', ARM.V, { missErr: 'V_HEP', say: 'Quạt', t: [1.0, 0.75, 0.55] }),
        ph('U', 'Ôm U', ARM.U, { say: 'Ôm', t: [1.0, 0.75, 0.55] }),
        ph('THU', 'Thu che cằm', ARM.THU, { say: 'Thu', t: [1.0, 0.75, 0.55] }),
        ph('DUOI', 'Duỗi', ARM.DUOI, { say: 'Duỗi', t: [1.4, 1.0, 0.8] }),
      ],
    };
  }
  if (id === 2) {
    return {
      id, name: 'Chân ếch một chân', scoreBy: 'phase',
      phases: [
        ph('CO', 'Co', L.CO, { say: 'Co', t: [1.2, 0.9, 0.65] }),
        ph('BE', 'Bẻ', L.BE, { missErr: 'BE_MUI', say: 'Bẻ', t: [1.1, 0.8, 0.6] }),
        ph('DAP', 'Đạp', L.DAP, { say: 'Đạp', t: [1.1, 0.8, 0.6] }),
        ph('KHEP', 'Khép', L.KHEP, { say: 'Khép', t: [1.6, 1.3, 0.95] }),
      ],
    };
  }
  if (id === 3) {
    return {
      id, name: 'Thở + đầu', scoreBy: 'phase',
      phases: [
        ph('UP1', 'Úp mặt (nín)', HEAD.DOWN, { say: 'Úp mặt, nín', t: [2.0, 1.6, 1.3] }),
        ph('HI', 'Hỉ mũi', { detect: HEAD.DOWN.detect, quality: [{ ...HEAD.DOWN.quality[0], err: 'NGANG_SOM' }] },
          { say: 'Hỉ mũi', t: [1.4, 1.2, 1.0], afterPrev: 0.75, missErr: 'NGANG_SOM' }),
        ph('NGANG', 'Ngẩng, hít', HEAD.UP, { say: 'Ngẩng, hít', t: [1.4, 1.2, 0.9] }),
        ph('UP2', 'Úp mặt', HEAD.DOWN, { say: 'Úp mặt', t: [1.2, 1.0, 0.8] }),
      ],
    };
  }
  // Bài 4: phối hợp đủ chu kỳ
  const armsHeld = [
    { f: 'elbowMin', min: 135, nearMin: 120, err: 'GIU_TAY', j: J.ARMS },
    { f: 'reachAvg', min: 0.9, nearMin: 0.7, err: 'GIU_TAY', j: J.WR },
  ];
  const headDownQ = { f: 'pitchRel', max: -18, nearMax: -12, err: 'DUOI_UP', j: J.HEAD };
  const headUpQ = { f: 'pitchRel', min: -6, nearMin: -12, err: 'NGANG_CUNG', j: J.HEAD };
  const glideDetect = ARM.DUOI.detect.concat([{ f: 'pitchRel', max: -12 }, { f: 'kneeW', min: 145 }, { f: 'ankleGap', max: 0.85 }]);
  const glideQ = ARM.DUOI.quality.concat([{ ...HEAD.DOWN.quality[0] }, { ...L.KHEP.quality[0], err: 'CHAN_CHUA_KHEP' }]);
  return {
    id, name: 'Phối hợp ếch', scoreBy: 'cycle',
    phases: [
      ph('LUOT', 'Lướt (nín)', { detect: glideDetect, quality: glideQ },
        { say: 'Lướt… nín…', sayFast: 'Lướt, nín', t: [2.2, 1.8, 1.5] }),
      ph('HI', 'Hỉ mũi', { detect: glideDetect, quality: glideQ },
        { say: 'Hỉ mũi…', sayFast: 'Hỉ mũi', t: [0.8, 0.7, 0.6], afterPrev: 0.8, missErr: 'LUOT_NGAN' }),
      ph('V', 'Ngẩng + quạt V', withQ(ARM.V, [headUpQ]),
        { say: 'Ngẩng, hít, quạt, ôm, thu…', sayFast: 'Ngẩng, quạt, ôm, thu', t: [0.67, 0.5, 0.35], missErr: 'V_HEP' }),
      ph('U', 'Ôm U', withQ(ARM.U, [headUpQ]), { t: [0.67, 0.5, 0.35] }),
      ph('THU', 'Thu che cằm', withQ(ARM.THU, [headUpQ]), { t: [0.66, 0.5, 0.35] }),
      ph('DUOI', 'Duỗi, úp mặt', withQ(ARM.DUOI, [headDownQ, { f: 'kneeW', min: 145, nearMin: 135, err: 'TAY_TRUOC_CHAN', j: legJ(leg) }]),
        { say: 'Duỗi, úp mặt…', sayFast: 'Duỗi, úp', t: [1.0, 0.8, 0.6], missErr: 'TAY_TRUOC_CHAN' }),
      ph('CO', 'Co chân', withQ(L.CO, armsHeld), { say: 'Co, bẻ, đạp, khép…', sayFast: 'Co, bẻ, đạp, khép', t: [0.5, 0.4, 0.3] }),
      ph('BE', 'Bẻ', withQ(L.BE, armsHeld), { t: [0.5, 0.4, 0.3], missErr: 'BE_MUI' }),
      ph('DAP', 'Đạp', withQ(L.DAP, armsHeld), { t: [0.5, 0.4, 0.3] }),
      ph('KHEP', 'Khép', withQ(L.KHEP, armsHeld), { t: [0.5, 0.4, 0.35] }),
    ],
  };
}

export const SPEEDS = ['cham', 'vua', 'chuan'];
export const SPEED_NAME = { cham: 'Chậm', vua: 'Vừa', chuan: 'Chuẩn' };
export const speedIdx = (s) => Math.max(0, SPEEDS.indexOf(s));
export const phaseDur = (ex, i, speed) => ex.phases[i].t[speedIdx(speed)];
export const cycleDur = (ex, speed) => ex.phases.reduce((s, _, i) => s + phaseDur(ex, i, speed), 0);

// ---------- áp mẫu HLV (nếu có) ----------
const TOL = (f) => (/^(elbow|knee|ankleFlex|thigh|pitch)/.test(f) ? 8 : 0.12);
/** templates: [{bai, phases:{ID:{feat:{mean,sd,n}}}, errors:[{phase, code, cau, feats:{...}}]}] */
export function applyTemplates(ex, templates) {
  const mine = (templates || []).filter((t) => Number(t.bai) === ex.id);
  if (!mine.length) { ex.thresholdSource = 'tam'; return ex; }
  const pooled = {};
  for (const t of mine) for (const [pid, feats] of Object.entries(t.phases || {})) {
    pooled[pid] = pooled[pid] || {};
    for (const [f, s] of Object.entries(feats)) {
      const p = pooled[pid][f] || (pooled[pid][f] = { means: [], sd: 0 });
      p.means.push(s.mean); p.sd = Math.max(p.sd, s.sd || 0);
    }
  }
  for (const phase of ex.phases) {
    const st = pooled[phase.id];
    if (!st) continue;
    phase.quality = phase.quality.map((q) => {
      const s = st[q.f];
      if (!s) return q;
      const mean = s.means.reduce((a, b) => a + b, 0) / s.means.length;
      const tol = TOL(q.f), k = Math.max(1.5 * s.sd, tol), kn = Math.max(s.sd, tol);
      const n = { ...q, fromTemplate: true };
      if (q.min != null) { n.min = mean - k; n.nearMin = n.min - kn; }
      if (q.max != null) { n.max = mean + k; n.nearMax = n.max + kn; }
      return n;
    });
    phase.templateStats = st;
  }
  ex.customErrors = mine.flatMap((t) => t.errors || []);
  ex.thresholdSource = 'mau';
  ex.templateInfo = mine.map((t) => `${t.goc || ''} ${t.ngay || ''}`.trim()).join(', ');
  return ex;
}

// ---------- đánh giá ----------
const RANK = { ok: 0, near: 1, bad: 3 };
function checkOne(c, F) {
  if (c.any) return c.any.some((x) => checkOne(x, F));
  const v = F[c.f];
  if (!Number.isFinite(v)) return false;
  return (c.min == null || v >= c.min) && (c.max == null || v <= c.max);
}
export function detects(phase, F) { return phase.detect.every((c) => checkOne(c, F)); }

export function evalQuality(phase, F) {
  let score = 0, worst = 'ok', err = null;
  const checks = phase.quality.map((q) => {
    const v = F[q.f];
    let s;
    if (!Number.isFinite(v)) s = 'bad';
    else if ((q.min == null || v >= q.min) && (q.max == null || v <= q.max)) s = 'ok';
    else if ((q.nearMin == null ? q.min == null || v >= q.min : v >= q.nearMin) &&
             (q.nearMax == null ? q.max == null || v <= q.max : v <= q.nearMax)) s = 'near';
    else s = 'bad';
    score += RANK[s];
    if (RANK[s] > RANK[worst]) worst = s;
    if (s === 'bad' && !err) err = q.err;
    return { ...q, v, s };
  });
  return { status: worst, score, err, checks };
}

function matchCustomError(ex, phaseId, F) {
  const list = (ex.customErrors || []).filter((e) => e.phase === phaseId);
  if (!list.length) return null;
  const phase = ex.phases.find((p) => p.id === phaseId);
  let best = null;
  for (const e of list) {
    const fs = Object.entries(e.feats || {});
    if (!fs.length) continue;
    let dErr = 0, dOk = 0, n = 0;
    for (const [f, s] of fs) {
      const v = F[f]; if (!Number.isFinite(v)) continue;
      const tol = TOL(f);
      dErr += Math.abs(v - s.mean) / Math.max(s.sd || 0, tol);
      const ok = phase && phase.templateStats && phase.templateStats[f];
      if (ok) {
        const m = ok.means.reduce((a, b) => a + b, 0) / ok.means.length;
        dOk += Math.abs(v - m) / Math.max(ok.sd, tol);
      } else dOk += 2;
      n++;
    }
    if (!n) continue;
    dErr /= n; dOk /= n;
    if (dErr < 1.6 && dErr < dOk && (!best || dErr < best.d)) best = { d: dErr, e };
  }
  return best && best.e;
}

// ---------- bộ theo dõi pha / chu kỳ ----------
export class Tracker {
  constructor(ex, opts = {}) {
    this.ex = ex;
    this.n = ex.phases.length;
    this.speed = opts.speed || 'cham';
    this.holdMs = opts.holdMs ?? 90;
    this.closeMs = opts.closeMs ?? 300;
    this.reset();
  }
  reset() {
    this.cur = -1; this.next = 0; this.enteredAt = 0; this.cycleStart = 0;
    this.results = []; this.best = null; this.bestF = null;
    this.cand = -1; this.candSince = 0; this.lastT = 0; this.live = null;
  }
  _finalize(idx) {
    const phase = this.ex.phases[idx];
    let r;
    if (this.best) {
      r = { id: phase.id, idx, status: this.best.status, err: this.best.err, feats: this.bestF };
      if (r.status !== 'ok') {
        const ce = matchCustomError(this.ex, phase.id, this.bestF);
        if (ce) { r.status = 'bad'; r.err = 'CUSTOM'; r.cau = ce.cau; }
      }
    } else r = { id: phase.id, idx, status: 'miss', err: phase.missErr || 'MISS' };
    this.results[idx] = r;
    this.best = null; this.bestF = null;
    return r;
  }
  _closeCycle(t, events) {
    for (let k = 0; k < this.n; k++) if (!this.results[k]) this.results[k] = { id: this.ex.phases[k].id, idx: k, status: 'miss', err: this.ex.phases[k].missErr || 'MISS' };
    const phases = this.results;
    const firstBad = phases.find((p) => p.status === 'bad' || p.status === 'miss');
    const rep = {
      phases, correct: !firstBad, primaryErr: firstBad ? firstBad.err : null, cau: firstBad && firstBad.cau,
      durMs: t - this.cycleStart, okPhases: phases.filter((p) => p.status === 'ok' || p.status === 'near').length,
    };
    events.push({ type: 'rep', rep });
    this.results = []; this.cur = -1; this.next = 0;
  }
  /** F: đặc trưng khung hiện tại, t: ms. Trả về danh sách sự kiện. */
  update(F, t) {
    const events = [];
    const ex = this.ex, n = this.n;
    if (this.cur >= 0) {
      const q = evalQuality(ex.phases[this.cur], F);
      this.live = q;
      if (!this.best || q.score < this.best.score) { this.best = q; this.bestF = { ...F }; }
      // pha cuối: giữ đủ lâu thì đóng chu kỳ
      if (this.cur === n - 1 && t - this.enteredAt >= this.closeMs && detects(ex.phases[this.cur], F)) {
        events.push({ type: 'phase', result: this._finalize(this.cur) });
        this._closeCycle(t, events);
        return events;
      }
    } else this.live = null;

    // ứng viên: pha kế tiếp, hoặc nhảy cóc tối đa 2 pha (giữa chu kỳ), 1 pha (khi chưa bắt đầu)
    // còn đang ở tư thế của pha hiện tại thì không cho nhảy cóc (tránh nhầm các pha cùng tư thế)
    const stillCur = this.cur >= 0 && detects(ex.phases[this.cur], F);
    const maxSkip = stillCur ? 0 : this.cur < 0 ? 1 : 2;
    let found = -1, skip = 0;
    for (let d = 0; d <= maxSkip; d++) {
      const j = this.next + d;
      const jj = j % n;
      const phase = ex.phases[jj];
      if (phase.afterPrev && d === 0 && this.cur >= 0) {
        const need = phase.afterPrev * phaseDur(ex, this.cur, this.speed) * 1000;
        if (t - this.enteredAt < need) continue;
      }
      if (phase.afterPrev && d > 0) continue; // pha theo thời gian không nhảy tới được
      if (detects(phase, F)) { found = j; skip = d; break; }
    }
    if (found < 0) { this.cand = -1; return events; }
    if (found !== this.cand) { this.cand = found; this.candSince = t; }
    const need = this.holdMs * (skip ? 2.5 : 1);
    if (t - this.candSince < need) return events;

    // vào pha mới
    if (this.cur >= 0) events.push({ type: 'phase', result: this._finalize(this.cur) });
    if (found >= n) { // đã sang chu kỳ sau
      this._closeCycle(t, events);
      found = found % n;
      for (let k = 0; k < found; k++) this.results[k] = { id: ex.phases[k].id, idx: k, status: 'miss', err: ex.phases[k].missErr || 'MISS' };
    } else {
      for (let k = this.next; k < found; k++) {
        const missErr = ex.phases[k].missErr || 'MISS';
        this.results[k] = { id: ex.phases[k].id, idx: k, status: 'miss', err: missErr };
        events.push({ type: 'phase', result: this.results[k] });
      }
    }
    if (found === 0 || this.cur < 0) this.cycleStart = t;
    this.cur = found; this.next = found + 1; this.enteredAt = t; this.cand = -1;
    this.best = null; this.bestF = null;
    events.push({ type: 'enter', idx: found });
    return events;
  }
}

// ---------- HLV: nhắc 1 lỗi khi sai 2 lần liên tiếp, khen sau ~3 lần đúng ----------
export class Coach {
  constructor() { this.lastErr = null; this.streak = 0; this.praiseI = 0; this.errCount = {}; }
  onRep(rep) {
    if (rep.correct) {
      this.lastErr = null; this.streak++;
      if (this.streak % 3 === 0) return { kind: 'praise', say: PRAISE[this.praiseI++ % PRAISE.length] };
      return null;
    }
    this.streak = 0;
    const code = rep.primaryErr === 'CUSTOM' ? 'CUSTOM:' + rep.cau : rep.primaryErr;
    this.errCount[code] = (this.errCount[code] || 0) + 1;
    if (code && code === this.lastErr) {
      this.lastErr = null;
      const say = rep.primaryErr === 'CUSTOM' ? rep.cau : (ERR[code] && ERR[code].say) || ERR.MISS.say;
      return { kind: 'fix', say, code: rep.primaryErr };
    }
    this.lastErr = code;
    return null;
  }
  topError() {
    let best = null;
    for (const [k, v] of Object.entries(this.errCount)) if (!best || v > best[1]) best = [k, v];
    if (!best) return null;
    const code = best[0];
    const say = code.startsWith('CUSTOM:') ? code.slice(7) : (ERR[code] && ERR[code].say) || ERR.MISS.say;
    return { code, count: best[1], say };
  }
}

// ---------- kiểm tra khung hình: đủ phần cơ thể cần thấy ----------
export const REGIONS = {
  1: { label: 'Đầu tới hông', pts: [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24] },
  2: { label: 'Hông tới bàn chân', pts: [23, 24, 25, 26, 27, 28, 29, 30, 31, 32] },
  3: { label: 'Đầu tới vai', pts: [0, 2, 5, 7, 8, 9, 10, 11, 12] },
  4: { label: 'Cả người', pts: [0, 7, 8, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32] },
};
const PART = (i) => (i <= 10 ? 'đầu' : i <= 12 ? 'vai' : i <= 16 ? 'tay' : i <= 24 ? 'hông' : i <= 26 ? 'gối' : 'bàn chân');
/** img: 33 điểm ảnh chuẩn hóa {x,y,visibility}. Trả {ok, missing:[phần], hint} */
export function frameCheck(img, bai, margin = 0.015) {
  if (!img) return { ok: false, missing: ['người'], hint: 'Mình chưa thấy các bạn trong khung' };
  const miss = new Set(); let top = false, bottom = false, side = false;
  for (const i of REGIONS[bai].pts) {
    const p = img[i];
    const vis = p.visibility == null ? 1 : p.visibility;
    const inside = p.x > margin && p.x < 1 - margin && p.y > margin && p.y < 1 - margin;
    if (vis < 0.5 || !inside) {
      miss.add(PART(i));
      if (p.y <= margin) top = true; if (p.y >= 1 - margin) bottom = true;
      if (p.x <= margin || p.x >= 1 - margin) side = true;
    }
  }
  if (!miss.size) return { ok: true, missing: [], hint: 'Đã thấy đủ, sẵn sàng!' };
  const parts = [...miss];
  let hint = `Chưa thấy ${parts.join(', ')}`;
  if ((top && bottom) || side) hint += ' — lùi xa thêm một chút';
  else if (top) hint += ' — hạ máy hoặc lùi xa thêm';
  else if (bottom) hint += ' — nghiêng máy xuống hoặc lùi xa thêm';
  return { ok: false, missing: parts, hint };
}

// ---------- cử chỉ: giơ hai tay qua đầu 2 giây ----------
/** Bài 1 & 4 (tay luôn giơ lên) cần thêm bắt chéo cổ tay để khỏi nhầm với "Duỗi". */
export function gestureRaw(img, bai) {
  if (!img) return false;
  const n = img[0], lw = img[15], rw = img[16], ls = img[11], rs = img[12];
  if ([n, lw, rw].some((p) => (p.visibility ?? 1) < 0.5)) return false;
  const sw = Math.hypot(ls.x - rs.x, ls.y - rs.y) || 0.1;
  const above = lw.y < n.y - 0.35 * sw && rw.y < n.y - 0.35 * sw;
  if (!above) return false;
  if (bai === 1 || bai === 4) {
    // người tập nhìn camera: vai trái nằm bên phải ảnh -> cổ tay trái sang bên trái cổ tay phải = bắt chéo
    const leftOnImageRight = ls.x > rs.x;
    const crossed = leftOnImageRight ? lw.x < rw.x - 0.1 * sw : lw.x > rw.x + 0.1 * sw;
    return crossed;
  }
  return true;
}

/** Ghi mẫu: gom thống kê đặc trưng cho từng pha */
export function statsOf(samples, feats) {
  const out = {};
  for (const f of feats) {
    const v = samples.map((s) => s[f]).filter(Number.isFinite);
    if (!v.length) continue;
    const mean = v.reduce((a, b) => a + b, 0) / v.length;
    const sd = Math.sqrt(v.reduce((a, b) => a + (b - mean) ** 2, 0) / v.length);
    out[f] = { mean: +mean.toFixed(3), sd: +sd.toFixed(3), n: v.length };
  }
  return out;
}
export function phaseFeatureList(phase) {
  const s = new Set();
  phase.quality.forEach((q) => s.add(q.f));
  phase.detect.forEach((d) => (d.any ? d.any.forEach((x) => s.add(x.f)) : s.add(d.f)));
  return [...s];
}

// ---------- làm mượt ----------
export class Smoother {
  constructor(alpha = 0.55) { this.a = alpha; this.prev = null; }
  push(arr) {
    if (!arr) { this.prev = null; return null; }
    if (!this.prev || this.prev.length !== arr.length) { this.prev = arr.map((p) => ({ ...p })); return this.prev; }
    const a = this.a;
    this.prev = arr.map((p, i) => {
      const q = this.prev[i];
      return { x: q.x + a * (p.x - q.x), y: q.y + a * (p.y - q.y), z: q.z + a * (p.z - q.z), visibility: p.visibility };
    });
    return this.prev;
  }
}
