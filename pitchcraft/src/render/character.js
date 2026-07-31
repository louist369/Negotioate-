import * as THREE from 'three';
import { PLAYER } from '../core/config.js';
import {
  makeNumberTexture,
  makeShirtTexture,
  makeFabricRoughness,
  makeHeadTexture,
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

/** Vertices around each cross-section. 12 is enough to read as round at any
 *  distance the broadcast camera ever gets to. */
const RADIAL = 12;

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

  /** Emit one ring's vertices and return the index of its first vertex. */
  ring(r) {
    const base = this.pos.length / 3;
    const [x, y, z] = r.p;
    const axis = r.axis || 'y';
    for (let i = 0; i <= RADIAL; i++) {
      // The seam vertex is duplicated so U can run 0..1 without wrapping.
      const a = (i / RADIAL) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      if (axis === 'y') this.pos.push(x + c * r.rx, y, z + s * r.rz);
      else this.pos.push(x + c * r.rx, y + s * r.rz, z);
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
    else if (t < 0.74) rx = lerp(0.128, 0.178, (t - 0.42) / 0.32); // chest
    else if (t < 0.88) rx = lerp(0.178, 0.132, (t - 0.74) / 0.14); // trapezius
    else rx = lerp(0.132, 0.056, (t - 0.88) / 0.12); // into the neck
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
  const headBase = DIM.hipY + DIM.torso;
  const headCentre = headBase + DIM.neck + DIM.headR * 1.02;
  const headRings = [];
  const HEAD_STEPS = 14;
  for (let i = 0; i <= HEAD_STEPS; i++) {
    const t = i / HEAD_STEPS;
    const y = lerp(headBase, headCentre + DIM.headR * 1.05, t);
    let rx;
    if (t < 0.22) rx = lerp(0.056, 0.049, t / 0.22) * S; // neck
    else {
      // Skull: a squashed sphere profile, slightly longer than it is wide.
      const u = (t - 0.22) / 0.78;
      rx = Math.sin(Math.min(u, 1) * Math.PI * 0.94 + 0.06) * DIM.headR * 1.06;
      rx = Math.max(rx, 0.012 * S);
    }
    const rz = rx * (t < 0.22 ? 1 : 1.06);
    const w =
      t < 0.18
        ? [['neck', 1]]
        : t < 0.34
          ? [['neck', 1 - (t - 0.18) / 0.16], ['head', (t - 0.18) / 0.16]]
          : [['head', 1]];
    headRings.push({ p: [0, y, 0], rx, rz, w, slot: SLOT.face, v: t });
  }
  const headTop = m.lathe(headRings);
  m.cap(headTop, [0, headCentre + DIM.headR * 1.1, 0], SLOT.face, [['head', 1]]);

  // Hair: a second shell over the back and top of the skull, offset outward.
  const hairRings = [];
  for (let i = 0; i <= 9; i++) {
    const t = i / 9;
    const y = lerp(headCentre + DIM.headR * 0.42, headCentre + DIM.headR * 1.0, t);
    const u = t * 0.46 + 0.54;
    const rx = Math.sin(u * Math.PI * 0.94 + 0.06) * DIM.headR * 1.035;
    hairRings.push({
      p: [0, y, -0.008 * S],
      rx,
      rz: rx * 1.06,
      w: [['head', 1]],
      slot: SLOT.hair,
      v: t,
    });
  }
  const hairTop = m.lathe(hairRings);
  m.cap(hairTop, [0, headCentre + DIM.headR * 1.03, -0.004 * S], SLOT.hair, [['head', 1]]);

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
      const r = lerp(0.069, 0.05, t) * S;
      let w;
      if (t < 0.14) {
        const k = t / 0.14;
        w = [['spine', 1 - k], [`${key}.shoulder`, k]];
      } else {
        const u = (t - 0.14) / 0.86;
        w = jointWeights(`${key}.shoulder`, `${key}.elbow`, u);
      }
      // Sleeve for the top 55%, bare arm below. V is mapped into the shirt
      // texture's yoke band so the sleeve carries the collar trim.
      const sleeve = t < 0.55;
      rings.push({
        p: [x, y, 0],
        rx: r,
        rz: r * 0.94,
        w,
        slot: sleeve ? SLOT.shirt : SLOT.skin,
        // Start below the yoke so the sleeve is team colour, and run down to
        // the trim band so the cuff picks up the accent stripe.
        v: sleeve ? lerp(0.88, 0.93, t / 0.55) : 0,
      });
    }

    // Forearm, tapering to the wrist.
    const LOW_STEPS = 8;
    for (let i = 1; i <= LOW_STEPS; i++) {
      const t = i / LOW_STEPS;
      const y = lerp(el[1], hd[1], t);
      const r = lerp(0.048, 0.036, t) * S;
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

  // Shirt number on the back, as a decal plane parented to the spine bone so it
  // rides the torso.
  const numTex = makeNumberTexture(player.number, isKeeper ? '#f0f0f0' : colors.accent);
  const numMat = new THREE.MeshBasicMaterial({
    map: numTex,
    transparent: true,
    depthWrite: false,
  });
  const num = new THREE.Mesh(new THREE.PlaneGeometry(0.17 * S, 0.17 * S), numMat);
  num.position.set(0, DIM.torso * 0.58, -0.126 * S);
  num.rotation.y = Math.PI;
  num.renderOrder = 1;
  skeleton.joints.spine.add(num);

  return {
    root,
    mesh,
    materials: { ...M, number: numMat },
    joints: skeleton.joints,
    dims: DIM,
  };
}

export const CHARACTER_DIMS = DIM;

/** Free every per-player material. Geometry is shared and intentionally kept. */
export function disposePlayer(built) {
  for (const [key, m] of Object.entries(built.materials)) {
    // Only the number texture is per-player; kit maps are cached per team.
    if (key === 'number' && m.map) m.map.dispose();
    m.dispose();
  }
}
