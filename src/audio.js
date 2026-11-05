// Sons sintetizados (sem arquivos de áudio de terceiros)
let ctx = null, master = null, noiseBuf = null;

export function initAudio() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  try {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 1.5, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  } catch { ctx = null; }
}

function noise(dur, freq, q, gain, type = 'lowpass', when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type; f.frequency.value = freq; f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
}
function tone(freq, dur, gain, type = 'sine', slide = 0, when = 0) {
  if (!ctx) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}

export const sfx = {
  shot(id, vol = 1) {
    if (id === 'lr') { noise(0.5, 1800, 0.7, 1.0 * vol); tone(70, 0.4, 0.8 * vol, 'sine', -40); noise(1.2, 400, 0.5, 0.25 * vol, 'lowpass', 0.05); }
    else if (id === 'v9') { noise(0.12, 3200, 0.8, 0.6 * vol); tone(140, 0.08, 0.4 * vol, 'square', -80); }
    else { noise(0.2, 2400, 0.8, 0.8 * vol); tone(95, 0.15, 0.6 * vol, 'sine', -50); noise(0.5, 500, 0.5, 0.15 * vol, 'lowpass', 0.03); }
  },
  enemyShot(dist) { const v = Math.max(0.05, 1 - dist / 150) * 0.5; noise(0.18, 1500, 0.8, v); },
  hit() { tone(1800, 0.06, 0.25, 'square', -600); },
  kill() { tone(900, 0.08, 0.3, 'triangle'); tone(1400, 0.15, 0.3, 'triangle', 0, 0.07); },
  hurt() { noise(0.15, 300, 1, 0.5); },
  reload() { tone(400, 0.05, 0.2, 'square'); tone(250, 0.05, 0.2, 'square', 0, 0.4); tone(600, 0.06, 0.25, 'square', 0, 0.9); },
  empty() { tone(1200, 0.03, 0.15, 'square'); },
  explode(dist = 0) { const v = Math.max(0.1, 1 - dist / 120); noise(1.4, 600, 0.6, 1.2 * v); tone(50, 1, 1 * v, 'sine', -30); },
  levelUp() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.25, 0.25, 'triangle', 0, i * 0.1)); },
  step() { noise(0.06, 700, 1, 0.08); },
  heal() { tone(600, 0.3, 0.2, 'sine', 400); },
};
