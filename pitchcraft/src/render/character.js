import * as THREE from 'three';
import { PLAYER } from '../core/config.js';
import { hairFor } from './hair.js';
import {
  makeShirtBase,
  makeShirtTexture,
  makeFabricRoughness,
  makeHeadTexture,
  makeSkinRoughness,
  makeHeadNormal,
  makeCrestCanvas,
} from './textures.js';

/**
 * Procedural footballer — a skinned mesh with a real bone hierarchy.
 *
 * This replaces a rigid-segment rig (tapered cylinders with sphere joints).
 * That rig was cheap and never visibly came apart, but every limb was a
 * separate solid: a knee was two overlapping tubes and a ball, not a bending
 * surface. At broadcast distance it passed; anywhere closer it read as a
 * mannequin, which is exactly what it was.
 *
 * Here the body is one continuous skinned surface. Nothing is loaded — the
 * mesh, the skeleton and the skin weights are all generated at runtime from
 * the same `DIM` table the old rig used, so there is still no art asset in the
 * build and no external rig to license.
 *
 * How it is built:
 *
 *   1. `buildSkeleton()` creates bones whose names match the joints the
 *      animation layer already drives. `animation.js` is untouched by this
 *      change — it writes rotations into `built.joints.legL.knee` exactly as
 *      before, and now those rotations deform a surface instead of moving a
 *      solid.
 *
 *   2. The body is described as a list of *sections*, each an ordered stack of
 *      cross-section rings in bind space. A ring carries its position, an
 *      elliptical radius, up to two bone influences with weights, and which
 *      material it belongs to. `lathe()` turns consecutive rings into a tube.
 *
 *   3. Skin weights blend across a band spanning each joint, so an elbow or a
 *      knee bends as one skin rather than as two pieces pivoting. That blend
 *      band is the whole point of the exercise.
 *
 * Cost: one geometry shared by every player (skinning is per-bone-matrix, not
 * per-vertex-data), one skeleton each, and six materials each. Roughly 2.4k
 * triangles a player against the old rig's ~1.6k.
 */

const S = PLAYER.height / 1.82; // scale everything from the configured height

const DIM = {
  hipY: 0.92 * S,
  thigh: 0.44 * S,
  shin: 0.42 * S,
  footLen: 0.26 * S,
  footH: 0.08 * S,
  // Raised from 0.56: the collar sat 12.3cm below the chin, a neck-to-head
  // ratio of 0.62 where a real one is nearer 0.30.
  torso: 0.6 * S,
  neck: 0.07 * S,
  headR: 0.115 * S,
  upperArm: 0.29 * S,
  foreArm: 0.27 * S,
  // Biacromial breadth 39cm, which is the figure for a 1.82m male. At 0.152
  // this was 30.4cm — 24% narrow, and the cause of the sloping bottle
  // shoulders, since the arm only reached full width 18cm down the humerus.
  shoulderW: 0.195 * S,
  hipW: 0.105 * S,
  limbR: 0.058 * S,
  thighR: 0.082 * S,
};

/** Material slots, in the order their geometry groups are emitted. */
const SLOT = { shirt: 0, shorts: 1, socks: 2, skin: 3, boot: 4, hair: 5, face: 6 };

/**
 * Vertices around each cross-section. 12 was enough while every ring was a
 * plain ellipse; a sculpted face needs enough angular resolution to put a nose
 * between two cheeks, and 16 is the point where that stops reading as a wedge.
 * At 16 a player is ~3.2k triangles, which is squarely in the range the PS2-era
 * football games this is aiming at used.
 */
const RADIAL = 14;

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

/**
 * Bone names must match what `animation.js` expects. Positions are local to the
 * parent bone and define the bind pose that the mesh is generated against.
 */
function buildSkeleton() {
  const bone = (name, x, y, z) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    return b;
  };

  // Root of the rig. `animation.js` writes hipY straight into this.
  const hips = bone('hips', 0, DIM.hipY, 0);

  // The spine pivot sits at the hip pivot: a footballer bends from the waist,
  // and putting the pivot higher makes the whole torso swing like a mast.
  const spine = bone('spine', 0, 0, 0);
  hips.add(spine);

  const neck = bone('neck', 0, DIM.torso, 0);
  spine.add(neck);
  const head = bone('head', 0, DIM.neck, 0);
  neck.add(head);

  const arms = {};
  for (const [key, side] of [['armL', -1], ['armR', 1]]) {
    const shoulder = bone(`${key}.shoulder`, side * DIM.shoulderW, DIM.torso * 0.84, 0);
    spine.add(shoulder);
    const elbow = bone(`${key}.elbow`, 0, -DIM.upperArm, 0);
    shoulder.add(elbow);
    const hand = bone(`${key}.hand`, 0, -DIM.foreArm, 0);
    elbow.add(hand);
    arms[key] = { shoulder, elbow, hand };
  }

  const legs = {};
  for (const [key, side] of [['legL', -1], ['legR', 1]]) {
    const hip = bone(`${key}.hip`, side * DIM.hipW, -0.02 * S, 0);
    hips.add(hip);
    const knee = bone(`${key}.knee`, 0, -DIM.thigh, 0);
    hip.add(knee);
    const ankle = bone(`${key}.ankle`, 0, -DIM.shin, 0);
    knee.add(ankle);
    // `foot` is exposed for parity with the old rig; the animator drives ankle.
    const foot = bone(`${key}.foot`, 0, 0, DIM.footLen * 0.4);
    ankle.add(foot);
    legs[key] = { hip, knee, ankle, foot };
  }

  const joints = { hips, spine, neck, head, ...arms, ...legs };

  // Flat list in a stable order — bone indices in the geometry refer to it.
  const list = [
    hips,
    spine,
    neck,
    head,
    arms.armL.shoulder,
    arms.armL.elbow,
    arms.armL.hand,
    arms.armR.shoulder,
    arms.armR.elbow,
    arms.armR.hand,
    legs.legL.hip,
    legs.legL.knee,
    legs.legL.ankle,
    legs.legL.foot,
    legs.legR.hip,
    legs.legR.knee,
    legs.legR.ankle,
    legs.legR.foot,
  ];
  const index = new Map(list.map((b, i) => [b.name, i]));

  return { root: hips, joints, list, index };
}

/** Bind-pose position of a bone in model space, by name. */
function bindPositions(index) {
  const p = {};
  const armY = DIM.hipY + DIM.torso * 0.84;
  p.hips = [0, DIM.hipY, 0];
  p.spine = [0, DIM.hipY, 0];
  p.neck = [0, DIM.hipY + DIM.torso, 0];
  p.head = [0, DIM.hipY + DIM.torso + DIM.neck, 0];
  for (const [key, side] of [['armL', -1], ['armR', 1]]) {
    p[`${key}.shoulder`] = [side * DIM.shoulderW, armY, 0];
    p[`${key}.elbow`] = [side * DIM.shoulderW, armY - DIM.upperArm, 0];
    p[`${key}.hand`] = [side * DIM.shoulderW, armY - DIM.upperArm - DIM.foreArm, 0];
  }
  const legTop = DIM.hipY - 0.02 * S;
  for (const [key, side] of [['legL', -1], ['legR', 1]]) {
    p[`${key}.hip`] = [side * DIM.hipW, legTop, 0];
    p[`${key}.knee`] = [side * DIM.hipW, legTop - DIM.thigh, 0];
    p[`${key}.ankle`] = [side * DIM.hipW, legTop - DIM.thigh - DIM.shin, 0];
  }
  return p;
}


