import { PLAYER, ROLE_ATTRS } from '../core/config.js';
import { clamp, lerp, turnToward } from '../core/vec.js';

export const PlayerState = {
  IDLE: 'idle',
  RUN: 'run',
  TACKLE: 'tackle',
  STUMBLE: 'stumble',
  DIVE: 'dive',
  CELEBRATE: 'celebrate',
  FROZEN: 'frozen',
};

let nextId = 1;

/**
 * A single footballer. Movement is intent-driven: every controller (human input,
 * team AI, keeper AI) writes `desired` each tick and the same integrator runs for
 * all of them, so AI and human players obey identical physics.
 */
export class Player {
  constructor({ team, role, index, isKeeper = false, attackDir = 1, skinIndex = 0, number = 2 }) {
    this.id = nextId++;
    this.team = team;
    this.role = role;
    this.index = index;
    this.isKeeper = isKeeper;
    this.attackDir = attackDir;
    this.skinIndex = skinIndex;
    this.number = number;

    this.pos = { x: 0, z: 0 };
    this.vel = { x: 0, z: 0 };
    this.heading = attackDir > 0 ? Math.PI / 2 : -Math.PI / 2;
    /** Where the body is looking — decoupled from heading so players can run and scan. */
    this.facing = this.heading;

    /** Controller output, rewritten every tick. */
    this.desired = { x: 0, z: 0 };
    this.desiredSpeed = 0;
    this.wantSprint = false;

    this.state = PlayerState.IDLE;
    this.stateTime = 0;
    this.stamina = PLAYER.staminaMax;
    this.exhausted = false;

    this.hasBall = false;
    this.controlCooldown = 0;
    this.kickCooldown = 0;
    this.tackleCooldown = 0;
    this.possessionLock = 0;
    this.lastReceiveTime = -99;

    const attrs = ROLE_ATTRS[role] || ROLE_ATTRS.CM;
    this.attrs = { ...attrs };

    // AI scratch state.
    this.ai = {
      target: { x: 0, z: 0 },
      homeSlot: { x: 0, z: 0 },
      decisionTimer: 0,
      mode: 'hold',
      markTarget: null,
      runTimer: 0,
      runLane: 0,
      lastMode: '',
    };

    // Animation scratch, written by the sim and read by the renderer.
    this.anim = {
      cycle: 0,
      speedRatio: 0,
      kickPhase: 0,
      kickType: null,
      tacklePhase: 0,
      divePhase: 0,
      diveDir: 0,
      stumblePhase: 0,
      celebratePhase: 0,
      lean: 0,
      turnRate: 0,
    };
  }

  get maxSpeed() {
    const base = this.wantSprint && !this.exhausted ? PLAYER.sprintSpeed : PLAYER.runSpeed;
    let s = base * this.attrs.speed;
    if (this.hasBall) s *= PLAYER.dribbleSpeedFactor;
    // Low stamina bleeds top speed even at a jog.
    s *= lerp(0.86, 1, clamp(this.stamina * 1.6, 0, 1));
    return s;
  }

