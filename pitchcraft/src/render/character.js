import * as THREE from 'three';
import { PLAYER } from '../core/config.js';
import { makeNumberTexture, makeShirtTexture, makeFabricRoughness } from './textures.js';
import { mergeGeometries } from './geometryUtils.js';

/**
 * Procedural footballer.
 *
 * Built as a rigid-segment rig (a jointed mannequin) rather than a skinned mesh:
 * with spheres at every joint the segments never visibly separate, it needs no
 * external rigged asset, and the whole squad shares one set of geometries so 14
 * players cost 14 sets of materials rather than 14 meshes' worth of vertex data.
 *
 * See KNOWN_ISSUES.md — smooth skinned deformation is the main upgrade path here.
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

/** Geometry is identical for every player, so build it exactly once. */
let GEO = null;

function geometries() {
  if (GEO) return GEO;

  const seg = 10;

  // Torso: an 8-sided cylinder squashed on Z so it reads as a chest, not a tube.
  const torso = new THREE.CylinderGeometry(0.158 * S, 0.115 * S, DIM.torso, 10);
  torso.scale(1, 1, 0.62);
  torso.translate(0, DIM.torso / 2, 0);

  const hipBlock = new THREE.SphereGeometry(0.135 * S, 10, 8);
  hipBlock.scale(1, 0.72, 0.7);

  // Kept small and tucked inside the shirt line: an oversized joint sphere
  // reads as shoulder armour rather than a footballer.
  // Joint spheres share both a material and a local space with the limb that
  // hangs off them, so they are merged into a single geometry. That takes a
  // player from 24 draw calls to 16 with no visual change at all.
  const shoulder = new THREE.SphereGeometry(0.058 * S, 8, 6);
  const elbow = new THREE.SphereGeometry(0.052 * S, 8, 6);
  const knee = new THREE.SphereGeometry(0.075 * S, 8, 6);

  // The sleeve is the top 55% of the upper arm and is drawn in shirt fabric;
  // the rest is skin. Splitting the arm here is what gives a kit a visible
  // sleeve line instead of a single-coloured tube from shoulder to wrist.
  const sleeveLen = DIM.upperArm * 0.55;
  const sleeveOnly = new THREE.CylinderGeometry(0.058 * S, 0.05 * S, sleeveLen, seg);
  sleeveOnly.translate(0, -sleeveLen / 2, 0);
  // Shoulder ball sits at the joint origin; the sleeve hangs from it.
  const upperArm = mergeGeometries([shoulder, sleeveOnly]);

  // Bare arm below the sleeve, positioned in the same shoulder-joint space.
  const bicep = new THREE.CylinderGeometry(0.046 * S, 0.04 * S, DIM.upperArm - sleeveLen, seg);
  bicep.translate(0, -(sleeveLen + (DIM.upperArm - sleeveLen) / 2), 0);

  const foreArmOnly = new THREE.CylinderGeometry(0.044 * S, 0.036 * S, DIM.foreArm, seg);
  foreArmOnly.translate(0, -DIM.foreArm / 2, 0);

  const handOnly = new THREE.SphereGeometry(0.048 * S, 8, 6);
  handOnly.scale(1, 1.25, 0.75);
  handOnly.translate(0, -DIM.foreArm, 0);
  // Elbow + forearm + hand are all rigid relative to the elbow joint.
  const foreArm = mergeGeometries([elbow, foreArmOnly, handOnly]);

  const thigh = new THREE.CylinderGeometry(DIM.thighR, 0.066 * S, DIM.thigh, seg);
  thigh.translate(0, -DIM.thigh / 2, 0);

  // Sock covers the lower 62% of the shin; the calf above it is bare, which is
  // where the sock line every footballer has actually comes from.
  const bareShin = DIM.shin * 0.38;
  const shinOnly = new THREE.CylinderGeometry(0.06 * S, 0.052 * S, bareShin, seg);
  shinOnly.translate(0, -bareShin / 2, 0);
  const shin = mergeGeometries([knee, shinOnly]);

  const sockLen = DIM.shin - bareShin;
  const sock = new THREE.CylinderGeometry(0.062 * S, 0.046 * S, sockLen, seg);
  sock.translate(0, -(bareShin + sockLen / 2), 0);

  // Boot: a tapered sole with a raised heel counter, rather than a plain box.
  const sole = new THREE.BoxGeometry(0.088 * S, DIM.footH, DIM.footLen);
  sole.translate(0, -DIM.footH / 2, DIM.footLen * 0.22);
  const upper = new THREE.SphereGeometry(0.062 * S, 10, 8);
  upper.scale(0.72, 0.62, 1.05);
  upper.translate(0, -DIM.footH * 0.15, DIM.footLen * 0.05);
  const foot = mergeGeometries([sole, upper]);

  const neck = new THREE.CylinderGeometry(0.045 * S, 0.055 * S, DIM.neck, 8);
  neck.translate(0, DIM.neck / 2, 0);

  const head = new THREE.SphereGeometry(DIM.headR, 14, 12);
  head.scale(0.92, 1.08, 0.95);
  head.translate(0, DIM.headR * 1.02, 0);

  // Hair: a cap that sits over the back and top of the skull.
  const hair = new THREE.SphereGeometry(DIM.headR * 1.04, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.62);
  hair.scale(0.94, 1.1, 0.98);
  hair.translate(0, DIM.headR * 1.05, -0.004 * S);

  const numberPlane = new THREE.PlaneGeometry(0.17 * S, 0.17 * S);

  GEO = {
    torso,
    hipBlock,
    upperArm,
    bicep,
    foreArm,
    thigh,
    shin,
    sock,
    foot,
    neck,
    head,
    hair,
    numberPlane,
  };
  return GEO;
}