// ---------------------------------------------------------------------------
// Head sculpting
// ---------------------------------------------------------------------------

/**
 * A face is a set of local displacements at particular angles and heights.
 *
 * Angles: 0 is +X (the player's right), PI/2 is +Z, which is the direction he
 * faces — so the nose lives at PI/2 and the back of the skull at 3*PI/2.
 *
 * Heights use `h`, the head's own parameter: 0 at the jawline, 1 at the crown.
 * The head section's ring parameter `t` includes the neck, so h is derived from
 * it — and the head *texture* is mapped in `t`, which is what keeps the painted
 * eyes sitting on the modelled brow rather than beside it.
 */
const TAU = Math.PI * 2;

/** Gaussian falloff in angle, wrapping correctly around the seam. */
function lobe(a, centre, width) {
  let d = (a - centre) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return Math.exp(-(d / width) * (d / width));
}

/** Gaussian falloff in height. */
function band(h, centre, width) {
  const d = (h - centre) / width;
  return Math.exp(-d * d);
}

function headShape(h, HEAD_H, S, F) {
  // `h` is TRUE height fraction: 0 at the chin, 1 at the crown. Feature heights
  // below are human canon — eye line at the vertical midpoint, brow at 0.565,
  // mouth at 0.19 — which is only meaningful because h is now real height.
  const R = HEAD_H;

  return (a) => {
    let dz = 0;
    let dx = 0;
    let dy = 0;
    let scale = 1;

    const front = lobe(a, Math.PI / 2, 1.1);

    // --- chin and mandible -------------------------------------------------
    // The lathe's lowest ring is the jawline. A chin is a *front* feature, so
    // it is pulled down and forward out of that ring rather than being a ring
    // of its own — a horizontal ring can never be a chin.
    const low = band(h, 0.1, 0.09);
    dy -= R * 0.085 * F.chin * low * lobe(a, Math.PI / 2, 0.9);
    dz += R * 0.045 * F.chin * low * lobe(a, Math.PI / 2, 0.65);
    // Mandible angle: the jaw corner, which is a real landmark and not a curve.
    const jawSide = lobe(a, 0.72, 0.3) + lobe(a, 2.42, 0.3);
    scale += 0.05 * jawSide * band(h, 0.26, 0.08);
    dy -= R * 0.028 * jawSide * band(h, 0.22, 0.08);

    // --- brow --------------------------------------------------------------
    dz += R * 0.055 * F.brow * lobe(a, Math.PI / 2, 0.95) * band(h, 0.565, 0.055);
    dz += R * 0.03 * F.brow * (lobe(a, 1.05, 0.3) + lobe(a, 2.09, 0.3)) * band(h, 0.565, 0.05);

    // --- eye sockets -------------------------------------------------------
    // Set back under the brow. A real orbit is 12-15mm deep; 6.6mm read as
    // painted-on eyes sitting on a smooth curve.
    dz -= R * 0.055 * (lobe(a, 1.2252, 0.24) + lobe(a, 1.9164, 0.24)) * band(h, 0.5, 0.055);

    // --- nose --------------------------------------------------------------
    // These bands overlap, so the magnitudes are set so their SUM is a real
    // nose (~2.5cm) rather than each being one.
    dz += R * 0.05 * F.noseProj * lobe(a, Math.PI / 2, 0.26) * band(h, 0.44 * F.noseLen, 0.07);
    dz += R * 0.1 * F.noseProj * lobe(a, Math.PI / 2, 0.2) * band(h, 0.33 * F.noseLen, 0.05);
    dz += R * 0.06 * F.noseProj * lobe(a, Math.PI / 2, 0.3) * band(h, 0.28 * F.noseLen, 0.04);
    dx += R * 0.03 * F.noseW * (lobe(a, 1.34, 0.15) - lobe(a, 1.8, 0.15)) * band(h, 0.28, 0.03);

    // --- lips --------------------------------------------------------------
    dz += R * 0.04 * F.lips * lobe(a, Math.PI / 2, 0.42) * band(h, 0.215, 0.025);
    dz += R * 0.05 * F.lips * lobe(a, Math.PI / 2, 0.38) * band(h, 0.17, 0.024);
    dz -= R * 0.025 * lobe(a, Math.PI / 2, 0.48) * band(h, 0.192, 0.013);
    // Philtrum groove.
    dz -= R * 0.016 * lobe(a, Math.PI / 2, 0.12) * band(h, 0.245, 0.025);

    // --- cheeks ------------------------------------------------------------
    const side = lobe(a, 1.0, 0.4) + lobe(a, 2.14, 0.4);
    scale += 0.045 * F.cheek * side * band(h, 0.44, 0.08);
    scale -= 0.03 * side * band(h, 0.3, 0.07);

    // --- occiput and nape --------------------------------------------------
    dz -= R * 0.03 * lobe(a, -Math.PI / 2, 1.0) * band(h, 0.62, 0.22);
    dz += R * 0.04 * lobe(a, -Math.PI / 2, 0.8) * band(h, 0.24, 0.1);

    // Temples flatten rather than bulging.
    scale -= 0.025 * front * band(h, 0.66, 0.07);

    return { dx, dy, dz, scale };
  };
}

/**
 * Ears.
 *
 * A 9mm bulge on the UV seam is not an ear, and the ear is one of the strongest
 * reads on a head in three-quarter and profile — both reference frames turn on
 * it. This builds them as their own small lathes: 6.2 x 3.4cm, standing 20mm
 * off the skull, tilted back 12 degrees, spanning h 0.30 to 0.565.
 */