  get speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.stateTime = 0;
    if (state === PlayerState.TACKLE) this.anim.tacklePhase = 0;
    if (state === PlayerState.DIVE) this.anim.divePhase = 0;
    if (state === PlayerState.STUMBLE) this.anim.stumblePhase = 0;
    if (state === PlayerState.CELEBRATE) this.anim.celebratePhase = 0;
  }

  freeze() {
    this.setState(PlayerState.FROZEN);
    this.vel.x = 0;
    this.vel.z = 0;
  }

  /** Controllers call this instead of writing velocity directly. */
  move(dirX, dirZ, speedScale = 1, sprint = false) {
    this.desired.x = dirX;
    this.desired.z = dirZ;
    this.desiredSpeed = speedScale;
    this.wantSprint = sprint;
  }

  stop() {
    this.desired.x = 0;
    this.desired.z = 0;
    this.desiredSpeed = 0;
    this.wantSprint = false;
  }

  step(dt) {
    this.stateTime += dt;
    this.controlCooldown = Math.max(0, this.controlCooldown - dt);
    this.kickCooldown = Math.max(0, this.kickCooldown - dt);
    this.tackleCooldown = Math.max(0, this.tackleCooldown - dt);
    this.possessionLock = Math.max(0, this.possessionLock - dt);

    switch (this.state) {
      case PlayerState.FROZEN:
        this.vel.x = 0;
        this.vel.z = 0;
        break;
      case PlayerState.STUMBLE:
        this.stepStumble(dt);
        break;
      case PlayerState.TACKLE:
        this.stepTackle(dt);
        break;
      case PlayerState.DIVE:
        this.stepDive(dt);
        break;
      case PlayerState.CELEBRATE:
        this.stepCelebrate(dt);
        break;
      default:
        this.stepLocomotion(dt);
        break;
    }

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    this.updateStamina(dt);
    this.updateAnim(dt);
  }

  stepLocomotion(dt) {
    const dLen = Math.hypot(this.desired.x, this.desired.z);
    const speed = this.speed;

    if (dLen > 0.01) {
      const dx = this.desired.x / dLen;
      const dz = this.desired.z / dLen;
      const target = this.maxSpeed * clamp(this.desiredSpeed, 0, 1);

      // Turn rate degrades with speed — this is the core of the anti-slide feel.
      const speedRatio = clamp(speed / PLAYER.sprintSpeed, 0, 1);
      const turnRate = lerp(PLAYER.turnRateStill, PLAYER.turnRateFull, speedRatio);
      const desiredHeading = Math.atan2(dx, dz);
      const prevHeading = this.heading;
      this.heading = turnToward(this.heading, desiredHeading, turnRate * dt);
      this.anim.turnRate = (this.heading - prevHeading) / Math.max(dt, 1e-4);

      // Accelerate along the *current* heading, not the raw input direction, so
      // sharp reversals cost time instead of teleporting momentum.
      const hx = Math.sin(this.heading);
      const hz = Math.cos(this.heading);

      // Reverse braking: input opposing velocity bleeds speed hard first.
      const alignment = speed > 0.2 ? (this.vel.x * hx + this.vel.z * hz) / speed : 1;
      let accel = (this.wantSprint && !this.exhausted ? PLAYER.sprintAccel : PLAYER.accel) * this.attrs.accel;
      if (alignment < 0) accel *= PLAYER.reverseBrake;

      const vx = this.vel.x + hx * accel * dt;
      const vz = this.vel.z + hz * accel * dt;
      const nv = Math.hypot(vx, vz);
      if (nv > target && nv > 1e-4) {
        // Cap without instantly snapping — overspeed decays.
        const capped = Math.max(target, nv - PLAYER.decel * dt);
        const k = capped / nv;
        this.vel.x = vx * k;
        this.vel.z = vz * k;
      } else {
        this.vel.x = vx;
        this.vel.z = vz;
      }
      this.setState(PlayerState.RUN);
      this.facing = this.heading;
    } else {
      // Deceleration to rest.
      if (speed > 1e-4) {
        const ns = Math.max(0, speed - PLAYER.decel * dt);
        const k = ns / speed;
        this.vel.x *= k;
        this.vel.z *= k;
      }
      if (this.speed < 0.15) {
        this.vel.x = 0;
        this.vel.z = 0;
        this.setState(PlayerState.IDLE);
      }
      this.anim.turnRate *= 0.85;
    }
  }

  stepTackle(dt) {
    // Committed lunge: direction is locked at the start of the tackle.
    const t = this.stateTime / PLAYER.tackleDuration;
    const decay = Math.max(0, 1 - t);
    const hx = Math.sin(this.heading);
    const hz = Math.cos(this.heading);
    const s = PLAYER.tackleLungeSpeed * decay * decay;
    this.vel.x = hx * s;
    this.vel.z = hz * s;
    this.anim.tacklePhase = clamp(t, 0, 1);
    if (this.stateTime >= PLAYER.tackleDuration) {
      this.setState(PlayerState.IDLE);
      this.tackleCooldown = PLAYER.tackleCooldown;
    }
  }

  stepStumble(dt) {
    const t = this.stateTime / PLAYER.stumbleTime;
    const speed = this.speed;
    if (speed > 1e-4) {
      const ns = Math.max(0, speed - PLAYER.decel * 0.55 * dt);
      const k = ns / speed;
      this.vel.x *= k;
      this.vel.z *= k;
    }
    this.anim.stumblePhase = clamp(t, 0, 1);
    if (this.stateTime >= PLAYER.stumbleTime) this.setState(PlayerState.IDLE);
  }

  stepDive(dt) {
    const t = this.stateTime / this.diveDuration;
    const decay = clamp(1 - t * 0.8, 0, 1);
    this.vel.x = this.diveVel.x * decay;
    this.vel.z = this.diveVel.z * decay;
    this.anim.divePhase = clamp(t, 0, 1);
    if (this.stateTime >= this.diveDuration) {
      this.setState(PlayerState.IDLE);
      this.vel.x = 0;
      this.vel.z = 0;
    }
  }

  stepCelebrate(dt) {
    const speed = this.speed;
    if (speed > 1e-4) {
      const ns = Math.max(0, speed - PLAYER.decel * 0.4 * dt);
      const k = ns / speed;
      this.vel.x *= k;
      this.vel.z *= k;
    }
    this.anim.celebratePhase += dt;
  }

  startTackle(dirX, dirZ) {
    if (this.tackleCooldown > 0 || this.state === PlayerState.TACKLE || this.state === PlayerState.STUMBLE) {
      return false;
    }
    const l = Math.hypot(dirX, dirZ);
    if (l > 0.01) this.heading = Math.atan2(dirX / l, dirZ / l);
    this.facing = this.heading;
    this.setState(PlayerState.TACKLE);
    return true;
  }

  startDive(vx, vz, duration, dir) {
    this.diveVel = { x: vx, z: vz };
    this.diveDuration = duration;
    this.anim.diveDir = dir;
    this.setState(PlayerState.DIVE);
  }

  stumble() {
    if (this.state === PlayerState.STUMBLE) return;
    this.setState(PlayerState.STUMBLE);
    this.hasBall = false;
    this.possessionLock = PLAYER.possessionLockout * 2;
  }

  updateStamina(dt) {
    const sprinting = this.wantSprint && this.speed > PLAYER.runSpeed * 0.85;
    if (sprinting) {
      this.stamina = clamp(this.stamina - PLAYER.staminaDrainSprint * dt, 0, PLAYER.staminaMax);
      if (this.stamina <= PLAYER.staminaExhausted) this.exhausted = true;
    } else {
      const rate = this.speed < 1 ? PLAYER.staminaRegen * 1.7 : PLAYER.staminaRegen;
      this.stamina = clamp(this.stamina + rate * dt, 0, PLAYER.staminaMax);
      if (this.exhausted && this.stamina >= PLAYER.staminaRecoverAt) this.exhausted = false;
    }
  }

  updateAnim(dt) {
    const speed = this.speed;
    const ratio = clamp(speed / PLAYER.sprintSpeed, 0, 1);
    this.anim.speedRatio = lerp(this.anim.speedRatio, ratio, clamp(dt * 12, 0, 1));

    // Stride frequency scales with speed; the 0.55 floor keeps idle sway alive.
    const stride = lerp(0.0, 2.55, ratio) + (speed > 0.2 ? 0.55 : 0);
    this.anim.cycle += stride * dt * Math.PI * 2 * 0.55;
    if (this.anim.cycle > Math.PI * 4) this.anim.cycle -= Math.PI * 4;

    // Body lean from lateral acceleration (turning) and forward drive.
    const targetLean = clamp(-this.anim.turnRate * 0.09 * ratio, -0.42, 0.42);
    this.anim.lean = lerp(this.anim.lean, targetLean, clamp(dt * 8, 0, 1));

    if (this.anim.kickPhase > 0) {
      this.anim.kickPhase = Math.max(0, this.anim.kickPhase - dt / 0.34);
      if (this.anim.kickPhase === 0) this.anim.kickType = null;
    }
  }

  triggerKickAnim(type) {
    this.anim.kickPhase = 1;
    this.anim.kickType = type;
  }

  /** Point in front of the player where a controlled touch sits. */
  controlPoint(out, dist = PLAYER.controlRadius) {
    out.x = this.pos.x + Math.sin(this.heading) * dist;
    out.z = this.pos.z + Math.cos(this.heading) * dist;
    return out;
  }

  resetForKickoff(x, z, heading) {
    this.pos.x = x;
    this.pos.z = z;
    this.vel.x = 0;
    this.vel.z = 0;
    this.heading = heading;
    this.facing = heading;
    this.hasBall = false;
    this.setState(PlayerState.IDLE);
    this.stateTime = 0;
    this.controlCooldown = 0;
    this.kickCooldown = 0;
    this.tackleCooldown = 0;
    this.possessionLock = 0;
    this.anim.kickPhase = 0;
    this.anim.tacklePhase = 0;
    this.anim.divePhase = 0;
    this.anim.stumblePhase = 0;
    this.anim.celebratePhase = 0;
    this.stop();
  }
}

export function resetPlayerIds() {
  nextId = 1;
}
