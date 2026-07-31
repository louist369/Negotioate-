import * as THREE from 'three';
import { PLAYER } from '../core/config.js';
import { PlayerState } from '../sim/player.js';
import { clamp, lerp } from '../core/vec.js';
import { CHARACTER_DIMS as DIM } from './character.js';

/**
 * Procedural animation.
 *
 * Every pose is computed from simulation state — speed, heading change, ball
 * possession, action timers — rather than played back from clips. That keeps
 * movement locked to the physics (no foot-sliding from a fixed-speed clip) and
 * means the whole game ships with no animation assets.
 *
 * Each channel is written into a target pose and then damped toward, so state
 * changes blend instead of popping.
 */

const UP = new THREE.Vector3(0, 1, 0);

/** Per-player animation memory, keyed off the visual object. */
export function createAnimState() {
  return {
    pose: blankPose(),
    target: blankPose(),
    rootY: 0,
    rootTilt: 0,
    rootRoll: 0,
    lastHeading: 0,
    headingVel: 0,
    footPlant: [0, 0],
  };
}

function blankPose() {
  return {
    hipY: 0,
    spinePitch: 0,
    spineRoll: 0,
    spineYaw: 0,
    headPitch: 0,
    headYaw: 0,
    legL: { hip: 0, knee: 0, ankle: 0, splay: 0 },
    legR: { hip: 0, knee: 0, ankle: 0, splay: 0 },
    armL: { shoulder: 0, shoulderZ: 0, elbow: 0 },
    armR: { shoulder: 0, shoulderZ: 0, elbow: 0 },
  };
}

function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

/**
 * @param {object} built  result of createPlayer()
 * @param {Player} p      simulation player
 * @param {object} st     animation state from createAnimState()
 */
export function animatePlayer(built, p, st, dt, time) {
  const j = built.joints;
  const t = st.target;
  const a = p.anim;

  const speed = p.speed;
  const ratio = clamp(speed / PLAYER.sprintSpeed, 0, 1);
  const sprinting = ratio > 0.72;

  // Reset target to a neutral standing pose each frame.
  resetPose(t);

  let blendRate = 12;

  switch (p.state) {
    case PlayerState.DIVE:
      poseDive(t, p, a);
      blendRate = 20;
      break;
    case PlayerState.STUMBLE:
      poseStumble(t, p, a);
      blendRate = 16;
      break;
    case PlayerState.TACKLE:
      poseTackle(t, p, a);
      blendRate = 22;
      break;
    case PlayerState.CELEBRATE:
      poseCelebrate(t, p, a, time);
      blendRate = 10;
      break;
    default:
      if (speed > 0.35) poseRun(t, p, a, ratio, sprinting);
      else poseIdle(t, p, a, time);
      break;
  }

  // Kicking overlays on top of locomotion so a player can pass mid-stride.
  if (a.kickPhase > 0 && p.state !== PlayerState.DIVE && p.state !== PlayerState.STUMBLE) {
    poseKick(t, p, a);
  }

  // Carrying the ball changes the upper body — lower centre of gravity, arms out.
  if (p.hasBall && p.state !== PlayerState.TACKLE) {
    t.spinePitch += 0.09;
    t.armL.shoulderZ += 0.16;
    t.armR.shoulderZ += 0.16;
  }

  applyPose(built, st, t, blendRate, dt);
  applyRoot(built, p, st, dt);
}

function resetPose(t) {
  t.hipY = 0;
  t.spinePitch = 0.045;
  t.spineRoll = 0;
  t.spineYaw = 0;
  t.headPitch = 0;
  t.headYaw = 0;
  setLeg(t.legL, 0, 0, 0, 0);
  setLeg(t.legR, 0, 0, 0, 0);
  setArm(t.armL, 0, 0.08, 0.12);
  setArm(t.armR, 0, 0.08, 0.12);
}

function setLeg(l, hip, knee, ankle, splay) {
  l.hip = hip;
  l.knee = knee;
  l.ankle = ankle;
  l.splay = splay;
}

function setArm(a, shoulder, shoulderZ, elbow) {
  a.shoulder = shoulder;
  a.shoulderZ = shoulderZ;
  a.elbow = elbow;
}