function addEars(m, { chinY, HEAD_H, S, widthAt }) {
  // `axis: 'x'` sweeps each ring in the YZ plane and steps successive rings
  // along X — so the rings must march *outward from the skull*, not down the
  // side of it. The first version stepped them down in Y, which collapsed the
  // ear into a flat ribbon at constant x and made it invisible.
  const midH = 0.43;
  const earCy = chinY + midH * HEAD_H;
  const skullX = widthAt(midH);

  for (const sideSign of [-1, 1]) {
    const rings = [];
    const STEPS = 4;
    for (let i = 0; i <= STEPS; i++) {
      const t = i / STEPS;
      // Projection: 20mm off the skull, starting just inside it so the root
      // is buried and there is no visible join.
      const x = sideSign * (skullX * 0.94 + t * 0.021 * S);
      // 6.2 x 3.4cm, shrinking toward the outer rim.
      const tall = (0.031 - t * t * 0.009) * S;
      const deep = (0.017 - t * t * 0.005) * S;
      rings.push({
        p: [x, earCy, -0.013 * S - t * 0.005 * S],
        rx: tall,
        rz: deep,
        axis: 'x',
        w: [['head', 1]],
        slot: SLOT.face,
        v: 0.42,
        radial: 10,
        // A plain patch of cheek skin, behind the ear's own position.
        uvFixed: [0.34, 0.42],
        // Lobe at the bottom, helix flaring at the top-back: an ear is not an
        // ellipse, and the asymmetry is most of what reads as one.
        shape: (a) => ({
          dy: -0.004 * S * Math.max(0, -Math.sin(a)),
          dz: -0.004 * S * Math.max(0, Math.sin(a)) * (1 - t),
        }),
      });
    }
    const end = m.lathe(rings);
    m.cap(
      end,
      [sideSign * (skullX * 0.94 + 0.023 * S), earCy, -0.016 * S],
      SLOT.face,
      [['head', 1]],
      10
    );
  }
}

// ---------------------------------------------------------------------------
// Mesh generation
// ---------------------------------------------------------------------------

/**
 * Accumulates rings into interleaved geometry buffers.
 *
 * A ring is `{ p:[x,y,z], rx, rz, w:[[boneName, weight], ...], slot, v, axis }`.
 * `axis` selects the plane the ring is swept in: 'y' for a vertical limb (the
 * default) and 'z' for the foot, which runs forward rather than down.
 */
class MeshBuilder {
  constructor(boneIndex) {
    this.boneIndex = boneIndex;
    this.pos = [];
    this.uv = [];
    this.skinIndex = [];
    this.skinWeight = [];
    // Per-vertex ambient occlusion, written into a `color` attribute.
    //
    // Every crease on a clothed body — armpit, jaw underside, eye socket,
    // sleeve hem, sock top, crotch — had exactly zero contact shading, because
    // a directional light rig cannot produce any. Baking it per vertex costs
    // ~38kB and no draw calls, and it is what stops the body reading as one
    // continuous inflated surface.
    this.ao = [];
    // One index array per material slot, so the whole body is one geometry
    // with six groups rather than six meshes.
    this.indices = Array.from({ length: 7 }, () => []);
  }

  /**
   * Emit one ring's vertices and return the index of its first vertex.
   *
   * `r.shape(angle, ring)` optionally returns `{ dx, dy, dz, scale }` to push
   * individual vertices off the base ellipse. That is what turns a stack of
   * ellipses into a face: a brow ridge, a nose and a jaw are all local
   * displacements at particular angles, and without it every head this
   * generator can make is an egg.
   *
   * Angle convention: 0 is +X, PI/2 is +Z, which is the direction the player
   * faces. So the front of the head is at `a = PI/2`.
   */
  ring(r) {
    const base = this.pos.length / 3;
    const [x, y, z] = r.p;
    const axis = r.axis || 'y';
    // Sections choose their own angular resolution. A shin reads fine at 16;
    // a face needs enough vertices to put nostrils, lips and an eye socket
    // between the cheeks, and starving it is what makes a head look moulded.
    const n = r.radial || RADIAL;
    for (let i = 0; i <= n; i++) {
      // The seam vertex is duplicated so U can run 0..1 without wrapping.
      // The seam duplicates a vertex, and computeVertexNormals() averages each
      // copy over only its own half of the surrounding faces — so the seam is a
      // visible lighting crease. `seam` rotates where it falls; the head puts it
      // at the occiput, under the hair, instead of down the side of the face.
      const a = (i / n) * Math.PI * 2 + (r.seam || 0);
      const c = Math.cos(a);
      const s = Math.sin(a);
      const mod = r.shape ? r.shape(a) : null;
      const k = mod && mod.scale !== undefined ? mod.scale : 1;
      const dx = mod && mod.dx ? mod.dx : 0;
      const dy = mod && mod.dy ? mod.dy : 0;
      const dz = mod && mod.dz ? mod.dz : 0;
      if (axis === 'y') this.pos.push(x + c * r.rx * k + dx, y + dy, z + s * r.rz * k + dz);
      else if (axis === 'x') this.pos.push(x + dx, y + c * r.rx * k + dy, z + s * r.rz * k + dz);
      else this.pos.push(x + c * r.rx * k + dx, y + s * r.rz * k + dy, z + dz);
      // `uvFixed` pins every vertex in the ring to one texel. The ears need it:
      // u runs 0..1 across each ring, so a 3.4cm ear tab was sampling the entire
      // head map and came out banded with the nose highlight and eye washes.
      if (r.uvFixed) this.uv.push(r.uvFixed[0], r.uvFixed[1]);
      else this.uv.push(i / n, r.v ?? 0);
      const ao = typeof r.ao === 'function' ? r.ao(a) : r.ao ?? 1;
      this.ao.push(ao, ao, ao);

      const w = r.w;
      const i0 = this.boneIndex.get(w[0][0]);
      const i1 = w[1] ? this.boneIndex.get(w[1][0]) : 0;
      this.skinIndex.push(i0, i1, 0, 0);
      this.skinWeight.push(w[0][1], w[1] ? w[1][1] : 0, 0, 0);
    }
    return base;
  }

  /** Quad strip between two already-emitted rings of equal resolution. */
  connect(a, b, slot, n = RADIAL) {
    const idx = this.indices[slot];
    for (let i = 0; i < n; i++) {
      const a0 = a + i;
      const a1 = a + i + 1;
      const b0 = b + i;
      const b1 = b + i + 1;
      idx.push(a0, b0, a1);
      idx.push(a1, b0, b1);
    }
  }

  /** Sweep a whole stack of rings into a tube. */
  lathe(rings) {
    let prev = null;
    let prevSlot = null;
    for (const r of rings) {
      const base = this.ring(r);
      if (prev !== null) this.connect(prev, base, r.slot ?? prevSlot, r.radial || RADIAL);
      prev = base;
      prevSlot = r.slot;
    }
    return prev;
  }

  /** Close a tube end with a fan to a single point. */
  cap(ringBase, point, slot, weights, n = RADIAL) {
    const tip = this.pos.length / 3;
    this.pos.push(point[0], point[1], point[2]);
    this.uv.push(0.5, 0.5);
    this.ao.push(1, 1, 1);
    const i0 = this.boneIndex.get(weights[0][0]);
    const i1 = weights[1] ? this.boneIndex.get(weights[1][0]) : 0;
    this.skinIndex.push(i0, i1, 0, 0);
    this.skinWeight.push(weights[0][1], weights[1] ? weights[1][1] : 0, 0, 0);
    const idx = this.indices[slot];
    for (let i = 0; i < n; i++) idx.push(ringBase + i, tip, ringBase + i + 1);
    return tip;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.ao, 3));
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(this.skinIndex, 4));
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(this.skinWeight, 4));

    const all = [];
    let start = 0;
    for (let slot = 0; slot < this.indices.length; slot++) {
      const list = this.indices[slot];
      if (!list.length) {
        g.addGroup(start, 0, slot);
        continue;
      }
      all.push(...list);
      g.addGroup(start, list.length, slot);
      start += list.length;
    }
    g.setIndex(all);
    g.computeVertexNormals();
    return g;
  }
}

