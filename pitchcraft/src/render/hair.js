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
  const col = [];
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
      // Hair shares the body's material, which reads vertex colour for baked AO;
      // without the attribute the shader would sample garbage. Darkened toward
      // the hairline, where hair sits against the scalp.
      const ao = 1 - 0.25 * Math.max(0, 1 - (r.v ?? 0) * 3);
      col.push(ao, ao, ao);
    }
  }

  // Close the crown. An open cap leaves a 2cm hole, and with the hair material
  // double-sided that hole shows the inside of the shell.
  const last = rings[rings.length - 1];
  const tip = pos.length / 3;
  pos.push(last.p[0], last.p[1] + 0.004, last.p[2]);
  uv.push(0.5, 1);
  col.push(1, 1, 1);

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

  const top = (rings.length - 1) * stride;
  for (let i = 0; i < radial; i++) idx.push(top + i, tip, top + i + 1);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
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

/** Piecewise-linear profile lookup, matching the head's own. */
function profile(table, h) {
  for (let i = 1; i < table.length; i++) {
    if (h <= table[i][0]) {
      const [h0, v0] = table[i - 1];
      const [h1, v1] = table[i];
      return lerp(v0, v1, (h - h0) / (h1 - h0));
    }
  }
  return table[table.length - 1][1];
}

/**
 * @param {object} skull  { chin, height, profileW, profileD, S } in head-bone
 *   local space, so hair follows the same breadth/depth profiles the skull was
 *   actually built from rather than an ellipsoid approximation of it.
 *
 * `hairline` and `edge` are in TRUE height fraction, matching the head: 0.72 is
 * the front hairline, 0.565 the brow, 0.22 the nape.
 */
function capRings(skull, { hairline, thickness, steps = 14, edge = null, lump = null }) {
  const rings = [];
  const { chin, height, profileW, profileD, S } = skull;

  for (let i = 0; i <= steps; i++) {
    const k = i / steps;
    // Inflate off the scalp. A 3.6mm shell is a coat of paint, not a hair mass;
    // this is thickest across the crown and tapers to nothing at the hairline
    // so the edge disappears into the scalp.
    const inflate = 1 + thickness * Math.sin(Math.min(k * 1.15, 1) * Math.PI * 0.9);

    const hBase = lerp(hairline, 0.985, k);
    const at = (h) => [
      profile(profileW, h) * S * inflate,
      chin + h * height,
      profile(profileD, h) * S * inflate,
    ];
    const base = at(hBase);

    rings.push({
      p: [0, base[1], 0.012 * S],
      rx: Math.max(base[0], 0.002),
      rz: Math.max(base[2], 0.002),
      v: k,
      shape: (a) => {
        // Hair that hangs lower at the sides and the nape must travel *down the
        // skull's surface*. Translating the vertex down in Y instead moves it
        // inside the head, which is what made the first version shred through
        // the face.
        const drop = edge ? edge(a) : 0;
        const h = lerp(Math.max(hairline - drop, 0.06), 0.985, k);
        const q = at(h);
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

/**
 * Hairline shape, in height fraction below the front hairline. Front of head is
 * a = PI/2. A real hairline recedes at the temples, drops down the sideburn and
 * runs lowest at the nape.
 */
function hairline(temple, sideburn, nape) {
  return (a) => {
    const back = (1 - Math.sin(a)) * 0.5;      // 0 front, 1 nape
    const sideness = Math.abs(Math.cos(a));    // 1 at the ears
    return nape * back * back + sideburn * sideness + temple * sideness * Math.max(0, Math.sin(a));
  };
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
    build: (s) =>
      capRings(s, { hairline: 0.7, thickness: 0.018, edge: hairline(0.02, 0.08, 0.3) }),
  },
  {
    name: 'crop',
    weight: 4,
    build: (s) =>
      capRings(s, { hairline: 0.73, thickness: 0.055, edge: hairline(0.03, 0.12, 0.34) }),
  },
  {
    name: 'mop',
    weight: 3,
    // Fuller, hanging well down over the ears and the nape.
    build: (s) =>
      capRings(s, {
        hairline: 0.71,
        thickness: 0.1,
        steps: 16,
        edge: hairline(0.02, 0.24, 0.42),
      }),
  },
  {
    name: 'curls',
    weight: 2,
    // Volume plus a lumpy surface — the lumps are what read as curl at any
    // distance, since individual strands are not affordable here.
    build: (s) =>
      capRings(s, {
        hairline: 0.72,
        thickness: 0.13,
        steps: 16,
        edge: hairline(0.04, 0.2, 0.38),
        lump: (a, k) => 0.032 * Math.sin(a * 5 + k * 9) + 0.022 * Math.sin(a * 9 - k * 6),
      }),
  },
  {
    name: 'receding',
    weight: 2,
    // A widow's peak: the hairline sits high at the temples and dips at centre.
    build: (s) =>
      capRings(s, {
        hairline: 0.78,
        thickness: 0.04,
        edge: (a) => {
          const back = (1 - Math.sin(a)) * 0.5;
          const peak = 0.06 * lobe(a, Math.PI / 2, 0.28);
          return 0.34 * back * back + 0.1 * Math.abs(Math.cos(a)) + peak - 0.04;
        },
      }),
  },
  {
    name: 'bald',
    weight: 1,
    build: () => null,
  },
];

function bunGeometry(skull) {
  const rings = [];
  const steps = 8;
  const br = skull.height * 0.17;
  const cy = skull.chin + 0.72 * skull.height;
  const cz = -profile(skull.profileD, 0.66) * skull.S - br * 0.5;
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

  const key = `${style.name}:${bun}:${skull.height.toFixed(4)}`;
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
  const col = [];
  const idx = [];
  let offset = 0;
  for (const g of list) {
    const p = g.getAttribute('position');
    const t = g.getAttribute('uv');
    const cAttr = g.getAttribute('color');
    const i = g.getIndex();
    for (let n = 0; n < p.count; n++) pos.push(p.getX(n), p.getY(n), p.getZ(n));
    for (let n = 0; n < t.count; n++) uv.push(t.getX(n), t.getY(n));
    for (let n = 0; n < cAttr.count; n++) col.push(cAttr.getX(n), cAttr.getY(n), cAttr.getZ(n));
    for (let n = 0; n < i.count; n++) idx.push(i.getX(n) + offset);
    offset += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function disposeHairCache() {
  for (const g of CACHE.values()) if (g) g.dispose();
  CACHE.clear();
}