/**
 * Kit textures are per *team*, not per player, so both squads cost two shirt
 * maps and one shared roughness map no matter how many players are on the pitch.
 */
const KIT_CACHE = new Map();

function kitTextures(teamCfg, isKeeper) {
  const key = `${teamCfg.id}:${isKeeper ? 'gk' : 'out'}`;
  let entry = KIT_CACHE.get(key);
  if (!entry) {
    entry = {
      shirt: makeShirtTexture(null, teamCfg.colors, { keeper: isKeeper }),
      rough: KIT_CACHE.get('rough') || makeFabricRoughness(null),
    };
    KIT_CACHE.set('rough', entry.rough);
    KIT_CACHE.set(key, entry);
  }
  return entry;
}

/** Drop cached kit textures — used by tests and by a full renderer teardown. */
export function disposeKitCache() {
  for (const [k, v] of KIT_CACHE) {
    if (k === 'rough') v.dispose();
    else v.shirt.dispose();
  }
  KIT_CACHE.clear();
}

const SKIN_TONES = ['#f0c49a', '#d79f6f', '#a9713f', '#7a4a24', '#523018'];
const HAIR_TONES = ['#191512', '#2e2118', '#4a3220', '#6d4a26', '#a8783c', '#1b1b1e'];

/**
 * Build one player. Returns the root Object3D plus the named joints the
 * animator drives.
 */