/**
 * Weight blend across a joint.
 *
 * `t` is the fraction along a bone segment from parent joint to child joint.
 * Everything up to `1 - band` is rigidly the parent bone; over the last `band`
 * of the segment the child bone takes over, reaching an even split exactly at
 * the joint. The next segment mirrors it. That symmetric band is what makes a
 * bent elbow a continuous surface instead of a crease.
 */
function jointWeights(parent, child, t, band = 0.34) {
  if (t <= 1 - band) return [[parent, 1]];
  const k = (t - (1 - band)) / band; // 0 at band start, 1 at the joint
  const c = 0.5 * (k * k * (3 - 2 * k)); // eased, exactly 0.5 at the joint
  return [
    [parent, 1 - c],
    [child, c],
  ];
}

/** Mirror of `jointWeights` for the far side of a joint. */
function jointWeightsAfter(prev, current, t, band = 0.3) {
  if (t >= band) return [[current, 1]];
  const k = t / band;
  const c = 0.5 - 0.5 * (k * k * (3 - 2 * k));
  return [
    [current, 1 - c],
    [prev, c],
  ];
}

const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Build the shared body geometry. Identical for every player, so it is built
 * exactly once and reused — skinning varies per player through the skeleton's
 * bone matrices, not through vertex data.
 */
/**
 * Face variants.
 *
 * The body geometry was a single module-level singleton, so every player in the
 * match had the identical skull, nose, jaw and brow. Two men who differ only in
 * skin tone and shirt colour read as one man rendered twice — and at fourteen
 * players that is the single most damaging thing about the squad.
 *
 * A face is now a small parameter vector, and the geometry cache is keyed on
 * it. Eight variants is enough that no two players on the pitch share a face
 * while the memory stays trivial: a body is ~3.5k vertices, so eight of them is
 * under 2MB, and they are still shared across everyone who draws that variant.
 */
const FACE_VARIANTS = 8;

function faceParams(index) {
  // Deterministic per variant, and spread rather than random so the eight
  // faces are actually distinguishable instead of eight samples of the mean.
  const r = (n) => {
    const v = Math.sin(index * 127.1 + n * 311.7) * 43758.5453;
    return (v - Math.floor(v)) * 2 - 1;
  };
  return {
    cranialW: 1 + r(1) * 0.06,
    cranialD: 1 + r(2) * 0.05,
    jawW: 1 + r(3) * 0.1,
    chin: 1 + r(4) * 0.25,
    brow: 1 + r(5) * 0.35,
    noseLen: 1 + r(6) * 0.15,
    noseW: 1 + r(7) * 0.18,
    noseProj: 1 + r(8) * 0.2,
    lips: 1 + r(9) * 0.2,
    cheek: 1 + r(10) * 0.3,
  };
}

/** Geometry cache, one entry per face variant. */
const GEO_CACHE = new Map();
let SKULL = null;