/** Breathing idle with a slow weight shift, plus a scan of the pitch. */
function poseIdle(t, p, a, time) {
  const b = Math.sin(time * 1.7 + p.id) * 0.5 + 0.5;
  t.hipY = -0.012 * b;
  t.spinePitch = 0.06 + b * 0.015;
  t.spineRoll = Math.sin(time * 0.8 + p.id * 2) * 0.03;

  setLeg(t.legL, 0.04, -0.09, 0.02, 0.045);
  setLeg(t.legR, -0.04, -0.07, 0.02, 0.045);

  const sway = Math.sin(time * 1.7 + p.id) * 0.06;
  setArm(t.armL, 0.05 + sway, 0.12, 0.2);
  setArm(t.armR, 0.05 - sway, 0.12, 0.2);

  // Look toward whatever the player is facing.
  t.headYaw = Math.sin(time * 0.55 + p.id * 1.3) * 0.18;
}

/**
 * Run cycle. Amplitudes scale with speed so a jog and a sprint are visibly
 * different gaits, and stride frequency comes from `anim.cycle`, which the sim
 * advances in proportion to actual ground speed — so feet never slide.
 */
function poseRun(t, p, a, ratio, sprinting) {
  const c = a.cycle;
  const s = Math.sin(c);
  const s2 = Math.sin(c * 2);

  const hipAmp = lerp(0.34, 0.95, ratio);
  const kneeAmp = lerp(0.5, 1.35, ratio);
  const armAmp = lerp(0.3, 0.92, ratio);

  // Legs are in antiphase; the knee bends hardest as the leg swings through.
  const lHip = s * hipAmp;
  const rHip = -s * hipAmp;
  const lKnee = -Math.max(0, Math.sin(c - 0.9)) * kneeAmp - 0.12;
  const rKnee = -Math.max(0, Math.sin(c + Math.PI - 0.9)) * kneeAmp - 0.12;

  setLeg(t.legL, lHip, lKnee, -lHip * 0.28, 0.03);
  setLeg(t.legR, rHip, rKnee, -rHip * 0.28, 0.03);

  // Arms counter-swing; elbows tuck tighter at sprint.
  setArm(t.armL, -s * armAmp, lerp(0.13, 0.22, ratio), lerp(0.35, 1.15, ratio));
  setArm(t.armR, s * armAmp, lerp(0.13, 0.22, ratio), lerp(0.35, 1.15, ratio));

  // Forward lean grows with pace; vertical bob is twice stride frequency.
  t.spinePitch = lerp(0.08, 0.42, ratio);
  t.hipY = Math.abs(s2) * lerp(0.012, 0.05, ratio) - lerp(0.005, 0.03, ratio);
  t.spineYaw = -s * lerp(0.05, 0.16, ratio);
  t.headPitch = -t.spinePitch * 0.65;

  if (sprinting) {
    t.spineRoll = s2 * 0.05;
  }
}

