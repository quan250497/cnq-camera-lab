// Giọng đọc tiếng Việt bằng Web Speech API (đọc trên máy, không ghi âm).
const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
let voices = [], chosen = null, enabled = true, unlocked = false, preferName = '';

function loadVoices() {
  if (!synth) return;
  voices = synth.getVoices() || [];
  const vi = voices.filter((v) => /^vi([-_]|$)/i.test(v.lang));
  chosen = vi.find((v) => v.name === preferName) || vi.find((v) => v.localService) || vi[0] || null;
}
if (synth) { loadVoices(); synth.onvoiceschanged = loadVoices; }

export const voice = {
  get supported() { return !!synth; },
  get enabled() { return enabled; },
  set enabled(v) { enabled = !!v; if (!v && synth) synth.cancel(); },
  get hasVietnamese() { return !!chosen; },
  get voiceName() { return chosen ? chosen.name : ''; },
  list() { return voices.filter((v) => /^vi([-_]|$)/i.test(v.lang)); },
  prefer(name) { preferName = name; loadVoices(); },
  /** gọi trong sự kiện chạm/bấm để mở khóa âm thanh trên iOS */
  unlock() {
    if (!synth || unlocked) return;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); unlocked = true; } catch (e) { /* bỏ qua */ }
  },
  say(text, o = {}) {
    if (!synth || !enabled || !text) return;
    try {
      if (o.interrupt !== false) synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'vi-VN';
      if (chosen) u.voice = chosen;
      u.rate = o.rate || 1.05; u.pitch = 1; u.volume = 1;
      synth.speak(u);
    } catch (e) { /* bỏ qua */ }
  },
  stop() { if (synth) synth.cancel(); },
  get speaking() { return !!(synth && synth.speaking); },
};
