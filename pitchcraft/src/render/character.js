import * as THREE from 'three';
import { PLAYER } from '../core/config.js';
import { makeNumberTexture } from './textures.js';
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

  const upperArmOnly = new THREE.CylinderGeometry(0.052 * S, 0.044 * S, DIM.upperArm, seg);
  upperArmOnly.translate(0, -DIM.upperArm / 2, 0);
  // Shoulder ball sits at the joint origin; the upper arm hangs from it.
  const upperArm = mergeGeometries([shoulder, upperArmOnly]);

  const foreArmOnly = new THREE.CylinderGeometry(0.044 * S, 0.036 * S, DIM.foreArm, seg);
  foreArmOnly.translate(0, -DIM.foreArm / 2, 0);

  const handOnly = new THREE.SphereGeometry(0.048 * S, 8, 6);
  handOnly.scale(1, 1.25, 0.75);
  handOnly.translate(0, -DIM.foreArm, 0);
  // Elbow + forearm + hand are all rigid relative to the elbow joint.
  const foreArm = mergeGeometries([elbow, foreArmOnly, handOnly]);

  const thigh = new THREE.CylinderGeometry(DIM.thighR, 0.066 * S, DIM.thigh, seg);
  thigh.translate(0, -DIM.thigh / 2, 0);

  const shinOnly = new THREE.CylinderGeometry(0.064 * S, 0.045 * S, DIM.shin, seg);
  shinOnly.translate(0, -DIM.shin / 2, 0);
  const shin = mergeGeometries([knee, shinOnly]);

  const foot = new THREE.BoxGeometry(0.085 * S, DIM.footH, DIM.footLen);
  foot.translate(0, -DIM.footH / 2, DIM.footLen * 0.22);

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
    foreArm,
    thigh,
    shin,
    foot,
    neck,
    head,
    hair,
    numberPlane,
  };
  return GEO;
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

  const mat = (color, rough = 0.78) =>
    new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: rough, metalness: 0.02 });

  const M = {
    shirt: mat(shirtColor, 0.82),
    shorts: mat(shortsColor, 0.85),
    socks: mat(socksColor, 0.88),
    skin: mat(skin, 0.72),
    hair: mat(hairCol, 0.92),
    boot: mat(isKeeper ? '#141414' : colors.accent, 0.45),
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

    // Shoulder ball is baked into the upper-arm geometry.
    const upper = new THREE.Mesh(G.upperArm, M.shirt);
    upper.castShadow = true;
    shoulderJoint.add(upper);

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

    // Knee ball is baked into the shin geometry.
    const shin = new THREE.Mesh(G.shin, M.socks);
    shin.castShadow = true;
    kneeJoint.add(shin);

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
