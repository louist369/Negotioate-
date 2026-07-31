import * as THREE from 'three';
import { PLAYER } from '../core/config.js';
import {
  makeNumberTexture,
  makeShirtTexture,
  makeFabricRoughness,
  makeHeadTexture,
  makeBackDecal,
  makeCrestTexture,
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
  torso: 0.56 * S,
  neck: 0.07 * S,
  headR: 0.115 * S,
  upperArm: 0.29 * S,
  foreArm: 0.27 * S,
  shoulderW: 0.152 * S,
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
const RADIAL = 16;

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

function headShape(v, R) {
  // V runs 0.2 at the jaw to 1.0 at the crown; h is 0 to 1 over the same span.
  const h = (v - 0.2) / 0.8;
  // Neck rings stay plain — a nose on the throat is not an improvement.
  if (h < 0) return null;

  return (a) => {
    let dz = 0;
    let dx = 0;
    let scale = 1;

    // Brow ridge: a shallow shelf across the front, above the eyes.
    dz += R * 0.085 * lobe(a, Math.PI / 2, 0.95) * band(h, 0.6, 0.1);

    // Nose. Narrow in angle and short in height, so it is a nose rather than a
    // muzzle, with the bridge running up toward the brow.
    dz += R * 0.3 * lobe(a, Math.PI / 2, 0.34) * band(h, 0.4, 0.1);
    dz += R * 0.13 * lobe(a, Math.PI / 2, 0.28) * band(h, 0.52, 0.09);

    // Chin, and the jaw pulling in beneath it.
    dz += R * 0.1 * lobe(a, Math.PI / 2, 0.55) * band(h, 0.08, 0.09);
    scale -= 0.11 * band(h, 0.0, 0.13);

    // Cheekbones: a widening at the sides at mid-face.
    const side = lobe(a, 0, 0.6) + lobe(a, Math.PI, 0.6);
    scale += 0.05 * side * band(h, 0.45, 0.12);

    // Ears, as small flat tabs rather than modelled shells.
    const ear = (lobe(a, 0.12, 0.22) - lobe(a, Math.PI - 0.12, 0.22)) * band(h, 0.47, 0.075);
    dx += R * 0.13 * ear;

    // Occiput: the skull carries further back than it does forward.
    dz -= R * 0.1 * lobe(a, -Math.PI / 2, 1.0) * band(h, 0.62, 0.26);

    return { dx, dz, scale };
  };
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
    for (let i = 0; i <= RADIAL; i++) {
      // The seam vertex is duplicated so U can run 0..1 without wrapping.
      const a = (i / RADIAL) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const mod = r.shape ? r.shape(a) : null;
      const k = mod && mod.scale !== undefined ? mod.scale : 1;
      const dx = mod && mod.dx ? mod.dx : 0;
      const dy = mod && mod.dy ? mod.dy : 0;
      const dz = mod && mod.dz ? mod.dz : 0;
      if (axis === 'y') this.pos.push(x + c * r.rx * k + dx, y + dy, z + s * r.rz * k + dz);
      else this.pos.push(x + c * r.rx * k + dx, y + s * r.rz * k + dy, z + dz);
      this.uv.push(i / RADIAL, r.v ?? 0);

      const w = r.w;
      const i0 = this.boneIndex.get(w[0][0]);
      const i1 = w[1] ? this.boneIndex.get(w[1][0]) : 0;
      this.skinIndex.push(i0, i1, 0, 0);
      this.skinWeight.push(w[0][1], w[1] ? w[1][1] : 0, 0, 0);
    }
    return base;
  }

  /** Quad strip between two already-emitted rings. */
  connect(a, b, slot) {
    const idx = this.indices[slot];
    for (let i = 0; i < RADIAL; i++) {
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
      if (prev !== null) this.connect(prev, base, r.slot ?? prevSlot);
      prev = base;
      prevSlot = r.slot;
    }
    return prev;
  }

  /** Close a tube end with a fan to a single point. */
  cap(ringBase, point, slot, weights) {
    const tip = this.pos.length / 3;
    this.pos.push(point[0], point[1], point[2]);
    this.uv.push(0.5, 0.5);
    const i0 = this.boneIndex.get(weights[0][0]);
    const i1 = weights[1] ? this.boneIndex.get(weights[1][0]) : 0;
    this.skinIndex.push(i0, i1, 0, 0);
    this.skinWeight.push(weights[0][1], weights[1] ? weights[1][1] : 0, 0, 0);
    const idx = this.indices[slot];
    for (let i = 0; i < RADIAL; i++) idx.push(ringBase + i, tip, ringBase + i + 1);
    return tip;
  }

  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
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
let GEO = null;

function bodyGeometry(boneIndex) {
  if (GEO) return GEO;

  const m = new MeshBuilder(boneIndex);
  const P = bindPositions(boneIndex);

  // --- torso ---------------------------------------------------------------
  // One tube from the crotch to the neck. The waist is the narrowest point and
  // the chest the widest, which is what separates a footballer's silhouette
  // from a barrel.
  const crotchY = DIM.hipY - 0.115 * S;
  const neckY = DIM.hipY + DIM.torso;
  const torsoRings = [];
  const TORSO_STEPS = 16;
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
    else if (t < 0.74) rx = lerp(0.128, 0.152, (t - 0.42) / 0.32); // chest
    else if (t < 0.88) rx = lerp(0.152, 0.124, (t - 0.74) / 0.14); // trapezius
    else rx = lerp(0.124, 0.056, (t - 0.88) / 0.12); // into the neck
    rx *= S;
    const rz = rx * (t < 0.42 ? 0.78 : 0.66);

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
    torsoRings.push({ p: [0, y, 0], rx, rz, w, slot, v });
  }
  m.lathe(torsoRings);
  // No cap at the top: the neck section below starts at the same radius and
  // the same height, so chest and neck read as one continuous surface.
  // Crotch cap, so the pelvis is closed.
  const crotchRing = m.ring({ ...torsoRings[0], v: 0 });
  m.cap(crotchRing, [0, crotchY - 0.02 * S, 0], SLOT.shorts, [['hips', 1]]);

  // --- neck and head -------------------------------------------------------
  //
  // The head is a real ellipsoid swept by polar angle, not a radius curve
  // sampled against a linear height. The previous version lerped y linearly
  // while driving the radius with a sine, which is only a sphere if the two
  // parametrisations agree — they did not, and the result was a diamond.
  //
  // phi runs 0 (bottom pole) to PI (crown). The neck meets the skull at PHI0,
  // chosen so the first head ring is exactly as wide as the neck it grows out
  // of, which is what makes the join seamless rather than a step.
  const neckTop = DIM.hipY + DIM.torso + DIM.neck;
  const R = DIM.headR * 1.05;
  const HEAD_X = 0.68; // half-width  = 0.68 R  -> ~15.5cm across
  const HEAD_Z = 0.85; // half-depth  = 0.85 R  -> ~19cm front to back
  const neckR = 0.062 * S;
  const PHI0 = Math.asin(Math.min(1, neckR / (R * HEAD_X)));
  const headCentre = neckTop + R * Math.cos(PHI0);

  const headRings = [];
  // Neck: a short column from the shoulders up to the jaw.
  for (let i = 0; i <= 2; i++) {
    const t = i / 2;
    headRings.push({
      p: [0, lerp(DIM.hipY + DIM.torso - 0.015 * S, neckTop, t), 0],
      rx: lerp(0.066 * S, neckR, t),
      rz: lerp(0.07 * S, neckR, t),
      w: t < 0.5 ? [['neck', 1]] : [['neck', 0.6], ['head', 0.4]],
      slot: SLOT.face,
      v: lerp(0.02, 0.2, t),
    });
  }
  // Skull.
  const HEAD_STEPS = 12;
  for (let i = 0; i <= HEAD_STEPS; i++) {
    const k = i / HEAD_STEPS;
    const phi = lerp(PHI0, Math.PI, k);
    const y = headCentre - R * Math.cos(phi);
    const rx = R * HEAD_X * Math.sin(phi);
    const rz = R * HEAD_Z * Math.sin(phi);
    // V is the face map's own axis: 0.2 at the jaw, 1.0 at the crown, so the
    // painted eyes land on the modelled brow rather than beside it.
    const v = lerp(0.2, 1, k);
    headRings.push({
      p: [0, y, 0],
      rx: Math.max(rx, 0.004 * S),
      rz: Math.max(rz, 0.004 * S),
      w: k < 0.12 ? [['neck', 0.4], ['head', 0.6]] : [['head', 1]],
      slot: SLOT.face,
      v,
      shape: headShape(v, R),
    });
  }
  m.lathe(headRings);

  // Hair: a cap following the same ellipsoid, a hair's breadth outside it,
  // starting above the brow so the face is not buried.
  // Chosen so the cap's lower edge lands at V ~0.76 — just under the hairline
  // the face map paints. At 1.78 it started at V 0.55 and covered the eyes.
  const HAIR_PHI = PHI0 + 0.7 * (Math.PI - PHI0);
  const hairRings = [];
  for (let i = 0; i <= 6; i++) {
    const k = i / 6;
    const phi = lerp(HAIR_PHI, Math.PI, k);
    const hr = R * 1.03;
    hairRings.push({
      p: [0, headCentre - hr * Math.cos(phi), 0],
      rx: Math.max(hr * HEAD_X * Math.sin(phi), 0.004 * S),
      rz: Math.max(hr * HEAD_Z * Math.sin(phi), 0.004 * S),
      w: [['head', 1]],
      slot: SLOT.hair,
      v: k,
      // The hairline sits a little lower at the back than across the brow. This
      // was 0.16R and applied to the sides too, which hung sideburns down over
      // both cheeks.
      shape: (a) => ({ dy: -R * 0.07 * (1 - k) * Math.max(0, -Math.sin(a)) }),
    });
  }
  m.lathe(hairRings);

  // --- arms ----------------------------------------------------------------
  for (const key of ['armL', 'armR']) {
    const sh = P[`${key}.shoulder`];
    const el = P[`${key}.elbow`];
    const hd = P[`${key}.hand`];
    const rings = [];

    // Upper arm. The first rings sit *inside* the torso and are weighted to the
    // spine, so the shoulder is a smooth deltoid rather than a ball stuck on.
    const UP_STEPS = 9;
    for (let i = 0; i <= UP_STEPS; i++) {
      const t = i / UP_STEPS;
      const y = lerp(sh[1] + 0.028 * S, el[1], t);
      const x = lerp(sh[0] * 0.42, el[0], Math.min(t * 1.6, 1));
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

    // Hand: a flattened bulb below the wrist.
    for (let i = 1; i <= 4; i++) {
      const t = i / 4;
      const y = hd[1] - t * 0.085 * S;
      const r = Math.sin((1 - t * 0.85) * Math.PI * 0.62) * 0.05 * S;
      rings.push({
        p: [hd[0], y, 0],
        rx: r * 0.72,
        rz: r * 1.15,
        w: [[`${key}.hand`, 1]],
        slot: SLOT.skin,
        v: 0,
      });
    }
    const armEnd = m.lathe(rings);
    m.cap(armEnd, [hd[0], hd[1] - 0.1 * S, 0], SLOT.skin, [[`${key}.hand`, 1]]);
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
      const r = (0.068 + Math.sin(Math.min(t * 3.2, Math.PI)) * 0.019 - t * 0.028) * S;
      rings.push({
        p: [knee[0], y, t < 0.3 ? 0 : -0.004 * S],
        rx: r,
        rz: r * 1.02,
        w: jointWeightsAfter(`${key}.hip`, `${key}.knee`, t),
        // Sock over the lower 62% of the shin, bare calf above it.
        slot: t < 0.2 ? SLOT.skin : SLOT.socks,
        v: 0,
      });
    }

    // Foot: rings swept in the XY plane so the tube runs forward, not down.
    const footY = ankle[1] - DIM.footH * 0.55;
    const FOOT_STEPS = 6;
    for (let i = 0; i <= FOOT_STEPS; i++) {
      const t = i / FOOT_STEPS;
      const z = lerp(-DIM.footLen * 0.3, DIM.footLen * 0.72, t);
      // Wide and shallow at the heel, tapering to a rounded toe.
      const w = (0.046 - t * t * 0.016) * S;
      const h = (0.045 - t * 0.014) * S;
      rings.push({
        p: [knee[0], footY + (1 - t) * 0.012 * S, z],
        rx: w,
        rz: h,
        axis: 'z',
        w: t < 0.25 ? jointWeightsAfter(`${key}.knee`, `${key}.ankle`, t) : [[`${key}.ankle`, 1]],
        slot: SLOT.boot,
        v: 0,
      });
    }
    const footEnd = m.lathe(rings);
    m.cap(footEnd, [knee[0], footY - 0.004 * S, DIM.footLen * 0.78], SLOT.boot, [
      [`${key}.ankle`, 1],
    ]);
  }

  GEO = m.build();
  return GEO;
}

