/**
 * Deterministic PRNG (mulberry32). Every stochastic decision in the simulation
 * draws from an instance of this so headless test runs are reproducible.
 */
export class Rng {
  constructor(seed = 0x9e3779b9) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  reset(seed = this.seed) {
    this.seed = seed >>> 0;
    this.state = this.seed;
  }

  /** Uniform float in [0, 1). */
  next() {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  range(lo, hi) {
    return lo + (hi - lo) * this.next();
  }

  /** Symmetric noise in [-mag, mag]. */
  spread(mag) {
    return (this.next() * 2 - 1) * mag;
  }

  chance(p) {
    return this.next() < p;
  }

  int(n) {
    return Math.floor(this.next() * n);
  }

  pick(arr) {
    return arr[this.int(arr.length)];
  }

  /** Roughly-normal deviate via the mean of four uniforms. */
  gauss(sigma = 1) {
    const s = this.next() + this.next() + this.next() + this.next() - 2;
    return s * sigma * 0.866;
  }
}

export const globalRng = new Rng(20260731);