/** Plant-and-swing kick. `kickPhase` runs 1 -> 0 over the animation. */
function poseKick(t, p, a) {
  const ph = 1 - a.kickPhase; // 0 at start, 1 at end
  const type = a.kickType;

  // Wind-up then follow-through; the peak is just after contact.
  const swing = Math.sin(clamp(ph, 0, 1) * Math.PI);
  const windup = Math.sin(clamp(ph * 1.6, 0, 1) * Math.PI * 0.5);

  const power = type === 'shot' || type === 'clear' ? 1 : type === 'loft' || type === 'through' ? 0.75 : 0.5;
  const strength = a.kickPhase * power;

  // Right leg kicks; the left plants and straightens.
  const back = -windup * 0.55 * power;
  const through = swing * 1.5 * power;

  t.legR.hip = lerp(t.legR.hip, back + through, clamp(strength * 1.4, 0, 1));
  t.legR.knee = lerp(t.legR.knee, -0.9 * (1 - swing) * power - 0.1, clamp(strength * 1.4, 0, 1));
  t.legR.ankle = -0.25 * power;

  t.legL.hip = lerp(t.legL.hip, -0.12 * power, clamp(strength, 0, 1));
  t.legL.knee = lerp(t.legL.knee, -0.22 * power, clamp(strength, 0, 1));

  // Opposite arm swings out for balance.
  t.armL.shoulder = lerp(t.armL.shoulder, -through * 0.55, clamp(strength, 0, 1));
  t.armL.shoulderZ = lerp(t.armL.shoulderZ, 0.5 * power, clamp(strength, 0, 1));
  t.armR.shoulder = lerp(t.armR.shoulder, through * 0.28, clamp(strength, 0, 1));

  t.spinePitch += windup * 0.1 * power;
  t.spineYaw += -through * 0.16;

  if (type === 'throw') {
    // Two-handed overhead throw-in.
    t.armL.shoulder = -2.5;
    t.armR.shoulder = -2.5;
    t.armL.shoulderZ = 0.25;
    t.armR.shoulderZ = 0.25;
    t.armL.elbow = 0.5 * (1 - swing);
    t.armR.elbow = 0.5 * (1 - swing);
    t.spinePitch = -0.25 + swing * 0.55;
    t.legR.hip = -0.15;
    t.legR.knee = -0.2;
  }
}

/** Sliding tackle: leg extended, body low and rotated. */
function poseTackle(t, p, a) {
  const ph = a.tacklePhase;
  const ext = Math.sin(clamp(ph * 1.4, 0, 1) * Math.PI * 0.85);

  t.hipY = -0.42 * ext;
  t.spinePitch = -0.55 * ext;
  t.spineRoll = 0.55 * ext;

  setLeg(t.legR, 1.15 * ext, -0.12, 0.1, 0.12);
  setLeg(t.legL, 0.25 * ext, -1.35 * ext, 0.1, 0.2);

  setArm(t.armL, -0.9 * ext, 0.75 * ext, 0.4);
  setArm(t.armR, -0.5 * ext, 0.55 * ext, 0.3);
}

/** Losing balance: fold forward, arms out, drop. */
function poseStumble(t, p, a) {
  const ph = a.stumblePhase;
  const fall = Math.sin(clamp(ph * 1.25, 0, 1) * Math.PI);

  t.hipY = -0.4 * fall;
  t.spinePitch = 0.9 * fall;
  t.spineRoll = 0.35 * fall;

  setLeg(t.legL, -0.5 * fall, -1.1 * fall, 0, 0.25 * fall);
  setLeg(t.legR, 0.6 * fall, -0.8 * fall, 0, 0.25 * fall);

  setArm(t.armL, -1.5 * fall, 0.9 * fall, 0.5 * fall);
  setArm(t.armR, -1.3 * fall, 0.8 * fall, 0.4 * fall);
}

/** Keeper dive: fully extended, both arms reaching toward the ball. */
function poseDive(t, p, a) {
  const ph = a.divePhase;
  const ext = Math.sin(clamp(ph * 1.15, 0, 1) * Math.PI * 0.9);

  t.hipY = -0.05 - 0.15 * ext;
  t.spinePitch = -0.15 * ext;

  setLeg(t.legL, -0.35 * ext, -0.55 * ext, 0, 0.3 * ext);
  setLeg(t.legR, 0.25 * ext, -0.3 * ext, 0, 0.3 * ext);

  // Both arms reach in the dive direction.
  setArm(t.armL, -2.6 * ext, 0.35, 0.15);
  setArm(t.armR, -2.6 * ext, 0.35, 0.15);
}

/** Goal celebration: arms aloft with a run and a jump. */
function poseCelebrate(t, p, a, time) {
  const ph = a.celebratePhase;
  const jump = Math.max(0, Math.sin(ph * 5.2));
  const wave = Math.sin(time * 7 + p.id);

  t.hipY = jump * 0.12;
  t.spinePitch = -0.16;

  setArm(t.armL, -2.7 + wave * 0.22, 0.5, 0.25);
  setArm(t.armR, -2.7 - wave * 0.22, 0.5, 0.25);

  setLeg(t.legL, 0.28 - jump * 0.3, -0.45 - jump * 0.5, 0, 0.08);
  setLeg(t.legR, -0.25 + jump * 0.3, -0.35 - jump * 0.5, 0, 0.08);

  t.headPitch = -0.22;
}