// ---------------------------------------------------------------------------
// Materials
// ---------------------------------------------------------------------------

const SKIN_TONES = ['#f0c49a', '#d79f6f', '#a9713f', '#7a4a24', '#523018'];
const HAIR_TONES = ['#191512', '#2e2118', '#4a3220', '#6d4a26', '#a8783c', '#1b1b1e'];

/** Kit textures are per team, not per player. */
const KIT_CACHE = new Map();

/** Crests are per team; built once and shared by the whole squad. */
const CREST_CACHE = new Map();
function crestTexture(teamCfg) {
  let t = CREST_CACHE.get(teamCfg.id);
  if (!t) {
    t = makeCrestTexture(teamCfg.colors, teamCfg.short.slice(0, 2));
    CREST_CACHE.set(teamCfg.id, t);
  }
  return t;
}

/** One head map for the whole game — skin tone comes from the material colour. */
let HEAD_TEX = null;
function headTexture() {
  if (!HEAD_TEX) HEAD_TEX = makeHeadTexture(null);
  return HEAD_TEX;
}

function kitTextures(teamCfg, isKeeper) {
  const key = `${teamCfg.id}:${isKeeper ? 'gk' : 'out'}`;
  let entry = KIT_CACHE.get(key);
  if (!entry) {
    if (!KIT_CACHE.has('rough')) KIT_CACHE.set('rough', makeFabricRoughness(null));
    entry = {
      shirt: makeShirtTexture(null, teamCfg.colors, { keeper: isKeeper }),
      rough: KIT_CACHE.get('rough'),
    };
    KIT_CACHE.set(key, entry);
  }
  return entry;
}

