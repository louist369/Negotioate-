/**
 * Frame-time monitor. Tracks a rolling FPS estimate plus the 1% low, which is
 * what actually shows up as a stutter, and exposes renderer draw-call counts.
 */
export class PerfMonitor {
  constructor(sampleSize = 180) {
    this.samples = new Float32Array(sampleSize);
    this.index = 0;
    this.filled = 0;
    this.fps = 0;
    this.low1 = 0;
    this.accum = 0;
    this.updateInterval = 0.35;
    this.timer = 0;
    this.enabled = false;
  }

  sample(dt) {
    if (dt <= 0 || dt > 1) return;
    this.samples[this.index] = dt;
    this.index = (this.index + 1) % this.samples.length;
    this.filled = Math.min(this.filled + 1, this.samples.length);
    this.timer += dt;
  }

  /** Recompute at a human-readable cadence rather than every frame. */
  poll() {
    if (this.timer < this.updateInterval || this.filled < 10) return false;
    this.timer = 0;

    const arr = Array.from(this.samples.subarray(0, this.filled));
    const total = arr.reduce((a, b) => a + b, 0);
    this.fps = this.filled / total;

    arr.sort((a, b) => b - a);
    const idx = Math.max(0, Math.floor(arr.length * 0.01));
    this.low1 = 1 / arr[idx];
    return true;
  }

  report(renderer) {
    const info = renderer ? renderer.info : null;
    const calls = info ? info.render.calls : 0;
    const tris = info ? info.render.triangles : 0;
    const mem = info ? `${info.memory.geometries}g ${info.memory.textures}t` : '';
    return `${this.fps.toFixed(0)} fps  (1% low ${this.low1.toFixed(0)})  ${calls} draws  ${(tris / 1000).toFixed(0)}k tris  ${mem}`;
  }
}
