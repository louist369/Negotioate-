import { EV } from '../core/events.js';
import { clamp, lerp } from '../core/vec.js';

/**
 * Audio engine.
 *
 * Every sound is synthesised at runtime with the Web Audio API — there are no
 * sample files in this project, so nothing here is licensed from anyone. The
 * crowd bed is filtered noise whose gain and brightness track a live
 * "excitement" value driven by match events, so the stadium responds to play
 * instead of looping indifferently.
 */
export class AudioEngine {
  constructor(bus) {
    this.bus = bus;
    this.ctx = null;
    this.enabled = true;
    this.started = false;
    this.masterVolume = 0.7;
    this.excitement = 0;
    this.targetExcitement = 0;
    this.lastKickTime = 0;
  }

  /** Must be called from a user gesture — browsers block audio otherwise. */
  start() {
    if (this.started) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    this.ctx = new Ctx();
    this.started = true;

    this.master = this.ctx.createGain();
    this.master.gain.value = this.masterVolume;
    this.master.connect(this.ctx.destination);

    // A gentle limiter keeps a goal + whistle + crowd swell from clipping.
    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -8;
    this.limiter.knee.value = 6;
    this.limiter.ratio.value = 8;
    this.limiter.attack.value = 0.003;
    this.limiter.release.value = 0.18;
    this.limiter.connect(this.master);

    this.sfx = this.ctx.createGain();
    this.sfx.gain.value = 1;
    this.sfx.connect(this.limiter);

    this.buildNoiseBuffer();
    this.buildCrowdBed();
    this.bindEvents();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(v) {
    this.masterVolume = clamp(v, 0, 1);
    if (this.master) this.master.gain.value = this.masterVolume;
  }

  toggleMute() {
    this.enabled = !this.enabled;
    if (this.master) this.master.gain.value = this.enabled ? this.masterVolume : 0;
    return this.enabled;
  }

  /** Two seconds of white noise, reused by every noise-based voice. */
  buildNoiseBuffer() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
  }

  /**
   * Crowd bed: looping noise through a bandpass, with a slow random walk on the
   * filter so it breathes rather than sitting static.
   */
  buildCrowdBed() {
    const ctx = this.ctx;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.45;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;

    const gain = ctx.createGain();
    gain.gain.value = 0.06;

    src.connect(bp);
    bp.connect(lp);
    lp.connect(gain);
    gain.connect(this.limiter);
    src.start();

    // A second, lower layer gives the crowd body.
    const src2 = ctx.createBufferSource();
    src2.buffer = this.noiseBuffer;
    src2.loop = true;
    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = 320;
    const gain2 = ctx.createGain();
    gain2.gain.value = 0.05;
    src2.connect(lp2);
    lp2.connect(gain2);
    gain2.connect(this.limiter);
    src2.start();

    this.crowd = { src, bp, lp, gain, gain2, lp2 };
  }

  bindEvents() {
    const bus = this.bus;

    bus.on(EV.KICK, (e) => {
      const now = this.ctx.currentTime;
      // Rate-limit so a scramble doesn't machine-gun the kick sound.
      if (now - this.lastKickTime < 0.045) return;
      this.lastKickTime = now;
      const power = e.power ?? 0.5;
      const type = e.type;
      if (type === 'shot' || type === 'clear') this.kick(0.95, 0.9);
      else if (type === 'loft' || type === 'through') this.kick(0.72, 0.62);
      else this.kick(0.5, 0.45);
    });

    bus.on(EV.TOUCH, (e) => {
      if (e.kind === 'dribble') this.kick(0.2, 0.16, 0.55);
      else if (e.kind === 'firstTouch') this.kick(0.3, 0.22, 0.7);
      else if (e.kind === 'bounce') this.bounce(clamp((e.speed ?? 3) / 12, 0.1, 1));
    });

    bus.on(EV.POST, () => this.post());
    bus.on(EV.TACKLE, (e) => {
      if (e.attempt) return;
      this.tackle();
    });
    bus.on(EV.TACKLE_WON, () => this.tackle());
    bus.on(EV.STUMBLE, () => this.tackle(0.6));

    bus.on(EV.SHOT, () => this.swell(0.55, 1.1));
    bus.on(EV.SAVE, (e) => {
      if (!e.attempt) this.swell(0.7, 1.4);
    });
    bus.on(EV.GOAL, () => {
      this.whistle(0.28);
      this.roar();
    });
    bus.on(EV.WHISTLE, (e) => {
      if (e.kind === 'goal') return; // already handled above
      if (e.kind === 'fullTime') this.whistle(0.75, 3);
      else if (e.kind === 'kickoff') this.whistle(0.3, 1);
      else this.whistle(0.22, 1);
    });
    bus.on(EV.SWITCH, () => this.blip(660, 0.04, 0.05));
    bus.on(EV.UI, (e) => this.blip(e?.tone ?? 520, 0.05, 0.06));
  }

  // ---------------------------------------------------------------- voices --

