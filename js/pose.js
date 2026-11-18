// Camera + nhận diện tư thế MediaPipe chạy hoàn toàn trên máy (thư viện & mô hình nằm trong kho).
const BASE = new URL('../', import.meta.url).href;
let landmarker = null, loadingKind = null, loadPromise = null;

export function isMobile() {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

export async function loadPose(kind = isMobile() ? 'lite' : 'full', onStatus = () => {}) {
  if (landmarker && loadingKind === kind) return landmarker;
  if (loadPromise && loadingKind === kind) return loadPromise;
  loadingKind = kind;
  loadPromise = (async () => {
    onStatus('Đang tải bộ nhận diện…');
    const { FilesetResolver, PoseLandmarker } = await import(BASE + 'lib/mediapipe/vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks(BASE + 'lib/mediapipe/wasm');
    const model = BASE + `models/pose_landmarker_${kind}.task`;
    const make = (delegate) => PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: model, delegate },
      runningMode: 'VIDEO', numPoses: 1,
      minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
    });
    let lm;
    try { lm = await make('GPU'); } catch (e) { onStatus('Chuyển sang chế độ CPU…'); lm = await make('CPU'); }
    if (landmarker) try { landmarker.close(); } catch (e) { /* */ }
    landmarker = lm;
    onStatus('');
    return lm;
  })();
  try { return await loadPromise; } catch (e) { loadPromise = null; loadingKind = null; throw e; }
}

let lastTs = -1;
/** Trả {image, world} của người đầu tiên hoặc null */
export function detect(video, nowMs) {
  if (!landmarker || video.readyState < 2) return undefined;
  const ts = Math.max(nowMs, lastTs + 1); lastTs = ts;
  const r = landmarker.detectForVideo(video, ts);
  if (!r || !r.landmarks || !r.landmarks.length) return null;
  return { image: r.landmarks[0], world: r.worldLandmarks[0] };
}

// ---------- camera ----------
let stream = null;
export async function listCameras() {
  try {
    const d = await navigator.mediaDevices.enumerateDevices();
    return d.filter((x) => x.kind === 'videoinput');
  } catch (e) { return []; }
}
const WIDE = /ultra ?wide|siêu rộng|wide angle|góc rộng|0[.,]5x/i;

/** sel: {facing:'user'|'environment'} hoặc {deviceId} */
export async function startCamera(video, sel = { facing: 'user' }) {
  stopCamera(video);
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) throw new Error('Trình duyệt không hỗ trợ camera (cần mở bằng https)');
  let deviceId = sel.deviceId;
  if (!deviceId && sel.facing === 'environment') {
    // ưu tiên camera góc rộng nếu có tên nhận ra được (cần đã cấp quyền để đọc tên)
    const cams = await listCameras();
    const wide = cams.find((c) => WIDE.test(c.label) && !/front|trước|user/i.test(c.label));
    if (wide) deviceId = wide.deviceId;
  }
  // điện thoại: xin khung 4:3 để không bị cắt bớt góc nhìn; máy tính: 16:9
  const video0 = isMobile() ? { width: { ideal: 1280 }, height: { ideal: 960 }, frameRate: { ideal: 30 } } : { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } };
  const constraints = { audio: false, video: deviceId ? { ...video0, deviceId: { exact: deviceId } } : { ...video0, facingMode: { ideal: sel.facing || 'user' } } };
  stream = await navigator.mediaDevices.getUserMedia(constraints);
  const track = stream.getVideoTracks()[0];
  // camera có zoom < 1 (ống góc rộng gộp) thì kéo về góc rộng nhất
  try {
    const cap = track.getCapabilities ? track.getCapabilities() : {};
    if (cap.zoom && cap.zoom.min < 1) await track.applyConstraints({ advanced: [{ zoom: cap.zoom.min }] });
  } catch (e) { /* bỏ qua */ }
  video.srcObject = stream;
  video.setAttribute('playsinline', ''); video.muted = true;
  await video.play().catch(() => {});
  await new Promise((res) => { if (video.readyState >= 2) res(); else video.onloadeddata = () => res(); setTimeout(res, 3000); });
  const st = track.getSettings ? track.getSettings() : {};
  const facing = st.facingMode || sel.facing || (/(front|user|trước|facetime)/i.test(track.label) ? 'user' : 'environment');
  return { label: track.label, facing, deviceId: st.deviceId, wide: WIDE.test(track.label) };
}
export function stopCamera(video) {
  if (stream) { stream.getTracks().forEach((t) => t.stop()); stream = null; }
  if (video) video.srcObject = null;
}
