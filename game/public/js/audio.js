// Alle Geräusche werden live erzeugt (WebAudio) – keine Audiodateien nötig.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
  }

  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setListener(pos, fwd) {
    const l = this.ctx && this.ctx.listener;
    if (!l) return;
    if (l.positionX) {
      const t = this.ctx.currentTime;
      l.positionX.setValueAtTime(pos.x, t); l.positionY.setValueAtTime(pos.y, t); l.positionZ.setValueAtTime(pos.z, t);
      l.forwardX.setValueAtTime(fwd.x, t); l.forwardY.setValueAtTime(fwd.y, t); l.forwardZ.setValueAtTime(fwd.z, t);
      l.upX.setValueAtTime(0, t); l.upY.setValueAtTime(1, t); l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(fwd.x, fwd.y, fwd.z, 0, 1, 0);
    }
  }

  out(pos) {
    if (!pos) return this.master;
    const p = this.ctx.createPanner();
    p.panningModel = 'equalpower';
    p.distanceModel = 'inverse';
    p.refDistance = 4;
    p.maxDistance = 200;
    p.rolloffFactor = 1.1;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(this.master);
    return p;
  }

  burst(dest, { dur = 0.1, freq = 2000, q = 0.8, type = 'lowpass', gain = 0.5, at = 0, attack = 0.002 }) {
    const c = this.ctx, t = c.currentTime + at;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 0.5, dur + 0.05);
  }

  tone(dest, { f0 = 440, f1 = f0, dur = 0.1, type = 'sine', gain = 0.3, at = 0 }) {
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  shot(kind, pos = null) {
    if (!this.ctx) return;
    const d = this.out(pos);
    const k = pos ? 0.8 : 1;
    if (kind === 'sniper') {
      this.burst(d, { dur: 0.45, freq: 1400, gain: 0.9 * k });
      this.tone(d, { f0: 160, f1: 35, dur: 0.35, gain: 0.7 * k });
      this.burst(d, { dur: 0.9, freq: 500, gain: 0.25 * k, at: 0.05 });
    } else if (kind === 'shotgun') {
      this.burst(d, { dur: 0.32, freq: 1800, gain: 0.85 * k });
      this.tone(d, { f0: 120, f1: 30, dur: 0.25, gain: 0.7 * k });
    } else {
      this.burst(d, { dur: 0.11, freq: 3200, gain: 0.5 * k });
      this.tone(d, { f0: 220, f1: 60, dur: 0.08, type: 'triangle', gain: 0.35 * k });
    }
  }

  hit(head) { if (this.ctx) this.tone(this.master, { f0: head ? 2400 : 1700, f1: head ? 2000 : 1500, dur: 0.06, gain: 0.25 }); }
  kill() {
    if (!this.ctx) return;
    this.tone(this.master, { f0: 880, dur: 0.12, gain: 0.25, type: 'triangle' });
    this.tone(this.master, { f0: 1320, dur: 0.22, gain: 0.25, type: 'triangle', at: 0.09 });
  }
  hurt() { if (this.ctx) { this.burst(this.master, { dur: 0.18, freq: 400, gain: 0.6 }); this.tone(this.master, { f0: 90, f1: 50, dur: 0.15, gain: 0.4 }); } }
  reload(sec) {
    if (!this.ctx) return;
    this.burst(this.master, { dur: 0.05, freq: 3000, type: 'bandpass', q: 3, gain: 0.35, at: 0.05 });
    this.burst(this.master, { dur: 0.06, freq: 2200, type: 'bandpass', q: 3, gain: 0.4, at: sec * 0.55 });
    this.burst(this.master, { dur: 0.05, freq: 3600, type: 'bandpass', q: 4, gain: 0.4, at: sec * 0.9 });
  }
  empty() { if (this.ctx) this.burst(this.master, { dur: 0.03, freq: 4000, type: 'bandpass', q: 6, gain: 0.3 }); }
  step(pos = null) { if (this.ctx) this.burst(this.out(pos), { dur: 0.07, freq: 600 + Math.random() * 300, gain: pos ? 0.2 : 0.12 }); }
  land() { if (this.ctx) this.burst(this.master, { dur: 0.12, freq: 350, gain: 0.3 }); }
  spawn() { if (this.ctx) this.tone(this.master, { f0: 300, f1: 900, dur: 0.35, gain: 0.15, type: 'sine' }); }
  swap() { if (this.ctx) this.burst(this.master, { dur: 0.06, freq: 2500, type: 'bandpass', q: 2, gain: 0.25 }); }
  click() { if (this.ctx) this.tone(this.master, { f0: 1200, dur: 0.03, gain: 0.08 }); }
}