  noiseSource(duration, filterType, freq, Q = 1) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = filterType;
    f.frequency.value = freq;
    f.Q.value = Q;
    src.connect(f);
    src.start();
    src.stop(ctx.currentTime + duration + 0.05);
    return { src, filter: f };
  }

  /** Ball strike: a short filtered noise thwack plus a low body thump. */
  kick(level = 0.7, brightness = 0.6, decayScale = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 0.14 * decayScale;

    const { filter } = this.noiseSource(dur, 'bandpass', lerp(700, 2600, brightness), 1.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level * 0.55, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    filter.connect(g);
    g.connect(this.sfx);

    // Low thump for weight.
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(lerp(150, 260, brightness), t);
    osc.frequency.exponentialRampToValueAtTime(48, t + dur * 1.6);
    const og = ctx.createGain();
    og.gain.setValueAtTime(level * 0.42, t);
    og.gain.exponentialRampToValueAtTime(0.0008, t + dur * 1.8);
    osc.connect(og);
    og.connect(this.sfx);
    osc.start(t);
    osc.stop(t + dur * 2);
  }

  bounce(level = 0.4) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(190, t);
    osc.frequency.exponentialRampToValueAtTime(70, t + 0.1);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level * 0.22, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.13);
    osc.connect(g);
    g.connect(this.sfx);
    osc.start(t);
    osc.stop(t + 0.15);
  }

  /** Metallic ring for a post or crossbar strike. */
  post() {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    // A few inharmonic partials read as struck metal.
    const partials = [1, 2.76, 5.4, 8.9];
    partials.forEach((mult, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 240 * mult;
      const g = ctx.createGain();
      const amp = 0.34 / (i + 1.4);
      g.gain.setValueAtTime(amp, t);
      g.gain.exponentialRampToValueAtTime(0.0006, t + 1.1 / (i * 0.5 + 1));
      osc.connect(g);
      g.connect(this.sfx);
      osc.start(t);
      osc.stop(t + 1.3);
    });
    this.swell(0.55, 0.9);
  }

  tackle(level = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const { filter } = this.noiseSource(0.3, 'lowpass', 900);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.3 * level, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.3);
    filter.connect(g);
    g.connect(this.sfx);
  }

  /** Referee whistle: two detuned square tones with vibrato. */
  whistle(level = 0.3, blasts = 1) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    for (let b = 0; b < blasts; b++) {
      const t = ctx.currentTime + b * 0.26;
      const dur = blasts > 1 ? 0.18 : 0.32;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + 0.02);
      g.gain.setValueAtTime(level, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
      g.connect(this.sfx);

      // Vibrato LFO gives the pea-whistle warble.
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 34;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 90;
      lfo.connect(lfoGain);

      for (const freq of [2350, 3130]) {
        const osc = ctx.createOscillator();
        osc.type = 'square';
        osc.frequency.value = freq;
        lfoGain.connect(osc.frequency);
        const og = ctx.createGain();
        og.gain.value = 0.5;
        osc.connect(og);
        og.connect(g);
        osc.start(t);
        osc.stop(t + dur + 0.02);
      }
      lfo.start(t);
      lfo.stop(t + dur + 0.02);
    }
  }

  /** Crowd reaction: a quick lift in the ambience. */
  swell(amount = 0.5, duration = 1.2) {
    this.targetExcitement = Math.max(this.targetExcitement, amount);
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const g = this.crowd.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.06 + amount * 0.16, t + 0.12);
    g.linearRampToValueAtTime(0.06 + this.excitement * 0.05, t + duration);
  }

  /** Goal roar: a long, bright crowd swell. */
  roar() {
    this.targetExcitement = 1;
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;

    const g = this.crowd.gain.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(0.34, t + 0.25);
    g.setValueAtTime(0.34, t + 2.4);
    g.linearRampToValueAtTime(0.09, t + 6);

    const f = this.crowd.lp.frequency;
    f.cancelScheduledValues(t);
    f.setValueAtTime(f.value, t);
    f.linearRampToValueAtTime(4200, t + 0.3);
    f.linearRampToValueAtTime(1400, t + 6);

    const g2 = this.crowd.gain2.gain;
    g2.cancelScheduledValues(t);
    g2.setValueAtTime(g2.value, t);
    g2.linearRampToValueAtTime(0.2, t + 0.3);
    g2.linearRampToValueAtTime(0.05, t + 6);
  }

  blip(freq = 620, dur = 0.05, level = 0.06) {
    if (!this.ctx || !this.enabled) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    osc.connect(g);
    g.connect(this.sfx);
    osc.start(t);
    osc.stop(t + dur + 0.01);
  }

  /** Track ambient intensity toward the current match tension. */
  update(dt, excitement = 0) {
    if (!this.ctx || !this.enabled) return;
    this.targetExcitement = Math.max(this.targetExcitement * 0.96, excitement);
    this.excitement = lerp(this.excitement, this.targetExcitement, clamp(dt * 1.2, 0, 1));

    // Only nudge the bed when nothing scheduled is currently running.
    const t = this.ctx.currentTime;
    if (!this._holdUntil || t > this._holdUntil) {
      this.crowd.bp.frequency.value = lerp(480, 900, this.excitement);
    }
  }
}