export function disposeKitCache() {
  for (const [k, v] of KIT_CACHE) {
    if (k === 'rough') v.dispose();
    else v.shirt.dispose();
  }
  KIT_CACHE.clear();
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
  const geometry = bodyGeometry(skeleton.index);

  const shirtColor = isKeeper ? colors.keeper : colors.primary;
  const shortsColor = isKeeper ? colors.keeperShorts : colors.shorts;
  const socksColor = isKeeper ? colors.keeper : colors.socks;
  const skin = SKIN_TONES[player.skinIndex % SKIN_TONES.length];
  const hairCol = HAIR_TONES[(player.skinIndex + player.number) % HAIR_TONES.length];
  const kit = kitTextures(teamCfg, isKeeper);

  const mat = (color, rough, extra = {}) =>
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: rough,
      metalness: 0.02,
      // Skinning is a vertex-shader feature; three.js enables it from the
      // geometry's skin attributes, but the material must not be shared with
      // a non-skinned mesh or the program cache will hand back the wrong one.
      ...extra,
    });

  const M = {
    shirt: mat(shirtColor, 0.58, { map: kit.shirt, roughnessMap: kit.rough }),
    shorts: mat(shortsColor, 0.62, { roughnessMap: kit.rough }),
    socks: mat(socksColor, 0.8, { roughnessMap: kit.rough }),
    skin: mat(skin, 0.62),
    boot: mat(isKeeper ? '#141414' : colors.accent, 0.24, { metalness: 0.12 }),
    hair: mat(hairCol, 0.88),
    // The head map is white-based, so this material's colour still carries the
    // player's skin tone — one shared texture serves every skin in the squad.
    face: mat(skin, 0.6, { map: headTexture() }),
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

  // Kit decals.
  //
  // These are planes parented to the spine bone, so they ride the torso as it
  // twists. They are what separate a football kit from a coloured leotard: a
  // number alone reads as a training bib, and it is the *name* above it and the
  // crest on the chest that make a shirt look like a shirt at any distance.
  const decal = (tex, w, h, x, y, z, faceBack) => {
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
    mesh.position.set(x, y, z);
    if (faceBack) mesh.rotation.y = Math.PI;
    mesh.renderOrder = 1;
    skeleton.joints.spine.add(mesh);
    return mat;
  };

  const decalFg = isKeeper ? '#f0f0f0' : colors.accent;
  const backMat = decal(
    makeBackDecal(player.number, player.surname, decalFg),
    0.26 * S,
    0.26 * S,
    0,
    DIM.torso * 0.56,
    -0.128 * S,
    true
  );
  const crestMat = decal(
    crestTexture(teamCfg),
    0.075 * S,
    0.075 * S,
    -0.055 * S,
    DIM.torso * 0.66,
    0.113 * S,
    false
  );
  // Small chest number opposite the crest, as most kits carry.
  const frontMat = decal(
    makeNumberTexture(player.number, decalFg),
    0.07 * S,
    0.07 * S,
    0.058 * S,
    DIM.torso * 0.655,
    0.113 * S,
    false
  );

  return {
    root,
    mesh,
    materials: { ...M, back: backMat, crest: crestMat, front: frontMat },
    joints: skeleton.joints,
    dims: DIM,
  };
}

export const CHARACTER_DIMS = DIM;

/** Free every per-player material. Geometry is shared and intentionally kept. */
export function disposePlayer(built) {
  for (const [key, m] of Object.entries(built.materials)) {
    // Back decal and chest number are per player; the crest and kit maps are
    // cached per team and must outlive any single player.
    if ((key === 'back' || key === 'front') && m.map) m.map.dispose();
    m.dispose();
  }
}
