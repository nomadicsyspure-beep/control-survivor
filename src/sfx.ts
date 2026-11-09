// 효과음: 소리 파일 없이 Web Audio로 그 자리에서 만든다. 첫 터치 뒤에야 소리가 난다.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let noiseBuf: AudioBuffer | null = null;
const last: Record<string, number> = {};

function audio() {
  if (!ctx) {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.4, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

export function unlockAudio() {
  audio();
}

function throttle(key: string, ms: number) {
  const now = performance.now();
  if (now - (last[key] ?? 0) < ms) return false;
  last[key] = now;
  return true;
}

function tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number) {
  const a = audio();
  if (!a || !master) return;
  const t = a.currentTime;
  const o = a.createOscillator();
  const g = a.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur: number, vol: number, freq: number, q = 1) {
  const a = audio();
  if (!a || !master || !noiseBuf) return;
  const t = a.currentTime;
  const src = a.createBufferSource();
  src.buffer = noiseBuf;
  const f = a.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = a.createGain();
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t);
  src.stop(t + dur + 0.02);
}

export const sfx = {
  /** 주먹이 맞았다: power 1(잽) ~ 3(마무리) */
  hit(power: number) {
    if (!throttle('hit', 25)) return;
    tone(140 - power * 20, 0.09 + power * 0.04, 'sine', 0.5 + power * 0.15, 45);
    noise(0.05 + power * 0.03, 0.35 + power * 0.1, 900 + power * 300, 0.8);
  },
  whoosh() {
    if (!throttle('whoosh', 40)) return;
    noise(0.09, 0.12, 2200, 0.6);
  },
  dash() {
    noise(0.14, 0.18, 1400, 0.5);
  },
  wave() {
    if (!throttle('wave', 60)) return;
    tone(520, 0.18, 'triangle', 0.18, 980);
  },
  hurt() {
    if (!throttle('hurt', 80)) return;
    tone(220, 0.16, 'square', 0.18, 90);
  },
  kill() {
    if (!throttle('kill', 30)) return;
    tone(660, 0.07, 'triangle', 0.12, 990);
  },
  slam() {
    tone(90, 0.35, 'sine', 0.8, 35);
    noise(0.3, 0.5, 400, 0.7);
  },
  ultCharge() {
    tone(220, 0.5, 'sawtooth', 0.12, 880);
    noise(0.4, 0.15, 3000, 0.4);
  },
  ultBoom() {
    tone(70, 0.6, 'sine', 0.9, 28);
    noise(0.5, 0.6, 600, 0.6);
    tone(1200, 0.3, 'triangle', 0.15, 300);
  },
  perfect() {
    tone(880, 0.25, 'sine', 0.25, 1760);
  },
};
