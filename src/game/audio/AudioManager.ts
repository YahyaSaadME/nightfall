/**
 * Fully procedural sound (no audio files): ambience, spatialised one-shots,
 * enemy breathing with wall occlusion, threat-driven music and heartbeat.
 * The AudioContext is created on the first user gesture (browser autoplay rules).
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private amb!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noise!: AudioBuffer;
  private brown!: AudioBuffer;
  private volume = 0.8;
  private duck = 1;

  private humGain?: GainNode;
  private droneGain?: GainNode;
  private droneFilter?: BiquadFilterNode;
  private shimmerGain?: GainNode;
  private enemyVoice?: { panner: PannerNode; gain: GainNode; filter: BiquadFilterNode; lfo: OscillatorNode };
  private alarm?: { stop: () => void };
  private buzz: { panner: PannerNode; gain: GainNode; level: () => number }[] = [];
  private threat = 0;
  private heartTimer = 0;
  private hidden = false;

  get hasContext() {
    return !!this.ctx;
  }

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Call from a user gesture. Safe to call repeatedly. */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor({ latencyHint: 'interactive' });
      this.build();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private build() {
    const ctx = this.ctx!;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.amb = ctx.createGain();
    this.music = ctx.createGain();
    this.sfx.connect(this.master);
    this.amb.connect(this.master);
    this.music.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.impulse(2.8, 2.2);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.noise = this.makeNoise(false);
    this.brown = this.makeNoise(true);
    this.applyVolume();
    this.startAmbience();
  }

  private makeNoise(brown: boolean) {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 3;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      } else d[i] = w;
    }
    return buf;
  }

  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay) * (i < 200 ? i / 200 : 1);
    }
    return buf;
  }

  setVolume(v: number) {
    this.volume = v;
    this.applyVolume();
  }

  /** Lower everything (pause menu) without stopping the context. */
  setDucked(ducked: boolean) {
    this.duck = ducked ? 0.25 : 1;
    this.applyVolume();
    if (ducked) this.setThreat(0);
  }

  private applyVolume() {
    if (!this.ctx) return;
    this.master.gain.setTargetAtTime(this.volume * this.duck, this.ctx.currentTime, 0.08);
  }

  setListener(x: number, y: number, z: number, fx: number, fy: number, fz: number) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(x, t, 0.02);
      l.positionY.setTargetAtTime(y, t, 0.02);
      l.positionZ.setTargetAtTime(z, t, 0.02);
      l.forwardX.setTargetAtTime(fx, t, 0.02);
      l.forwardY.setTargetAtTime(fy, t, 0.02);
      l.forwardZ.setTargetAtTime(fz, t, 0.02);
      l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, fy, fz, 0, 1, 0);
    }
  }

  /** Muffles everything (inside a locker). */
  setHidden(hidden: boolean) {
    this.hidden = hidden;
  }

  // ------------------------------------------------------------------ building blocks

  private panner(x: number, y: number, z: number, ref = 2) {
    const p = this.ctx!.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = ref;
    p.rolloffFactor = 1.3;
    p.maxDistance = 60;
    p.positionX.value = x; p.positionY.value = y; p.positionZ.value = z;
    return p;
  }

  /** Output chain for a one-shot: optional panner, optional muffling, plus reverb send. */
  private out(pos?: { x: number; z: number; y?: number }, occluded = false, wet = 0.35): AudioNode {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    let node: AudioNode = g;
    if (occluded || this.hidden) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = occluded ? 600 : 1400;
      node.connect(f);
      node = f;
    }
    if (pos) {
      const p = this.panner(pos.x, pos.y ?? 1.2, pos.z);
      node.connect(p);
      node = p;
    }
    node.connect(this.sfx);
    const send = ctx.createGain();
    send.gain.value = wet;
    node.connect(send).connect(this.reverbSend);
    return g;
  }

  private noiseBurst(dest: AudioNode, at: number, dur: number, type: BiquadFilterType, freq: number, q: number, peak: number, attack = 0.005, buf = this.noise) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(at, Math.random() * 2);
    src.stop(at + dur + 0.05);
    return f;
  }

  private tone(dest: AudioNode, at: number, dur: number, type: OscillatorType, f0: number, f1: number, peak: number, attack = 0.01) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, at);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), at + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + dur + 0.05);
  }

  // ------------------------------------------------------------------ ambience

  private startAmbience() {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    // Low building rumble
    const rumble = ctx.createBufferSource();
    rumble.buffer = this.brown;
    rumble.loop = true;
    const rf = ctx.createBiquadFilter();
    rf.type = 'lowpass';
    rf.frequency.value = 180;
    const rg = ctx.createGain();
    rg.gain.value = 0.22;
    rumble.connect(rf).connect(rg).connect(this.amb);
    rumble.start(t);
    // Air handling hiss, slowly breathing
    const air = ctx.createBufferSource();
    air.buffer = this.noise;
    air.loop = true;
    const af = ctx.createBiquadFilter();
    af.type = 'bandpass';
    af.frequency.value = 900;
    af.Q.value = 0.4;
    const ag = ctx.createGain();
    ag.gain.value = 0.018;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.01;
    lfo.connect(lfoG).connect(ag.gain);
    lfo.start(t);
    air.connect(af).connect(ag).connect(this.amb);
    air.start(t);
    // Mains hum (louder once emergency power is on)
    this.humGain = ctx.createGain();
    this.humGain.gain.value = 0.006;
    for (const [f, a] of [[50, 1], [100, 0.6], [150, 0.25], [250, 0.1]]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = a;
      o.connect(g).connect(this.humGain);
      o.start(t);
    }
    this.humGain.connect(this.amb);
    // Threat drone
    this.droneFilter = ctx.createBiquadFilter();
    this.droneFilter.type = 'lowpass';
    this.droneFilter.frequency.value = 200;
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    for (const f of [41.2, 41.7, 61.7, 82.9]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(this.droneFilter);
      o.start(t);
    }
    this.droneFilter.connect(this.droneGain).connect(this.music);
    // Dissonant high shimmer for the chase
    this.shimmerGain = ctx.createGain();
    this.shimmerGain.gain.value = 0;
    for (const f of [1661, 1760, 1864]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const trem = ctx.createOscillator();
      trem.frequency.value = 5 + Math.random() * 3;
      const tg = ctx.createGain();
      tg.gain.value = 0.5;
      const og = ctx.createGain();
      og.gain.value = 0.5;
      trem.connect(tg).connect(og.gain);
      o.connect(og).connect(this.shimmerGain);
      o.start(t);
      trem.start(t);
    }
    const sSend = ctx.createGain();
    sSend.gain.value = 0.8;
    this.shimmerGain.connect(this.music);
    this.shimmerGain.connect(sSend).connect(this.reverbSend);
  }

  setPowerHum(on: boolean) {
    if (!this.ctx || !this.humGain) return;
    this.humGain.gain.setTargetAtTime(on ? 0.02 : 0.006, this.ctx.currentTime, 1.5);
  }

  /** Spatial buzzing at flickering tubes; gain follows the light level. */
  addBuzz(x: number, z: number, level: () => number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 120;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2400;
    f.Q.value = 2;
    const g = ctx.createGain();
    g.gain.value = 0;
    const p = this.panner(x, 2.9, z, 1.2);
    o.connect(f).connect(g).connect(p).connect(this.amb);
    o.start();
    this.buzz.push({ panner: p, gain: g, level });
  }

  /** 0 = calm, 1 = being chased. Drives the drone, shimmer and heartbeat. */
  setThreat(t: number) {
    this.threat = t;
    if (!this.ctx || !this.droneGain) return;
    const now = this.ctx.currentTime;
    this.droneGain.gain.setTargetAtTime(0.012 + t * 0.09, now, 0.6);
    this.droneFilter!.frequency.setTargetAtTime(160 + t * 700, now, 0.6);
    this.shimmerGain!.gain.setTargetAtTime(t > 0.75 ? (t - 0.75) * 0.06 : 0, now, 0.4);
  }

  update(dt: number) {
    if (!this.ready) return;
    for (const b of this.buzz) b.gain.gain.setTargetAtTime(b.level() > 0.3 ? 0.012 * b.level() : 0, this.ctx!.currentTime, 0.02);
    // Heartbeat when danger is close
    if (this.threat > 0.35) {
      this.heartTimer -= dt;
      if (this.heartTimer <= 0) {
        const bpm = 70 + this.threat * 80;
        this.heartTimer = 60 / bpm;
        this.heartbeat(0.25 + this.threat * 0.4);
      }
    }
  }

  private heartbeat(v: number) {
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dest = this.out(undefined, false, 0.05);
    this.tone(dest, t, 0.16, 'sine', 62, 38, v, 0.008);
    this.tone(dest, t + 0.22, 0.14, 'sine', 55, 34, v * 0.7, 0.008);
  }

  // ------------------------------------------------------------------ one-shots

  footstep(intensity: number, crouched: boolean) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out(undefined, false, 0.25);
    const v = (crouched ? 0.05 : 0.12) * intensity;
    this.noiseBurst(dest, t, 0.09, 'lowpass', 700 + Math.random() * 200, 0.7, v * 1.6);
    this.noiseBurst(dest, t + 0.01, 0.05, 'highpass', 3000 + Math.random() * 1500, 0.5, v * 0.35);
  }

  enemyStep(x: number, z: number, running: boolean, occluded: boolean) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out({ x, z, y: 0.1 }, occluded, 0.5);
    const v = running ? 0.9 : 0.55;
    this.noiseBurst(dest, t, 0.14, 'lowpass', 260, 1, v, 0.004, this.brown);
    this.tone(dest, t, 0.12, 'sine', 90, 45, v * 0.4);
    // Wet, slapping bare foot
    this.noiseBurst(dest, t + 0.02, 0.06, 'bandpass', 1300, 1.5, v * 0.15);
  }

  door(x: number, z: number, opening: boolean, occluded = false) {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dest = this.out({ x, z, y: 1.2 }, occluded, 0.5);
    // Latch
    this.noiseBurst(dest, t, 0.08, 'bandpass', 1800, 3, 0.35);
    this.tone(dest, t, 0.08, 'square', 210, 120, 0.05);
    if (opening) {
      // Hinge creak: resonant sweep with wobble
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      const base = 300 + Math.random() * 300;
      o.frequency.setValueAtTime(base, t + 0.05);
      o.frequency.linearRampToValueAtTime(base * (0.6 + Math.random() * 0.5), t + 0.7);
      const wob = ctx.createOscillator();
      wob.frequency.value = 18 + Math.random() * 14;
      const wg = ctx.createGain();
      wg.gain.value = 40;
      wob.connect(wg).connect(o.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1100;
      f.Q.value = 6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + 0.05);
      g.gain.linearRampToValueAtTime(0.06, t + 0.15);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.75);
      o.connect(f).connect(g).connect(dest);
      o.start(t + 0.05); wob.start(t + 0.05);
      o.stop(t + 0.8); wob.stop(t + 0.8);
    } else {
      this.noiseBurst(dest, t + 0.02, 0.35, 'lowpass', 400, 1, 0.5, 0.003, this.brown);
      this.tone(dest, t + 0.02, 0.3, 'sine', 110, 60, 0.15);
    }
  }

  doorLocked(x: number, z: number) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out({ x, z, y: 1.1 }, false, 0.3);
    for (let i = 0; i < 3; i++) this.noiseBurst(dest, t + i * 0.09, 0.06, 'bandpass', 1500 + Math.random() * 400, 4, 0.25);
  }

  /** Short electronic denial / accept from card readers. */
  beep(ok: boolean) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out(undefined, false, 0.15);
    if (ok) { this.tone(dest, t, 0.09, 'sine', 1320, 1320, 0.06); this.tone(dest, t + 0.1, 0.12, 'sine', 1760, 1760, 0.06); }
    else this.tone(dest, t, 0.25, 'square', 220, 200, 0.03);
  }

  locker(x: number, z: number, violent = false) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out({ x, z, y: 1.2 }, false, 0.4);
    this.noiseBurst(dest, t, violent ? 0.5 : 0.25, 'bandpass', violent ? 700 : 1200, 5, violent ? 0.8 : 0.3);
    this.tone(dest, t, violent ? 0.6 : 0.3, 'triangle', violent ? 180 : 320, violent ? 90 : 260, violent ? 0.2 : 0.06);
  }

  pickup(kind: 'key' | 'battery') {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out(undefined, false, 0.2);
    if (kind === 'battery') {
      this.noiseBurst(dest, t, 0.05, 'bandpass', 2500, 3, 0.2);
      this.tone(dest, t + 0.06, 0.08, 'square', 900, 900, 0.015);
    } else {
      for (let i = 0; i < 3; i++) this.noiseBurst(dest, t + i * 0.05, 0.08, 'bandpass', 3500 + i * 600, 8, 0.12);
    }
  }

  /** Soft, low bell: objective complete. */
  objective() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out(undefined, false, 0.6);
    for (const [f, a] of [[220, 0.08], [330, 0.05], [440, 0.03], [523, 0.02]] as const) this.tone(dest, t, 3.2, 'sine', f, f * 0.998, a, 0.01);
  }

  flashlightClick(on: boolean) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out(undefined, false, 0.05);
    this.noiseBurst(dest, t, 0.025, 'highpass', on ? 3500 : 2800, 1, 0.2);
  }

  hurt() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out(undefined, false, 0.3);
    this.noiseBurst(dest, t, 0.35, 'lowpass', 500, 1, 0.9, 0.002, this.brown);
    this.tone(dest, t, 0.4, 'sawtooth', 160, 60, 0.12);
    this.noiseBurst(dest, t, 0.2, 'bandpass', 2500, 2, 0.25);
  }

  /** Distant metallic impact somewhere in the building. */
  impact(x: number, z: number, occluded: boolean) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out({ x, z, y: 1.5 }, occluded, 0.9);
    this.noiseBurst(dest, t, 0.6, 'lowpass', 300, 1, 0.9, 0.002, this.brown);
    for (const f of [187, 291, 433, 611]) this.tone(dest, t, 1.8 + Math.random(), 'sine', f, f * 0.97, 0.05, 0.003);
  }

  /** A burst of distant footsteps (ambient scare, not the enemy). */
  distantSteps(x: number, z: number) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out({ x, z, y: 0.2 }, true, 0.9);
    const n = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) this.noiseBurst(dest, t + i * (0.32 + Math.random() * 0.1), 0.12, 'lowpass', 300, 1, 0.5, 0.004, this.brown);
  }

  /** Spotted: rising dissonant swell. */
  stinger() {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dest = this.out(undefined, false, 0.8);
    for (const f of [311, 330, 466, 622]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f * 0.94, t);
      o.frequency.linearRampToValueAtTime(f, t + 0.6);
      const fl = ctx.createBiquadFilter();
      fl.type = 'lowpass';
      fl.frequency.setValueAtTime(400, t);
      fl.frequency.linearRampToValueAtTime(3500, t + 0.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.03, t + 0.35);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.2);
      o.connect(fl).connect(g).connect(dest);
      o.start(t);
      o.stop(t + 2.3);
    }
    this.noiseBurst(dest, t, 0.9, 'highpass', 4000, 0.5, 0.06, 0.25);
  }

  /** Inhuman shriek, spatialised (attacks). */
  shriek(x: number, z: number) {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dest = this.out({ x, z, y: 1.9 }, false, 0.6);
    for (const f of [640, 910, 1270]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.55, t + 0.7);
      const vib = ctx.createOscillator();
      vib.frequency.value = 31;
      const vg = ctx.createGain();
      vg.gain.value = f * 0.05;
      vib.connect(vg).connect(o.frequency);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.06, t + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.8);
      o.connect(g).connect(dest);
      o.start(t); vib.start(t);
      o.stop(t + 0.85); vib.stop(t + 0.85);
    }
    this.noiseBurst(dest, t, 0.6, 'bandpass', 2200, 1, 0.3);
  }

  powerOn(x: number, z: number) {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dest = this.out({ x, z, y: 1.4 }, false, 0.6);
    this.noiseBurst(dest, t, 0.5, 'lowpass', 200, 1, 1.2, 0.002, this.brown);
    this.noiseBurst(dest, t, 0.15, 'bandpass', 3000, 2, 0.5);
    // Generator spinning up
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(15, t + 0.2);
    o.frequency.exponentialRampToValueAtTime(60, t + 3);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 300;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t + 0.2);
    g.gain.linearRampToValueAtTime(0.25, t + 1.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 5);
    o.connect(f).connect(g).connect(dest);
    o.start(t + 0.2);
    o.stop(t + 5.1);
    this.setPowerHum(true);
  }

  startAlarm(x: number, z: number) {
    if (!this.ctx || this.alarm) return;
    const ctx = this.ctx;
    const p = this.panner(x, 2.6, z, 4);
    const g = ctx.createGain();
    g.gain.value = 0.08;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = 660;
    const lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 1.6;
    const lg = ctx.createGain();
    lg.gain.value = 220;
    lfo.connect(lg).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1800;
    o.connect(f).connect(g).connect(p).connect(this.sfx);
    const send = ctx.createGain();
    send.gain.value = 0.4;
    p.connect(send).connect(this.reverbSend);
    o.start(); lfo.start();
    this.alarm = { stop: () => { try { o.stop(); lfo.stop(); } catch { /* already stopped */ } g.disconnect(); } };
  }

  stopAlarm() {
    this.alarm?.stop();
    this.alarm = undefined;
  }

  // ------------------------------------------------------------------ weapons & zombies

  /** Gunshot: a sharp crack over a low thump, with a long reverb tail indoors. */
  gunshot(kind: 'pistol' | 'shotgun') {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const big = kind === 'shotgun';
    const dest = this.out(undefined, false, big ? 0.9 : 0.7);
    this.noiseBurst(dest, t, big ? 0.35 : 0.16, 'highpass', big ? 900 : 1600, 0.6, big ? 1.5 : 1.1, 0.001);
    this.noiseBurst(dest, t, big ? 0.55 : 0.28, 'lowpass', big ? 500 : 800, 0.8, big ? 1.8 : 1.0, 0.001, this.brown);
    this.tone(dest, t, big ? 0.28 : 0.16, 'sine', big ? 120 : 160, 38, big ? 0.9 : 0.6, 0.001);
    this.tone(dest, t, 0.05, 'square', 2200, 700, 0.06, 0.0005);
  }

  /** Empty-chamber click. */
  dryFire() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out(undefined, false, 0.05);
    this.noiseBurst(dest, t, 0.03, 'bandpass', 2600, 6, 0.28, 0.0005);
    this.tone(dest, t, 0.03, 'square', 1200, 800, 0.03, 0.0005);
  }

  reload(kind: 'mag' | 'shell') {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out(undefined, false, 0.12);
    if (kind === 'shell') {
      this.noiseBurst(dest, t, 0.05, 'bandpass', 3200, 5, 0.22, 0.001);
      this.tone(dest, t + 0.04, 0.06, 'triangle', 420, 300, 0.05, 0.001);
      return;
    }
    this.noiseBurst(dest, t, 0.05, 'bandpass', 1800, 4, 0.2, 0.001); // magazine out
    this.noiseBurst(dest, t + 0.55, 0.06, 'bandpass', 2400, 5, 0.3, 0.001); // magazine in
    this.noiseBurst(dest, t + 0.85, 0.04, 'highpass', 3500, 2, 0.35, 0.001); // slide
    this.tone(dest, t + 0.85, 0.05, 'square', 600, 380, 0.03, 0.001);
  }

  pump() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime + 0.35;
    const dest = this.out(undefined, false, 0.2);
    this.noiseBurst(dest, t, 0.06, 'bandpass', 1500, 4, 0.35, 0.001);
    this.noiseBurst(dest, t + 0.14, 0.07, 'bandpass', 1100, 4, 0.4, 0.001);
    this.tone(dest, t + 0.14, 0.07, 'square', 260, 180, 0.04, 0.001);
  }

  /** Swing whoosh, plus a wet thud when it connects. */
  melee(hit: boolean) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out(undefined, false, 0.15);
    const f = this.noiseBurst(dest, t, 0.22, 'bandpass', 500, 1.2, 0.25, 0.06);
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(1800, t + 0.2);
    if (hit) {
      this.noiseBurst(dest, t + 0.08, 0.18, 'lowpass', 380, 1, 1.1, 0.002, this.brown);
      this.tone(dest, t + 0.08, 0.14, 'sine', 130, 55, 0.4, 0.002);
    }
  }

  /** Bullet or blow landing on a zombie (spatial). */
  zombieHit(x: number, z: number, headshot: boolean) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out({ x, z, y: headshot ? 1.6 : 1.2 }, false, 0.3);
    this.noiseBurst(dest, t, 0.14, 'lowpass', headshot ? 900 : 520, 1, 0.9, 0.001, this.brown);
    this.noiseBurst(dest, t, 0.05, 'bandpass', 2400, 3, 0.3, 0.001);
    if (headshot) this.tone(dest, t, 0.08, 'triangle', 700, 300, 0.1, 0.001);
  }

  zombieDie(x: number, z: number) {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dest = this.out({ x, z, y: 1.1 }, false, 0.6);
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.9);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(900, t);
    f.frequency.exponentialRampToValueAtTime(140, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
    o.connect(f).connect(g).connect(dest);
    o.start(t); o.stop(t + 1.05);
    this.noiseBurst(dest, t + 0.45, 0.25, 'lowpass', 300, 1, 0.7, 0.002, this.brown); // body hits the floor
  }

  /** A low, wet groan from a zombie; louder and harsher when it is hunting. */
  zombieGroan(x: number, z: number, hunting: boolean, occluded: boolean) {
    if (!this.ready) return;
    const ctx = this.ctx!;
    const t = ctx.currentTime;
    const dest = this.out({ x, z, y: 1.6 }, occluded, 0.55);
    const base = (hunting ? 150 : 95) * (0.85 + Math.random() * 0.35);
    const dur = hunting ? 0.9 : 1.5;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(base * 1.25, t);
    o.frequency.linearRampToValueAtTime(base, t + dur * 0.35);
    o.frequency.linearRampToValueAtTime(base * 0.7, t + dur);
    const vib = ctx.createOscillator();
    vib.frequency.value = 6 + Math.random() * 4;
    const vg = ctx.createGain();
    vg.gain.value = base * 0.06;
    vib.connect(vg).connect(o.frequency);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.setValueAtTime(420, t);
    f.frequency.linearRampToValueAtTime(900, t + dur * 0.4);
    f.frequency.linearRampToValueAtTime(380, t + dur);
    f.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(hunting ? 0.17 : 0.1, t + 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(dest);
    o.start(t); vib.start(t);
    o.stop(t + dur + 0.05); vib.stop(t + dur + 0.05);
    this.noiseBurst(dest, t, dur * 0.8, 'bandpass', 700, 1.4, hunting ? 0.1 : 0.05, 0.15);
  }

  pickupAmmo() {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out(undefined, false, 0.15);
    for (let i = 0; i < 3; i++) this.noiseBurst(dest, t + i * 0.05, 0.05, 'bandpass', 2800 + i * 500, 6, 0.22, 0.001);
    this.tone(dest, t + 0.12, 0.08, 'square', 520, 520, 0.02, 0.002);
  }

  /** Short confirming tick when a shot lands. */
  hitMarker(kill: boolean) {
    if (!this.ready) return;
    const t = this.ctx!.currentTime;
    const dest = this.out(undefined, false, 0.0);
    this.tone(dest, t, 0.05, 'sine', kill ? 1400 : 1000, kill ? 1000 : 800, kill ? 0.05 : 0.03, 0.001);
  }

  // ------------------------------------------------------------------ enemy voice

  /** Continuous ragged breathing at the stalker's position. */
  updateEnemyVoice(x: number, z: number, active: boolean, intensity: number, occluded: boolean) {
    if (!this.ready) return;
    const ctx = this.ctx!;
    if (!this.enemyVoice) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 520;
      bp.Q.value = 1.2;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 4000;
      const breath = ctx.createGain();
      breath.gain.value = 0;
      // Breathing rhythm: an LFO driving gain, offset so it never goes negative.
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 0.45;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.5;
      const offset = ctx.createConstantSource();
      offset.offset.value = 0.5;
      const shaper = ctx.createGain();
      shaper.gain.value = 0;
      lfo.connect(lfoGain).connect(shaper.gain);
      offset.connect(shaper.gain);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const panner = this.panner(x, 1.9, z, 1.5);
      // Low growl underneath
      const growl = ctx.createOscillator();
      growl.type = 'sawtooth';
      growl.frequency.value = 58;
      const gg = ctx.createGain();
      gg.gain.value = 0.15;
      const gf = ctx.createBiquadFilter();
      gf.type = 'lowpass';
      gf.frequency.value = 240;
      growl.connect(gf).connect(gg).connect(shaper);
      src.connect(bp).connect(shaper).connect(filter).connect(gain).connect(panner).connect(this.sfx);
      const send = ctx.createGain();
      send.gain.value = 0.3;
      panner.connect(send).connect(this.reverbSend);
      breath.connect(gain);
      src.start(); lfo.start(); offset.start(); growl.start();
      this.enemyVoice = { panner, gain, filter, lfo };
    }
    const v = this.enemyVoice;
    const t = ctx.currentTime;
    v.panner.positionX.setTargetAtTime(x, t, 0.05);
    v.panner.positionZ.setTargetAtTime(z, t, 0.05);
    v.gain.gain.setTargetAtTime(active ? 0.22 + intensity * 0.3 : 0, t, 0.2);
    v.filter.frequency.setTargetAtTime(occluded || this.hidden ? 450 : 4000, t, 0.15);
    v.lfo.frequency.setTargetAtTime(0.4 + intensity * 1.1, t, 0.5);
  }
}
