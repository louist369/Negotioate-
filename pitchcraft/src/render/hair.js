import * as THREE from 'three';

/**
 * Hairstyles.
 *
 * Hair used to be a single scalp cap skinned into the shared body geometry,
 * which meant every one of the fourteen players on the pitch had exactly the
 * same head. Nothing makes a squad read as fourteen *people* faster than
 * varying this, and nothing makes it read as fourteen copies faster than not.
 *
 * Each style is a small standalone mesh parented to the `head` bone, so it
 * needs no skinning — it inherits the bone's transform for free — and one
 * geometry is shared by every player wearing that style.
 *
 * Coordinates are local to the head bone: y = 0 is the base of the skull, and
 * the caller passes in the skull's centre offset and radii so hair sits on the
 * head it was built for rather than on a hard-coded one.
 */

/** Build a plain (non-skinned) BufferGeometry from a stack of rings. */
function latheGeometry(rings, radial) {
  const pos = [];
  const uv = [];
  const idx = [];

  for (const r of rings) {
    for (let i = 0; i <= radial; i++) {
      const a = (i / radial) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const mod = r.shape ? r.shape(a) : null;
      const k = mod && mod.scale !== undefined ? mod.scale : 1;
      pos.push(
        r.p[0] + c * r.rx * k + (mod?.dx || 0),
        r.p[1] + (mod?.dy || 0),
        r.p[2] + s * r.rz * k + (mod?.dz || 0)
      );
      uv.push(i / radial, r.v ?? 0);
    }
  }

  const stride = radial + 1;
  for (let j = 0; j < rings.length - 1; j++) {
    for (let i = 0; i < radial; i++) {
      const a0 = j * stride + i;
      const a1 = a0 + 1;
      const b0 = (j + 1) * stride + i;
      const b1 = b0 + 1;
      idx.push(a0, b0, a1, a1, b0, b1);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const lerp = (a, b, t) => a + (b - a) * t;

/** Gaussian falloff in angle, wrapping around the seam. Front of head = PI/2. */
function lobe(a, centre, width) {
  const TAU = Math.PI * 2;
  let d = (a - centre) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return Math.exp(-(d / width) * (d / width));
}

/**
 * @param {object} skull  { cy, R, x, z } — skull centre height in head-bone
 *   space, its radius, and the x/z proportion multipliers the head was built
 *   with, so hair follows the same ellipsoid.
 */
function capRings(skull, { hairline, thickness, steps = 10, edge = null, lump = null }) {
  const rings = [];

  // A point on the (slightly inflated) skull ellipsoid at polar angle phi.
  // phi = 0 is the bottom pole, PI the crown, so *lowering* phi moves down the
  // skull's surface.
  const point = (phi, hr) => [
    hr * skull.x * Math.sin(phi),
    skull.cy - hr * Math.cos(phi),
    hr * skull.z * Math.sin(phi),
  ];

  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const phiBase = lerp(hairline, Math.PI, k);
    // Thickest across the crown, thinning to nothing at the hairline so the
    // edge disappears into the scalp instead of ending on a visible lip.
    const hr = skull.R * (1.012 + thickness * Math.sin(k * Math.PI * 0.9));
    const base = point(phiBase, hr);

    rings.push({
      p: [0, base[1], 0],
      rx: Math.max(base[0], 0.002),
      rz: Math.max(base[2], 0.002),
      v: k,
      shape: (a) => {
        // Hair that hangs lower at the sides and nape must travel *down the
        // skull's surface*, which means lowering phi at those angles. The
        // obvious alternative — translating the vertex down in Y — moves it
        // inside the ellipsoid, which is what made the first version of this
        // shred through the face.
        const drop = edge ? edge(a) : 0;
        const phi = lerp(Math.max(hairline - drop, 0.3), Math.PI, k);
        const q = point(phi, hr);
        const c = Math.cos(a);
        const sn = Math.sin(a);
        return {
          dx: c * (q[0] - base[0]),
          dy: q[1] - base[1],
          dz: sn * (q[2] - base[2]),
          scale: 1 + (lump ? lump(a, k) : 0),
        };
      },
    });
  }
  return rings;
}

/** 0 at the brow, rising to `amount` at the nape — in radians of polar angle. */
function sweepBack(amount) {
  return (a) => amount * (1 - Math.sin(a)) * 0.5;
}

/**
 * Style table. `weight` biases how often a style is picked so a squad looks
 * like a squad — mostly short hair, with the distinctive cuts rare enough to
 * stay distinctive.
 */
const STYLES = [
  {
    name: 'buzz',
    weight: 3,
    build: (s) => capRings(s, { hairline: 2.5, thickness: 0.014, edge: sweepBack(0.16) }),
  },
  {
    name: 'crop',
    weight: 4,
    build: (s) => capRings(s, { hairline: 2.38, thickness: 0.05, edge: sweepBack(0.3) }),
  },
  {
    name: 'mop',
    weight: 3,
    // Fuller, and hanging well down over the ears and the nape.
    build: (s) =>
      capRings(s, { hairline: 2.24, thickness: 0.1, steps: 12, edge: sweepBack(0.62) }),
  },
  {
    name: 'curls',
    weight: 2,
    // Volume plus a lumpy surface — the lumps are what read as curl at any
    // distance, since individual strands are not affordable here.
    build: (s) =>
      capRings(s, {
        hairline: 2.3,
        thickness: 0.16,
        steps: 14,
        edge: sweepBack(0.44),
        lump: (a, k) => 0.045 * Math.sin(a * 5 + k * 9) + 0.03 * Math.sin(a * 9 - k * 6),
      }),
  },
  {
    name: 'bald',
    weight: 1,
    build: () => null,
  },
];

/**
 * A tied-back bun, added on top of a flat-swept cap. Separate from the style
 * table because it is an extra piece of geometry rather than a different cap.
 */
function bunGeometry(skull) {
  const rings = [];
  const steps = 8;
  const br = skull.R * 0.34;
  const cy = skull.cy + skull.R * 0.2;
  const cz = -skull.R * skull.z - br * 0.45;
  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    const phi = lerp(0.35, Math.PI - 0.35, k);
    rings.push({
      p: [0, cy - br * Math.cos(phi) * 1.1, cz],
      rx: Math.max(br * 0.85 * Math.sin(phi), 0.002),
      rz: Math.max(br * Math.sin(phi), 0.002),
      v: k,
    });
  }
  return latheGeometry(rings, 12);
}

const CACHE = new Map();

/**
 * Pick a style for a player and return its geometry (or null for bald).
 * Deterministic in the player's id, so a given match always looks the same.
 */
export function hairFor(player, skull) {
  const total = STYLES.reduce((n, s) => n + s.weight, 0);
  // A cheap deterministic hash — the player's own id plus number, so two
  // players with adjacent ids do not end up with the same head.
  let h = (player.id * 2654435761 + player.number * 40503) >>> 0;
  let pick = h % total;
  let style = STYLES[0];
  for (const s of STYLES) {
    if (pick < s.weight) {
      style = s;
      break;
    }
    pick -= s.weight;
  }
  // Roughly one player in seven ties it back.
  const bun = style.name !== 'bald' && ((h >>> 8) % 7) === 0;

  const key = `${style.name}:${bun}:${skull.R.toFixed(4)}`;
  if (CACHE.has(key)) return CACHE.get(key);

  const rings = style.build(skull);
  let geo = rings ? latheGeometry(rings, 24) : null;

  if (geo && bun) {
    const bunGeo = bunGeometry(skull);
    // Merge by concatenating attributes — these are small, plain geometries
    // with identical attribute sets, so this is safe and avoids a second draw.
    const merged = mergeSimple([geo, bunGeo]);
    geo.dispose();
    bunGeo.dispose();
    geo = merged;
  }

  CACHE.set(key, geo);
  return geo;
}

/** Concatenate plain position/uv/index geometries into one. */
function mergeSimple(list) {
  const pos = [];
  const uv = [];
  const idx = [];
  let offset = 0;
  for (const g of list) {
    const p = g.getAttribute('position');
    const t = g.getAttribute('uv');
    const i = g.getIndex();
    for (let n = 0; n < p.count; n++) pos.push(p.getX(n), p.getY(n), p.getZ(n));
    for (let n = 0; n < t.count; n++) uv.push(t.getX(n), t.getY(n));
    for (let n = 0; n < i.count; n++) idx.push(i.getX(n) + offset);
    offset += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function disposeHairCache() {
  for (const g of CACHE.values()) if (g) g.dispose();
  CACHE.clear();
}