export function createPlayer(player, teamCfg, opts = {}) {
  const G = geometries();
  const colors = teamCfg.colors;
  const isKeeper = player.isKeeper;

  const shirtColor = isKeeper ? colors.keeper : colors.primary;
  const shortsColor = isKeeper ? colors.keeperShorts : colors.shorts;
  const socksColor = isKeeper ? colors.keeper : colors.socks;

  const skin = SKIN_TONES[player.skinIndex % SKIN_TONES.length];
  const hairCol = HAIR_TONES[(player.skinIndex + player.number) % HAIR_TONES.length];

  const kit = kitTextures(teamCfg, isKeeper);

  const mat = (color, rough = 0.78, extra = {}) =>
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: rough,
      metalness: 0.02,
      ...extra,
    });

  // Roughness values are set for a scene lit by an environment map (see
  // environment.js). Under IBL, uniformly-rough surfaces read as felt: the kit
  // needs to be glossier than the skin, and the boots glossier than both, or
  // nothing on the player catches a floodlight.
  const M = {
    shirt: mat(shirtColor, 0.58, { map: kit.shirt, roughnessMap: kit.rough }),
    shorts: mat(shortsColor, 0.62, { roughnessMap: kit.rough }),
    socks: mat(socksColor, 0.8, { roughnessMap: kit.rough }),
    skin: mat(skin, 0.62),
    hair: mat(hairCol, 0.88),
    boot: mat(isKeeper ? '#141414' : colors.accent, 0.24, { metalness: 0.12 }),
  };

  const root = new THREE.Group();
  root.name = `player-${player.id}`;

  // --- pelvis ------------------------------------------------------------
  const hips = new THREE.Group();
  hips.position.y = DIM.hipY;
  root.add(hips);

  const pelvis = new THREE.Mesh(G.hipBlock, M.shorts);
  pelvis.castShadow = true;
  hips.add(pelvis);

  // --- spine / torso -----------------------------------------------------
  const spine = new THREE.Group();
  hips.add(spine);

  const torso = new THREE.Mesh(G.torso, M.shirt);
  torso.castShadow = true;
  spine.add(torso);

  // Shirt number on the back.
  const numTex = makeNumberTexture(player.number, isKeeper ? '#f0f0f0' : colors.accent);
  const numMat = new THREE.MeshBasicMaterial({ map: numTex, transparent: true, depthWrite: false });
  const num = new THREE.Mesh(G.numberPlane, numMat);
  num.position.set(0, DIM.torso * 0.62, -0.093 * S);
  num.rotation.y = Math.PI;
  spine.add(num);

  // --- head --------------------------------------------------------------
  const neckJoint = new THREE.Group();
  neckJoint.position.y = DIM.torso;
  spine.add(neckJoint);

  const neck = new THREE.Mesh(G.neck, M.skin);
  neckJoint.add(neck);

  const headJoint = new THREE.Group();
  headJoint.position.y = DIM.neck;
  neckJoint.add(headJoint);

  const head = new THREE.Mesh(G.head, M.skin);
  head.castShadow = true;
  headJoint.add(head);
  const hair = new THREE.Mesh(G.hair, M.hair);
  headJoint.add(hair);

  // --- arms --------------------------------------------------------------
  const makeArm = (side) => {
    const shoulderJoint = new THREE.Group();
    shoulderJoint.position.set(side * DIM.shoulderW, DIM.torso * 0.94, 0);
    spine.add(shoulderJoint);

    // Shoulder ball is baked into the sleeve geometry; the bare bicep below it
    // shares the same joint, so the sleeve line moves with the arm for free.
    const upper = new THREE.Mesh(G.upperArm, M.shirt);
    upper.castShadow = true;
    shoulderJoint.add(upper);

    const bare = new THREE.Mesh(G.bicep, M.skin);
    bare.castShadow = true;
    shoulderJoint.add(bare);

    const elbowJoint = new THREE.Group();
    elbowJoint.position.y = -DIM.upperArm;
    shoulderJoint.add(elbowJoint);

    // Elbow ball and hand are baked into the forearm geometry.
    const fore = new THREE.Mesh(G.foreArm, M.skin);
    fore.castShadow = true;
    elbowJoint.add(fore);

    return { shoulder: shoulderJoint, elbow: elbowJoint, hand: fore };
  };

  const armL = makeArm(-1);
  const armR = makeArm(1);

  // --- legs --------------------------------------------------------------
  const makeLeg = (side) => {
    const hipJoint = new THREE.Group();
    hipJoint.position.set(side * DIM.hipW, -0.02 * S, 0);
    hips.add(hipJoint);

    const thigh = new THREE.Mesh(G.thigh, M.shorts);
    thigh.castShadow = true;
    hipJoint.add(thigh);

    const kneeJoint = new THREE.Group();
    kneeJoint.position.y = -DIM.thigh;
    hipJoint.add(kneeJoint);

    // Knee ball is baked into the bare calf; the sock is a separate mesh in the
    // same joint space so there is a visible sock line partway down the shin.
    const shin = new THREE.Mesh(G.shin, M.skin);
    shin.castShadow = true;
    kneeJoint.add(shin);

    const sock = new THREE.Mesh(G.sock, M.socks);
    sock.castShadow = true;
    kneeJoint.add(sock);

    const ankleJoint = new THREE.Group();
    ankleJoint.position.y = -DIM.shin;
    kneeJoint.add(ankleJoint);

    const foot = new THREE.Mesh(G.foot, M.boot);
    foot.castShadow = true;
    ankleJoint.add(foot);

    return { hip: hipJoint, knee: kneeJoint, ankle: ankleJoint, foot };
  };

  const legL = makeLeg(-1);
  const legR = makeLeg(1);

  return {
    root,
    materials: M,
    joints: {
      hips,
      spine,
      neck: neckJoint,
      head: headJoint,
      armL,
      armR,
      legL,
      legR,
    },
    dims: DIM,
  };
}

export const CHARACTER_DIMS = DIM;

/** Free every per-player material (geometry is shared and intentionally kept). */
export function disposePlayer(built) {
  for (const m of Object.values(built.materials)) m.dispose();
  built.root.traverse((o) => {
    if (o.material && o.material.map && o.material.map.dispose && o.material !== undefined) {
      // Only number textures are per-player.
      if (o.material.map.isCanvasTexture) o.material.map.dispose();
    }
  });
}
