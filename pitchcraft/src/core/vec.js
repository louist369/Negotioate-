// Tiny allocation-conscious 2D/3D vector helpers used by the headless simulation.
// The sim works on the ground plane (x = length, z = width) with y reserved for height.

export function v2(x = 0, z = 0) {
  return { x, z };
}

export function set2(out, x, z) {
  out.x = x;
  out.z = z;
  return out;
}

export function copy2(out, a) {
  out.x = a.x;
  out.z = a.z;
  return out;
}

export function add2(out, a, b) {
  out.x = a.x + b.x;
  out.z = a.z + b.z;
  return out;
}

export function sub2(out, a, b) {
  out.x = a.x - b.x;
  out.z = a.z - b.z;
  return out;
}

export function scale2(out, a, s) {
  out.x = a.x * s;
  out.z = a.z * s;
  return out;
}

export function addScaled2(out, a, b, s) {
  out.x = a.x + b.x * s;
  out.z = a.z + b.z * s;
  return out;
}

export function len2(a) {
  return Math.hypot(a.x, a.z);
}

export function lenSq2(a) {
  return a.x * a.x + a.z * a.z;
}

export function dist2(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export function distSq2(a, b) {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function dot2(a, b) {
  return a.x * b.x + a.z * b.z;
}

export function norm2(out, a) {
  const l = Math.hypot(a.x, a.z);
  if (l < 1e-6) {
    out.x = 0;
    out.z = 0;
    return out;
  }
  out.x = a.x / l;
  out.z = a.z / l;
  return out;
}

export function clampLen2(out, a, max) {
  const l = Math.hypot(a.x, a.z);
  if (l > max && l > 1e-6) {
    const s = max / l;
    out.x = a.x * s;
    out.z = a.z * s;
  } else {
    out.x = a.x;
    out.z = a.z;
  }
  return out;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function smoothstep(edge0, edge1, x) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Shortest signed difference between two angles, in radians. */
export function angleDelta(a, b) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Rotate `a` toward `b` by at most `maxStep` radians. */
export function turnToward(a, b, maxStep) {
  const d = angleDelta(a, b);
  if (Math.abs(d) <= maxStep) return b;
  return a + Math.sign(d) * maxStep;
}

export function headingOf(v) {
  return Math.atan2(v.x, v.z);
}

export function fromHeading(out, h, mag = 1) {
  out.x = Math.sin(h) * mag;
  out.z = Math.cos(h) * mag;
  return out;
}

/**
 * Closest point on segment ab to point p, written into `out`.
 * Returns the parametric position along the segment (0..1).
 */
export function closestOnSegment(out, p, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const l2 = abx * abx + abz * abz;
  if (l2 < 1e-9) {
    out.x = a.x;
    out.z = a.z;
    return 0;
  }
  let t = ((p.x - a.x) * abx + (p.z - a.z) * abz) / l2;
  t = clamp(t, 0, 1);
  out.x = a.x + abx * t;
  out.z = a.z + abz * t;
  return t;
}