function bodyGeometry(boneIndex, variant) {
  if (GEO_CACHE.has(variant)) return GEO_CACHE.get(variant);
  const F = faceParams(variant);

  const m = new MeshBuilder(boneIndex);
  const P = bindPositions(boneIndex);

  // --- torso ---------------------------------------------------------------
  // One tube from the crotch to the neck. The waist is the narrowest point and
  // the chest the widest, which is what separates a footballer's silhouette
  // from a barrel.
  const crotchY = DIM.hipY - 0.115 * S;
  const neckY = DIM.hipY + DIM.torso;
  const torsoRings = [];
  const TORSO_STEPS = 22;
  for (let i = 0; i <= TORSO_STEPS; i++) {
    const t = i / TORSO_STEPS;
    const y = lerp(crotchY, neckY, t);
    // Profile keyed off height up the torso.
    let rx;
    if (t < 0.16) rx = lerp(0.1, 0.145, t / 0.16); // pelvis flares out
    else if (t < 0.42) rx = lerp(0.145, 0.128, (t - 0.16) / 0.26); // waist
    // The chest must stay narrower than the shoulder joints sit apart
    // (DIM.shoulderW = 0.152), or the arms hang *inside* the ribcage. At 0.178
    // only 2.7cm of sleeve ever cleared the torso silhouette, so every player
    // appeared to be playing in a vest.
    else if (t < 0.74) rx = lerp(0.128, 0.168, (t - 0.42) / 0.32); // chest
    else if (t < 0.9) rx = lerp(0.168, 0.15, (t - 0.74) / 0.16); // trapezius
    else rx = lerp(0.15, 0.07, (t - 0.9) / 0.1); // into the neck
    rx *= S;
    const rz = rx * (t < 0.42 ? 0.78 : 0.68);

    // Below the waist the pelvis is rigid to `hips`; above it the spine takes
    // over. The blend band is generous so bending at the waist does not pinch.
    let w;
    const waist = 0.3;
    if (t < waist) w = [['hips', 1]];
    else if (t < waist + 0.22) {
      const k = (t - waist) / 0.22;
      w = [['hips', 1 - k], ['spine', k]];
    } else if (t > 0.9) {
      const k = (t - 0.9) / 0.1;
      w = [['spine', 1 - k * 0.45], ['neck', k * 0.45]];
    } else w = [['spine', 1]];

    // Shorts to the waist, shirt above it. The shirt texture's V runs hem (0)
    // to collar (1), so V is mapped over the shirt portion only.
    const slot = t < 0.34 ? SLOT.shorts : SLOT.shirt;
    const v = t < 0.34 ? 0 : (t - 0.34) / 0.66;
    torsoRings.push({
      p: [0, y, 0],
      rx,
      rz,
      w,
      slot,
      v,
      // Torso form.
      //
      // The chest is the largest single area of a player on screen, and a
      // smooth tapered tube is the most obviously synthetic thing about it —
      // a shirt drapes over a ribcage, not a barrel. None of this is visible
      // as anatomy under a kit; what it does is give the shirt somewhere for
      // light to fall off, which is what makes fabric read as fabric.
      shape: (a) => {
        let dz = 0;
        let dx = 0;
        let scale = 1;

        // Pectorals: two shallow bulges on the upper chest with the sternum
        // channel between them.
        const pec = (lobe(a, 1.16, 0.34) + lobe(a, 1.98, 0.34)) * band(t, 0.7, 0.09);
        dz += 0.02 * S * pec;
        dz -= 0.011 * S * lobe(a, Math.PI / 2, 0.16) * band(t, 0.68, 0.11);

        // Latissimus flare: the back widens toward the armpit.
        const lat = (lobe(a, 0.35, 0.5) + lobe(a, 2.79, 0.5)) * band(t, 0.66, 0.13);
        scale += 0.045 * lat;

        // Spine groove and the shoulder blades either side of it.
        dz += 0.014 * S * lobe(a, -Math.PI / 2, 0.14) * band(t, 0.66, 0.2);
        dz -= 0.012 * S * (lobe(a, -1.24, 0.3) + lobe(a, -1.9, 0.3)) * band(t, 0.72, 0.08);

        // Abdomen: a soft centre line and the slight tuck above the hips.
        dz -= 0.007 * S * lobe(a, Math.PI / 2, 0.2) * band(t, 0.5, 0.12);
        scale -= 0.02 * band(t, 0.44, 0.08);

        // Iliac flare where the pelvis widens under the waist.
        scale += 0.03 * band(t, 0.24, 0.07);

        return { dx, dz, scale };
      },
    });
  }
  m.lathe(torsoRings);
  // No cap at the top: the neck section below starts at the same radius and
  // the same height, so chest and neck read as one continuous surface.
  // Crotch cap, so the pelvis is closed.
  const crotchRing = m.ring({ ...torsoRings[0], v: 0 });
  m.cap(crotchRing, [0, crotchY - 0.02 * S, 0], SLOT.shorts, [['hips', 1]]);

  // --- neck and head -------------------------------------------------------
  //
  // The head is parametrised by *true height fraction* h: 0 at the chin,
  // 1 at the crown.
  //
  // It previously used the polar angle of an ellipsoid sweep as if it were
  // height. It is not — for y = cy - R*cos(phi), dY/dphi vanishes at the poles,
  // so a feature placed at "h = 0.54" actually landed at 70% of head height.
  // Measured against the code as it stood: eye line 0.70 (human 0.50), brow
  // 0.80 (0.565), nose tip 0.565 (0.30). The braincase above the brow came out
  // at 21% of head height against a human 43%. That single mis-assumption
  // produced the missing forehead, the missing chin, the high eyes and the
  // egg-shaped skull simultaneously.
  //
  // Breadth and depth are now explicit profiles keyed on h as well. A sin(phi)
  // profile puts the widest ring at 37% of head height — nose-base level —
  // where a human's widest point is the parietal eminence at ~68%.
  const HEAD_H = 0.22 * S;      // chin to crown
  const CROWN_Y = PLAYER.height * 0.99;
  const CHIN_Y = CROWN_Y - HEAD_H;
  // The lathe's lowest ring is the jawline; the chin is sculpted down from it,
  // because a chin is a front feature and a horizontal ring cannot be one.
  // The lowest ring was at 0.18 and the chin sculpt pulled it down to only
  // h = 0.095, so the rendered head came out 19.9cm against the 22cm these
  // tables assume — which put the mouth at 10.5% of head height instead of
  // 19%. Starting the stack lower, with the chin band centred on it, lands the
  // real chin at h ~ 0.015.
  const JAW_H = 0.1;

  /** Piecewise-linear profile lookup. */
  const profile = (table, h) => {
    for (let i = 1; i < table.length; i++) {
      if (h <= table[i][0]) {
        const [h0, v0] = table[i - 1];
        const [h1, v1] = table[i];
        return lerp(v0, v1, (h - h0) / (h1 - h0));
      }
    }
    return table[table.length - 1][1];
  };
  // Half-widths and half-depths in metres, from anthropometric proportions for
  // a 1.82m adult: 15.2cm max breadth at the parietals, 19cm max depth.
  const HEAD_W = [
    [0.0, 0.039], [0.18, 0.056], [0.3, 0.061], [0.5, 0.068],
    [0.68, 0.076], [0.86, 0.063], [0.92, 0.052], [0.97, 0.032], [1.0, 0.004],
  ];
  const HEAD_D = [
    [0.0, 0.048], [0.3, 0.0775], [0.58, 0.095], [0.82, 0.085], [0.9, 0.068],
    [0.97, 0.04], [1.0, 0.004],
  ];

  // Seam at the occiput so its normal crease hides under hair.
  const SEAM = -Math.PI / 2;
  const FACE_RADIAL = 20;
  const headRings = [];

  // Neck: a column from the shoulders up into the jaw.
  // The junction ring sits at chin height, where the neck is hidden behind the
  // jaw, so it is narrower than a neck's true girth; the rings below it flare.
  const neckR = 0.048 * S;
  const jawRingY = CHIN_Y + JAW_H * HEAD_H;
  for (let i = 0; i <= 3; i++) {
    const t = i / 3;
    headRings.push({
      p: [0, lerp(DIM.hipY + DIM.torso - 0.015 * S, jawRingY, t), -0.03 * S * t],
      rx: lerp(0.07 * S, neckR, t),
      rz: lerp(0.075 * S, neckR * 1.06, t),
      w: t < 0.4 ? [['neck', 1]] : [['neck', 1 - (t - 0.4) / 0.6], ['head', (t - 0.4) / 0.6]],
      slot: SLOT.face,
      v: 0.02,
      radial: FACE_RADIAL,
      seam: SEAM,
      // The neck is shadowed by the jaw above and the collar below.
      ao: 1 - 0.16 * (1 - t) - 0.13 * t,
    });
  }

  const HEAD_STEPS = 18;
  for (let i = 0; i <= HEAD_STEPS; i++) {
    const k = i / HEAD_STEPS;
    const h = lerp(JAW_H, 1, k);
    const y = CHIN_Y + h * HEAD_H;
    // The face carries further forward of the neck axis than the occiput
    // carries back, so the whole ellipse is offset forward.
    // Cranial width and depth vary above the brow; the jaw varies below it,
    // so a broad-skulled player is not automatically a broad-jawed one.
    const upper = Math.min(1, Math.max(0, (h - 0.4) / 0.3));
    const wScale = lerp(F.jawW, F.cranialW, upper);
    const rx = Math.max(profile(HEAD_W, h) * S * wScale, 0.003 * S);
    const rz = Math.max(profile(HEAD_D, h) * S * lerp(1, F.cranialD, upper), 0.003 * S);
    headRings.push({
      p: [0, y, 0.012 * S],
      rx,
      rz,
      w: k < 0.1 ? [['neck', 0.35], ['head', 0.65]] : [['head', 1]],
      // Eye sockets, under the jaw, and where the ear meets the skull.
      ao: (a) =>
        1 -
        0.16 * (lobe(a, 1.2252, 0.24) + lobe(a, 1.9164, 0.24)) * band(h, 0.5, 0.05) -
        0.14 * band(h, 0.2, 0.06) -
        0.08 * (lobe(a, 0, 0.3) + lobe(a, Math.PI, 0.3)) * band(h, 0.43, 0.07),
      slot: SLOT.face,
      // V is the head's true height fraction, so the painted eyes land on the
      // modelled brow rather than 20% of a head above it.
      v: h,
      radial: FACE_RADIAL,
      seam: SEAM,
      shape: headShape(h, HEAD_H, S, F),
    });
  }
  const crownRing = m.lathe(headRings);
  // Both lathes were left open, leaving an 8mm hole in the crown of every
  // skull — visible straight through on the bald variants.
  m.cap(
    crownRing,
    [0, CHIN_Y + HEAD_H, 0.012 * S],
    SLOT.face,
    [['head', 1]],
    FACE_RADIAL
  );
  addEars(m, {
    chinY: CHIN_Y,
    HEAD_H,
    S,
    widthAt: (hh) => profile(HEAD_W, hh) * S,
  });
  // Record for hair.js, in head-bone local space (the head bone sits at neckTop).
  const neckTop = DIM.hipY + DIM.torso + DIM.neck;
  SKULL = {
    chin: CHIN_Y - neckTop,
    height: HEAD_H,
    profileW: HEAD_W,
    profileD: HEAD_D,
    S,
  };

  // --- arms ----------------------------------------------------------------
  for (const key of ['armL', 'armR']) {
    const sh = P[`${key}.shoulder`];
    const el = P[`${key}.elbow`];
    const hd = P[`${key}.hand`];
    const rings = [];

    // Upper arm. The first rings sit *inside* the torso and are weighted to the
    // spine, so the shoulder is a smooth deltoid rather than a ball stuck on.
    // Deltoid cap: three rings above the humerus so the shoulder has a mass
    // of its own rather than the arm simply starting below the trapezius.
    for (let i = 0; i < 3; i++) {
      const t = i / 3;
      rings.push({
        p: [lerp(sh[0] * 0.62, sh[0] * 0.92, t), sh[1] + lerp(0.052, 0.02, t) * S, 0],
        rx: lerp(0.055, 0.07, t) * S,
        rz: lerp(0.055, 0.068, t) * S,
        w: [['spine', 1 - t * 0.75], [`${key}.shoulder`, t * 0.75]],
        slot: SLOT.shirt,
        v: 0.62,
        ao: 1 - 0.1 * (1 - t),
      });
    }

    const UP_STEPS = 9;
    for (let i = 0; i <= UP_STEPS; i++) {
      const t = i / UP_STEPS;
      const y = lerp(sh[1] + 0.012 * S, el[1], t);
      const x = lerp(sh[0] * 0.92, el[0], Math.min(t * 1.6, 1));
      const r = lerp(0.062, 0.046, t) * S;
      let w;
      if (t < 0.14) {
        const k = t / 0.14;
        w = [['spine', 1 - k], [`${key}.shoulder`, k]];
      } else {
        const u = (t - 0.14) / 0.86;
        w = jointWeights(`${key}.shoulder`, `${key}.elbow`, u);
      }
      // Sleeve over the top 62% of the upper arm — a short sleeve ends around
      // mid-bicep, and the part nearest the shoulder is hidden by the chest.
      const sleeve = t < 0.62;
      rings.push({
        p: [x, y, 0],
        rx: r,
        rz: r * 0.94,
        w,
        // Armpit is the deepest crease on a clothed figure, and the sleeve
        // hem sits in its own shadow.
        ao: (a) =>
          1 -
          0.26 * band(t, 0.06, 0.16) * lobe(a, key === 'armL' ? 0 : Math.PI, 1.0) -
          0.12 * band(t, 0.62, 0.05),
        slot: sleeve ? SLOT.shirt : SLOT.skin,
        // Sample the *body* of the shirt, not the yoke or the trim.
        //
        // This previously ran V from 0.88 to 0.93, which lands squarely on the
        // narrow accent trim band — and Ironmoor's accent is a pale peach, so
        // every away player wore sleeves the exact colour of bare skin. Mapping
        // into mid-torso instead is both robust to any palette and better
        // looking: the body stripes run out along the sleeve.
        v: sleeve ? lerp(0.62, 0.45, t / 0.62) : 0,
      });
    }

    // Forearm, tapering to the wrist.
    const LOW_STEPS = 8;
    for (let i = 1; i <= LOW_STEPS; i++) {
      const t = i / LOW_STEPS;
      const y = lerp(el[1], hd[1], t);
      const r = lerp(0.044, 0.033, t) * S;
      rings.push({
        p: [el[0], y, 0],
        rx: r,
        rz: r * 0.92,
        w: jointWeightsAfter(`${key}.shoulder`, `${key}.elbow`, t),
        slot: SLOT.skin,
        v: 0,
      });
    }

    // Hand.
    //
    // A hand is not a bulb: it is flat, wider than it is thick, it broadens at
    // the knuckles before tapering to the fingertips, and it has a thumb on the
    // inside edge. Modelling individual fingers is not worth the triangles at
    // any distance this game uses, but the *silhouette* — flat, broad, thumbed —
    // is, and a rounded stub is one of the things that most says "mannequin".
    const side = key === 'armL' ? -1 : 1;
    const HAND_LEN = 0.185 * S;
    for (let i = 1; i <= 7; i++) {
      const t = i / 7;
      const y = hd[1] - t * HAND_LEN;
      // Narrow wrist, widest across the knuckles at t ~ 0.42, tapering out.
      const w =
        t < 0.42
          ? lerp(0.036, 0.052, t / 0.42)
          : lerp(0.052, 0.028, (t - 0.42) / 0.58);
      // Thickness stays roughly constant then thins toward the fingertips.
      const thick = lerp(0.021, 0.012, Math.max(0, (t - 0.4) / 0.6)) * S;
      rings.push({
        p: [hd[0], y, 0],
        rx: w * S,
        rz: thick,
        w: [[`${key}.hand`, 1]],
        slot: SLOT.skin,
        v: 0,
        // Thumb: a bulge on the inside edge of the hand, near the wrist. Angles
        // are in the ring's own frame, so the inside edge is +X on the left arm
        // and -X on the right.
        shape: (a) => {
          const inner = lobe(a, side < 0 ? 0 : Math.PI, 0.5);
          const at = band(t, 0.3, 0.16);
          return {
            dx: -side * 0.028 * S * inner * at,
            dz: -0.006 * S * inner * at,
          };
        },
      });
    }
    const armEnd = m.lathe(rings);
    m.cap(armEnd, [hd[0], hd[1] - HAND_LEN - 0.012 * S, 0], SLOT.skin, [[`${key}.hand`, 1]]);
  }

  // --- legs ----------------------------------------------------------------
  for (const key of ['legL', 'legR']) {
    const hip = P[`${key}.hip`];
    const knee = P[`${key}.knee`];
    const ankle = P[`${key}.ankle`];
    const rings = [];

    // Thigh. Again the top rings sit inside the pelvis, weighted to `hips`, so
    // the hip crease never opens up.
    const TH_STEPS = 10;
    for (let i = 0; i <= TH_STEPS; i++) {
      const t = i / TH_STEPS;
      const y = lerp(hip[1] + 0.075 * S, knee[1], t);
      const x = lerp(hip[0] * 0.72, knee[0], Math.min(t * 2.2, 1));
      // Quadriceps carry real mass; the first pass had them at 0.098 tapering
      // hard, which read as stilts under a short pair of shorts.
      const r = lerp(0.112, 0.072, t * t) * S;
      let w;
      if (t < 0.2) {
        const k = t / 0.2;
        w = [['hips', 1 - k], [`${key}.hip`, k]];
      } else {
        const u = (t - 0.2) / 0.8;
        w = jointWeights(`${key}.hip`, `${key}.knee`, u);
      }
      // Shorts to just above mid-thigh.
      rings.push({
        p: [x, y, 0],
        rx: r,
        rz: r * 0.95,
        w,
        // Football shorts end just above the knee, not at the hip.
        slot: t < 0.66 ? SLOT.shorts : SLOT.skin,
        v: 0,
      });
    }

    // Shin: calf bulge near the top, tapering to a narrow ankle.
    const SH_STEPS = 10;
    for (let i = 1; i <= SH_STEPS; i++) {
      const t = i / SH_STEPS;
      const y = lerp(knee[1], ankle[1], t);
      // Calf peaks at about a quarter of the way down.
      // Calf bulge near the top, a shinpad bulge on the front of the lower
      // shin, and the sock's turnover just under the knee.
      const r =
        (0.068 +
          Math.sin(Math.min(t * 3.2, Math.PI)) * 0.019 -
          t * 0.028 +
          band(t, 0.24, 0.07) * 0.006) *
        S;
      rings.push({
        p: [knee[0], y, t < 0.3 ? 0 : -0.004 * S],
        rx: r,
        rz: r * 1.02,
        w: jointWeightsAfter(`${key}.hip`, `${key}.knee`, t),
        // Sock over the lower 80% of the shin, bare calf above it.
        slot: t < 0.2 ? SLOT.skin : SLOT.socks,
        v: 0,
        ao: 1 - 0.22 * band(t, 0.2, 0.06) - 0.12 * band(t, 0.02, 0.05),
        // Shinpad: a flat plate on the front of the lower shin, which is a
        // real bulge every footballer has and reads even in silhouette.
        shape: (a) => ({
          dz: 0.012 * S * lobe(a, Math.PI / 2, 0.75) * band(t, 0.62, 0.24),
        }),
      });
    }

    // Boot: rings swept in the XY plane so the tube runs forward, not down.
    //
    // A football boot is a distinct shape and worth the handful of extra rings:
    // a raised heel counter at the back, an instep that dips over the laces,
    // and a low flat toe box. A plain tapered tube reads as a slipper.
    // The sole must sit ON the turf. It was at y = -0.042 — every boot in every
    // frame was 4.2cm underground, which is a gameplay-distance fault, not a
    // close-up one. `footY` is now derived from the deepest point of the ring
    // profile so the sole lands at y = 0.
    const SOLE_DROP = 0.052 * S;
    const footY = SOLE_DROP - 0.014 * S;
    const FOOT_STEPS = 10;
    for (let i = 0; i <= FOOT_STEPS; i++) {
      const t = i / FOOT_STEPS;
      const z = lerp(-DIM.footLen * 0.34, DIM.footLen * 0.74, t);
      // Widest across the ball of the foot, narrowing at heel and toe.
      const w = (0.036 + Math.sin(Math.min(t * 1.5, 1) * Math.PI * 0.85) * 0.016 - t * t * 0.014) * S;
      // Tall at the heel counter, dipping over the instep, flat at the toe.
      const h =
        (0.052 - Math.sin(Math.max(0, (t - 0.15)) * 2.6) * 0.018 - t * 0.012) * S;
      rings.push({
        p: [knee[0], footY + (1 - t) * 0.014 * S, z],
        rx: w,
        rz: Math.max(h, 0.012 * S),
        axis: 'z',
        w: t < 0.25 ? jointWeightsAfter(`${key}.knee`, `${key}.ankle`, t) : [[`${key}.ankle`, 1]],
        slot: SLOT.boot,
        v: 0,
        // Flatten the underside: a sole is flat, not a cylinder bottom.
        // Flatten the underside: a sole is flat, not a cylinder bottom. Clamped
        // against world y so the flat runs true whatever the ring's height is.
        // Flatten the underside onto the turf. The previous clamp was
        // `Math.max(0, -yAt)` — it lifted vertices out of the ground but never
        // lowered them onto it, so only the heel touched and the forefoot
        // floated 1.3cm for 85% of the boot's length. Snapping to y = 0 in
        // both directions makes a flat sole rather than a rocker.
        shape: (a) => {
          const sn = Math.sin(a);
          if (sn > -0.35) return {};
          const yAt = footY + (1 - t) * 0.014 * S + sn * Math.max(h, 0.012 * S);
          const flat = Math.min(1, (-sn - 0.35) / 0.4);
          return { dy: -yAt * flat };
        },
      });
    }
    const footEnd = m.lathe(rings);
    m.cap(footEnd, [knee[0], footY - 0.002 * S, DIM.footLen * 0.8], SLOT.boot, [
      [`${key}.ankle`, 1],
    ]);
  }

  const geo = m.build();
  GEO_CACHE.set(variant, geo);
  return geo;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

const SKIN_TONES = ['#f0c49a', '#d79f6f', '#a9713f', '#7a4a24', '#523018'];
const HAIR_TONES = ['#191512', '#2e2118', '#4a3220', '#6d4a26', '#a8783c', '#1b1b1e'];

/** Kit textures are per team, not per player. */
const KIT_CACHE = new Map();

/** Crests are per team; built once as a canvas and composited into each shirt. */
const CREST_CACHE = new Map();
function crestCanvas(teamCfg) {
  let t = CREST_CACHE.get(teamCfg.id);
  if (!t) {
    t = makeCrestCanvas(teamCfg.colors, teamCfg.short.slice(0, 2));
    CREST_CACHE.set(teamCfg.id, t);
  }
  return t;
}

/** One head map for the whole game — skin tone comes from the material colour. */
let HEAD_TEX = null;
let SKIN_ROUGH = null;
function headTexture() {
  if (!HEAD_TEX) HEAD_TEX = makeHeadTexture(null);
  return HEAD_TEX;
}
function skinRoughness() {
  if (!SKIN_ROUGH) SKIN_ROUGH = makeSkinRoughness(null);
  return SKIN_ROUGH;
}
let HEAD_NORMAL = null;
function headNormal() {
  if (!HEAD_NORMAL) HEAD_NORMAL = makeHeadNormal(null);
  return HEAD_NORMAL;
}

function kitTextures(teamCfg, player) {
  // The shirt now carries the player's own name and number, so it is per
  // player rather than per team. That is 14 extra 512^2 canvases (~14MB) and
  // it *saves* 42 draw calls, since the three decal quads each player used to
  // carry are gone.
  const key = `${teamCfg.id}:${player.id}`;
  let entry = KIT_CACHE.get(key);
  if (!entry) {
    if (!KIT_CACHE.has('rough')) KIT_CACHE.set('rough', makeFabricRoughness(null));
    // The team's base shirt is built once and shared; only the name, number
    // and crest are stamped per player.
    const baseKey = `base:${teamCfg.id}:${player.isKeeper ? 'gk' : 'out'}`;
    if (!KIT_CACHE.has(baseKey)) {
      KIT_CACHE.set(baseKey, makeShirtBase(teamCfg.colors, { keeper: player.isKeeper }));
    }
    entry = {
      shirt: makeShirtTexture(null, KIT_CACHE.get(baseKey), {
        number: player.number,
        surname: player.surname,
        crest: crestCanvas(teamCfg),
      }),
      rough: KIT_CACHE.get('rough'),
    };
    KIT_CACHE.set(key, entry);
  }
  return entry;
}

/** Free the per-variant body geometries. Used by teardown and by tests. */
export function disposeGeometryCache() {
  for (const g of GEO_CACHE.values()) g.dispose();
  GEO_CACHE.clear();
}

export function disposeKitCache() {
  for (const [k, v] of KIT_CACHE) {
    if (k === 'rough') v.dispose();
    else if (k.startsWith('base:')) continue; // plain canvases, nothing to free
    else v.shirt.dispose();
  }
  KIT_CACHE.clear();
  CREST_CACHE.clear();
}

/**
 * Build one player. Returns the root Object3D plus the named joints the
 * animator drives — the same shape the rigid rig returned, so `animation.js`
 * is unchanged.
 */
export function createPlayer(player, teamCfg, opts = {}) {
  const colors = teamCfg.colors;
  const isKeeper = player.isKeeper;

  const skeleton = buildSkeleton();
  // Face variant from the player's own id, so a given match always looks the
  // same and two players in a squad rarely collide.
  // Player ids are sequential, so taking them modulo the variant count spreads
  // maximally: eight distinct faces across fourteen players. A hash of id and
  // shirt number collided down to five.
  const variant = player.id % FACE_VARIANTS;
  const geometry = bodyGeometry(skeleton.index, variant);

  const shirtColor = isKeeper ? colors.keeper : colors.primary;
  const shortsColor = isKeeper ? colors.keeperShorts : colors.shorts;
  const socksColor = isKeeper ? colors.keeper : colors.socks;
  const skin = SKIN_TONES[player.skinIndex % SKIN_TONES.length];
  const hairCol = HAIR_TONES[(player.skinIndex + player.number) % HAIR_TONES.length];
  const kit = kitTextures(teamCfg, player);

  const mat = (color, rough, extra = {}) =>
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: rough,
      metalness: 0.02,
      // Baked AO rides in the geometry's `color` attribute. Every slot shares
      // one geometry, so every material must read it or the attribute is
      // silently ignored on that slot.
      vertexColors: true,
      // Skinning is a vertex-shader feature; three.js enables it from the
      // geometry's skin attributes, but the material must not be shared with
      // a non-skinned mesh or the program cache will hand back the wrong one.
      ...extra,
    });

  const M = {
    shirt: mat(shirtColor, 0.58, { map: kit.shirt, roughnessMap: kit.rough }),
    shorts: mat(shortsColor, 0.62, { roughnessMap: kit.rough }),
    socks: mat(socksColor, 0.8, { roughnessMap: kit.rough }),
    // Skin is not uniformly matte: forehead, nose and cheekbones are oily and
    // catch a hard highlight while the jaw stays dull. A single roughness value
    // gives the whole head one flat sheen, which is most of what separates a CG
    // head from a photographed one.
    skin: mat(skin, 0.62, { roughnessMap: skinRoughness() }),
    boot: mat(isKeeper ? '#141414' : colors.accent, 0.24, { metalness: 0.12 }),
    // Double-sided: a hair shell is an open surface and a strongly slanted
    // hairline can flip a face's winding, which shows as a hole in the cap.
    hair: mat(hairCol, 0.88, { side: THREE.DoubleSide }),
    // The head map is white-based, so this material's colour still carries the
    // player's skin tone — one shared texture serves every skin in the squad.
    face: mat(skin, 0.58, {
      map: headTexture(),
      roughnessMap: skinRoughness(),
      normalMap: headNormal(),
      normalScale: new THREE.Vector2(0.7, 0.7),
    }),
  };

  // Order must match SLOT.
  const materials = [M.shirt, M.shorts, M.socks, M.skin, M.boot, M.hair, M.face];

  const root = new THREE.Group();
  root.name = `player-${player.id}`;

  const mesh = new THREE.SkinnedMesh(geometry, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  // The bones are siblings of the mesh under `root`, so the root transform
  // appears in both matrixWorlds and cancels out of the skinning maths.
  root.add(mesh);
  root.add(skeleton.root);
  root.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(skeleton.list));

  // A skinned mesh's bounding volume is computed in bind pose, which is a
  // narrow standing figure — a diving keeper or a sliding tackle falls outside
  // it and gets culled mid-animation. A generous manual bound is cheaper and
  // more robust than recomputing per frame.
  mesh.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, DIM.hipY, 0), PLAYER.height * 1.3);
  mesh.frustumCulled = false;

  // Hair: its own mesh on the head bone, style chosen deterministically from
  // the player's id so a given match always looks the same.
  const hairGeo = hairFor(player, SKULL);
  if (hairGeo) {
    const hairMesh = new THREE.Mesh(hairGeo, M.hair);
    hairMesh.castShadow = true;
    skeleton.joints.head.add(hairMesh);
  }

  // Build variation.
  //
  // Fourteen identically-proportioned players read as a cloned sprite sheet no
  // matter how good any one of them is. Height comes from the root; build comes
  // from scaling the spine and hip bones, which propagates through the skinning
  // to the whole torso and legs. `animation.js` only ever writes rotations, so
  // these scales survive every pose.
  const vary = (seed, spread) => {
    const n = Math.sin(player.id * 12.9898 + seed * 78.233) * 43758.5453;
    return 1 + ((n - Math.floor(n)) - 0.5) * 2 * spread;
  };
  // Height is a *uniform* root scale: uniform scale commutes with rotation, so
  // it is safe under any pose.
  root.scale.setScalar(vary(1, 0.04));
  // Build is a non-uniform scale on the spine only. Non-uniform scale on a bone
  // shears its children when they rotate, so it must not go on `hips` (whose
  // children are the legs, which rotate through a full stride) — the spine
  // rotates by at most a few tenths of a radian, where the shear is invisible.
  // Bone scales also compound down the chain, which is why only one bone in the
  // chain carries it.
  const build = vary(2, 0.08);
  skeleton.joints.spine.scale.set(build, 1, build);

  // Kit decals are painted into the shirt texture itself (see kitTextures) —
  // they used to be three PlaneGeometry quads parented to the spine, sitting
  // 1.5-3.3cm proud of the chest surface and drawing over the arms.

  return {
    root,
    mesh,
    materials: M,
    joints: skeleton.joints,
    dims: DIM,
  };
}

export const CHARACTER_DIMS = DIM;

/** Free every per-player material. Geometry is shared and intentionally kept. */
export function disposePlayer(built) {
  // Kit maps are cached per player in KIT_CACHE and released by
  // disposeKitCache(); only the materials themselves are per-instance here.
  for (const m of Object.values(built.materials)) m.dispose();
}