/** Damp the current pose toward the target and push it into the rig. */
function applyPose(built, st, target, rate, dt) {
  const c = st.pose;
  const j = built.joints;

  c.hipY = damp(c.hipY, target.hipY, rate, dt);
  c.spinePitch = damp(c.spinePitch, target.spinePitch, rate, dt);
  c.spineRoll = damp(c.spineRoll, target.spineRoll, rate, dt);
  c.spineYaw = damp(c.spineYaw, target.spineYaw, rate, dt);
  c.headPitch = damp(c.headPitch, target.headPitch, rate, dt);
  c.headYaw = damp(c.headYaw, target.headYaw, rate * 0.6, dt);

  for (const side of ['legL', 'legR']) {
    const a = c[side];
    const b = target[side];
    a.hip = damp(a.hip, b.hip, rate, dt);
    a.knee = damp(a.knee, b.knee, rate, dt);
    a.ankle = damp(a.ankle, b.ankle, rate, dt);
    a.splay = damp(a.splay, b.splay, rate, dt);
  }
  for (const side of ['armL', 'armR']) {
    const a = c[side];
    const b = target[side];
    a.shoulder = damp(a.shoulder, b.shoulder, rate, dt);
    a.shoulderZ = damp(a.shoulderZ, b.shoulderZ, rate, dt);
    a.elbow = damp(a.elbow, b.elbow, rate, dt);
  }

  j.hips.position.y = DIM.hipY + c.hipY;
  j.spine.rotation.set(c.spinePitch, c.spineYaw, c.spineRoll);
  j.head.rotation.set(c.headPitch, c.headYaw, 0);

  const sideSign = { legL: -1, legR: 1, armL: -1, armR: 1 };

  for (const key of ['legL', 'legR']) {
    const pose = c[key];
    const leg = j[key];
    leg.hip.rotation.set(pose.hip, 0, sideSign[key] * pose.splay);
    leg.knee.rotation.x = pose.knee;
    leg.ankle.rotation.x = pose.ankle;
  }

  for (const key of ['armL', 'armR']) {
    const pose = c[key];
    const arm = j[key];
    arm.shoulder.rotation.set(pose.shoulder, 0, sideSign[key] * pose.shoulderZ);
    arm.elbow.rotation.x = pose.elbow;
  }
}

/** Root transform: world position, facing, and whole-body tilt for dives/falls. */
function applyRoot(built, p, st, dt) {
  const root = built.root;
  root.position.x = p.pos.x;
  root.position.z = p.pos.z;

  // Body faces its heading; `facing` lets an idle player look at the ball.
  const face = p.state === PlayerState.IDLE ? p.facing : p.heading;
  root.rotation.y = face;

  let tilt = 0;
  let roll = 0;
  let lift = 0;

  if (p.state === PlayerState.DIVE) {
    const ext = Math.sin(clamp(p.anim.divePhase * 1.15, 0, 1) * Math.PI * 0.9);
    // Roll the whole body toward the dive direction and lift it off the turf.
    roll = -p.anim.diveDir * ext * 1.25;
    lift = ext * 0.55;
  } else if (p.state === PlayerState.TACKLE) {
    const ext = Math.sin(clamp(p.anim.tacklePhase * 1.4, 0, 1) * Math.PI * 0.85);
    tilt = -ext * 0.85;
    lift = -0.1 * ext;
  } else if (p.state === PlayerState.STUMBLE) {
    const fall = Math.sin(clamp(p.anim.stumblePhase * 1.25, 0, 1) * Math.PI);
    tilt = fall * 0.75;
    lift = -0.12 * fall;
  }

  st.rootTilt = damp(st.rootTilt, tilt, 18, dt);
  st.rootRoll = damp(st.rootRoll, roll, 18, dt);
  st.rootY = damp(st.rootY, lift, 16, dt);

  root.position.y = st.rootY;
  root.rotation.x = st.rootTilt;
  root.rotation.z = st.rootRoll;
  root.rotation.order = 'YXZ';
}
