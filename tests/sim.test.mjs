// Kiểm thử lõi chấm bằng khung xương mô phỏng: node tests/sim.test.mjs
import { buildExercise, computeFeatures, Tracker, Coach, frameCheck, gestureRaw, SPEEDS } from '../js/engine.js';
import { poseAt, restPose, toMediaPipe } from '../js/demo.js';

let fail = 0;
const ok = (cond, msg) => { console.log((cond ? '  ✓ ' : '  ✗ ') + msg); if (!cond) fail++; };

function noisy(world, amp, rnd) {
  return world.map((p) => ({ x: p.x + (rnd() - 0.5) * amp, y: p.y + (rnd() - 0.5) * amp, z: p.z + (rnd() - 0.5) * amp * 2 }));
}
function mulberry(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function run(bai, o = {}) {
  const opts = { leg: o.leg || 'R', posture: o.posture || 'tren', speed: o.speed || 'cham' };
  const ex = buildExercise(bai, opts);
  const base = computeFeatures(toMediaPipe(restPose(bai, opts), o.yaw || 0).world, opts).pitch;
  const tr = new Tracker(ex, { speed: opts.speed });
  const coach = new Coach();
  const exDemo = buildExercise(bai, opts);
  for (const [id, t] of Object.entries(o.demoT || {})) exDemo.phases.find((p) => p.id === id).t = t;
  const fps = o.fps || 30, cycles = o.cycles || 10;
  const total = (o.demoT ? exDemo : ex).phases.reduce((s, p) => s + p.t[SPEEDS.indexOf(opts.speed)], 0);
  const rnd = mulberry(7);
  const reps = [], said = [];
  for (let f = 0; f < total * cycles * fps; f++) {
    const t = f / fps;
    const { pts } = poseAt(exDemo, bai, opts, t, o.overrides || {});
    let { world } = toMediaPipe(pts, o.yaw || 0);
    if (o.noise) world = noisy(world, o.noise, rnd);
    const F = computeFeatures(world, { ...opts, pitchBase: base });
    for (const e of tr.update(F, t * 1000)) if (e.type === 'rep') { reps.push(e.rep); const c = coach.onRep(e.rep); if (c) said.push(c.say); }
  }
  return { reps, said, ex };
}

for (const bai of [1, 2, 3, 4]) {
  for (const speed of SPEEDS) {
    for (const yaw of [0, 60]) {
      const r = run(bai, { speed, yaw, noise: 0.006 });
      const good = r.reps.filter((x) => x.correct).length;
      ok(r.reps.length >= 9 && good >= r.reps.length - 1, `Bài ${bai} ${speed} yaw${yaw}: ${good}/${r.reps.length} đúng ${r.reps.filter((x) => !x.correct).map((x) => x.primaryErr).join(',')}`);
    }
  }
}
// tư thế khom, chân trái, 15 fps
{
  const r = run(1, { posture: 'khom', fps: 15, noise: 0.006 });
  ok(r.reps.filter((x) => x.correct).length >= 8, `Bài 1 khom 15fps: ${r.reps.filter((x) => x.correct).length}/${r.reps.length}`);
  const r2 = run(2, { leg: 'L', fps: 15, noise: 0.006 });
  ok(r2.reps.filter((x) => x.correct).length >= 8, `Bài 2 chân trái 15fps: ${r2.reps.filter((x) => x.correct).length}/${r2.reps.length}`);
  const r4 = run(4, { leg: 'L', fps: 15, speed: 'chuan', noise: 0.006 });
  ok(r4.reps.filter((x) => x.correct).length >= 8, `Bài 4 chân trái Chuẩn 15fps: ${r4.reps.filter((x) => x.correct).length}/${r4.reps.length}`);
}
// lỗi cố ý
{
  const r = run(1, { overrides: { V: { arm: 'V_HEP' } } });
  ok(r.reps.every((x) => !x.correct) && r.said.some((s) => /Quạt rộng/.test(s)), `Bài 1 quạt hẹp -> nhắc: "${r.said[0]}"`);
  const r2 = run(2, { overrides: { BE: { leg: 'BE_SAI' }, DAP: { leg: 'DAP_SAI' } } });
  ok(r2.reps.every((x) => !x.correct) && r2.said.some((s) => /Bẻ cổ chân|mũi chân/.test(s)), `Bài 2 không bẻ -> nhắc: "${r2.said[0]}"`);
  const r3 = run(3, { overrides: { NGANG: { head: -35 } } });
  ok(r3.reps.length === 0, `Bài 3 không ngẩng -> không tính lần (${r3.reps.length})`);
  const r4 = run(4, { overrides: { V: { head: -35 }, U: { head: -35 }, THU: { head: -35 } } });
  ok(r4.reps.every((x) => !x.correct) && r4.said.some((s) => /Ngẩng đầu/.test(s)), `Bài 4 không ngẩng khi quạt -> nhắc: "${r4.said[0]}"`);
  const r5 = run(4, { overrides: { DUOI: { leg: 'CO' } } });
  ok(r5.reps.every((x) => !x.correct) && r5.said.some((s) => /Tay xong/.test(s)), `Bài 4 co chân sớm -> nhắc: "${r5.said[0]}"`);
  const r6 = run(4, { demoT: { LUOT: [0.7, 0.7, 0.7], HI: [0.3, 0.3, 0.3] } });
  ok(r6.said.some((s) => /Lướt lâu/.test(s)), `Bài 4 lướt ngắn -> nhắc: "${r6.said[0]}"`);
  // coach: khen sau 3 lần đúng
  const r7 = run(1, {});
  ok(r7.said.filter((s) => /Tốt|Đúng nhịp|Rất tốt|Chuẩn/.test(s)).length >= 2, `Khen sau mỗi ~3 lần đúng: ${r7.said.join(' | ')}`);
}
// khung hình & cử chỉ
{
  const opts = { leg: 'R' };
  const img = toMediaPipe(restPose(4, opts)).image;
  ok(frameCheck(img, 4).ok, 'Khung: thấy cả người');
  const cut = img.map((p) => ({ ...p, y: p.y + 0.2 }));
  const fc = frameCheck(cut, 4);
  ok(!fc.ok && fc.missing.includes('bàn chân'), 'Khung: thiếu chân -> ' + fc.hint);
  ok(frameCheck(cut, 3).ok, 'Khung bài 3 chỉ cần đầu-vai');
  const duoi = toMediaPipe(restPose(1, opts)).image;
  ok(!gestureRaw(duoi, 1), 'Tư thế Duỗi KHÔNG bị nhầm là cử chỉ tạm dừng (bài 1)');
  ok(gestureRaw(duoi, 3), 'Hai tay qua đầu = cử chỉ (bài 3)');
}
console.log(fail ? `\n${fail} lỗi` : '\nTất cả đạt');
process.exit(fail ? 1 : 0);
